import { EdgeType, EdgeModifier } from "src/graph";
import { GenericCompletionResponse, GenericCompletionParams, ImageReference, GenericModelConfigSchema, GenericModelConfig, SupportedProviders, GenericFunctionCall } from "src/providers";
import { ChatRole } from "src/run";
import invariant from "tiny-invariant";
import { CannoliNode } from "../CannoliNode";

export class CallNode extends CannoliNode {
    async getNewMessage(
        role?: string
    ): Promise<GenericCompletionResponse | null> {
        const content = await this.processReferences();

        // If there is no content, return null
        if (!content) {
            return null;
        }

        return {
            role: (role as ChatRole) || "user",
            content: content,
        };
    }

    findNoteReferencesInMessages(
        messages: GenericCompletionResponse[]
    ): string[] {
        const references: string[] = [];
        const noteRegex = /\[\[(.+?)\]\]/g;

        // Get the contents of each double bracket
        for (const message of messages) {
            const matches =
                typeof message.content === "string" &&
                message.content?.matchAll(noteRegex);

            if (!matches) {
                continue;
            }

            for (const match of matches) {
                references.push(match[1]);
            }
        }

        return references;
    }

    async execute() {
        this.executing();

        let request: GenericCompletionParams;
        try {
            request = await this.createLLMRequest();
        } catch (error) {
            this.error(`Error creating LLM request: ${error}`);
            return;
        }

        // If the message array is empty, error
        if (request.messages.length === 0) {
            this.error(
                `No messages to send to LLM. Empty call nodes only send the message history they've been passed.`
            );
            return;
        }

        // If the node has an outgoing chatResponse edge, call with streaming
        const chatResponseEdges = this.getOutgoingEdges().filter(
            (edge) => edge.type === EdgeType.ChatResponse
        );

        if (chatResponseEdges.length > 0) {
            const stream = await this.run.callLLMStream(request);

            if (stream instanceof Error) {
                this.error(`Error calling LLM:\n${stream.message}`);
                return;
            }

            if (!stream) {
                this.error(`Error calling LLM: no stream returned.`);
                return;
            }

            if (typeof stream === "string") {
                this.loadOutgoingEdges(stream, request);
                this.completed();
                return;
            }

            // Create message content string
            let messageContent = "";
            // Process the stream. For each part, add the message to the request, and load the outgoing edges
            for await (const part of stream) {
                if (!part || typeof part !== "string") {
                    // deltas might be empty, that's okay, just get the next one
                    continue;
                }

                // Add the part to the message content
                messageContent += part;

                // Load outgoing chatResponse edges with the part
                for (const edge of chatResponseEdges) {
                    edge.load({
                        content: part ?? "",
                        request: request,
                    });
                }
            }

            // Load outgoing chatResponse edges with the message "END OF STREAM"
            for (const edge of chatResponseEdges) {
                edge.load({
                    content: "END OF STREAM",
                    request: request,
                });
            }

            // Add an assistant message to the messages array of the request
            request.messages.push({
                role: "assistant",
                content: messageContent,
            });

            // After the stream is done, load the outgoing edges
            this.loadOutgoingEdges(messageContent, request);
        } else {
            const message = await this.run.callLLM(request);

            if (message instanceof Error) {
                this.error(`Error calling LLM:\n${message.message}`);
                return;
            }

            if (!message) {
                this.error(`Error calling LLM: no message returned.`);
                return;
            }

            request.messages.push(message);

            if (message.function_call?.arguments) {
                if (message.function_call.name === "note_select") {
                    const args = JSON.parse(message.function_call.arguments);

                    // Put double brackets around the note name
                    args.note = `[[${args.note}]]`;

                    this.loadOutgoingEdges(args.note, request);
                } else {
                    this.loadOutgoingEdges(message.content ?? "", request);
                }
            } else {
                this.loadOutgoingEdges(message.content ?? "", request);
            }
        }

        this.completed();
    }

    async extractImages(message: GenericCompletionResponse, index: number): Promise<ImageReference[]> {
        const imageReferences: ImageReference[] = [];
        const markdownImageRegex = /!\[.*?\]\((.*?)\)/g;
        let match;

        while ((match = markdownImageRegex.exec(message.content)) !== null) {
            imageReferences.push({
                url: match[1],
                messageIndex: index,
            });
        }

        if (this.run.fileManager) {
            const imageExtensions = [".jpg", ".png", ".jpeg", ".gif", ".bmp", ".tiff", ".webp", ".svg", ".ico", ".jfif", ".avif"];
            // should match instances like ![[image.jpg]]
            const fileImageRegex = new RegExp(`!\\[\\[([^\\]]+(${imageExtensions.join("|")}))\\]\\]`, "g");
            while ((match = fileImageRegex.exec(message.content)) !== null) {
                // "image.jpg"
                const fileName = match[1];

                // get file somehow from the filename
                const file = await this.run.fileManager.getFile(fileName, this.run.isMock);

                if (!file) {
                    continue;
                }

                // turn file into base64
                let base64 = Buffer.from(file).toString('base64');
                base64 = `data:image/${fileName.split('.').pop()};base64,${base64}`;

                imageReferences.push({
                    url: base64,
                    messageIndex: index,
                });
            }
        }

        return imageReferences;
    }

    async createLLMRequest(): Promise<GenericCompletionParams> {
        const overrides = this.getConfig(GenericModelConfigSchema) as GenericModelConfig;
        const config = this.run.llm?.getMergedConfig({
            configOverrides: overrides,
            provider: (overrides.provider as SupportedProviders) ?? undefined
        });
        invariant(config, "Config is undefined");

        const messages = this.getPrependedMessages();

        const newMessage = await this.getNewMessage(config.role);

        // Remove the role from the config
        delete config.role;

        if (newMessage) {
            messages.push(newMessage);
        }

        const imageReferences = await Promise.all(messages.map(async (message, index) => {
            return await this.extractImages(message, index);
        })).then(ir => ir.flat());

        const functions = this.getFunctions(messages);

        const function_call =
            functions && functions.length > 0
                ? { name: functions[0].name }
                : undefined;

        return {
            messages: messages,
            imageReferences: imageReferences,
            ...config,
            functions:
                functions && functions.length > 0 ? functions : undefined,
            function_call: function_call ? function_call : undefined,
        };
    }

    getFunctions(messages: GenericCompletionResponse[]): GenericFunctionCall[] {
        if (
            this.getOutgoingEdges().some(
                (edge) => edge.edgeModifier === EdgeModifier.Note
            )
        ) {
            const noteNames = this.findNoteReferencesInMessages(messages);
            return [this.run.createNoteNameFunction(noteNames)];
        } else {
            return [];
        }
    }

    logDetails(): string {
        return super.logDetails() + `Type: Call\n`;
    }

    validate() {
        super.validate();
    }
}