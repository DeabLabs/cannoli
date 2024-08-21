import { Reference, VerifiedCannoliCanvasTextData, VerifiedCannoliCanvasLinkData, VerifiedCannoliCanvasFileData, VerifiedCannoliCanvasData, EdgeModifier, EdgeType, ReferenceType } from "src/graph";
import { CannoliEdge } from "src/graph/objects/CannoliEdge";
import { ChatResponseEdge } from "src/graph/objects/edges/ChatResponseEdge";
import { GenericCompletionParams } from "src/providers";
import { ContentNode } from "../ContentNode";
import { FloatingNode } from "../../../FloatingNode";

export class ReferenceNode extends ContentNode {
    reference: Reference;

    constructor(
        nodeData:
            | VerifiedCannoliCanvasTextData
            | VerifiedCannoliCanvasLinkData
            | VerifiedCannoliCanvasFileData,
        fullCanvasData: VerifiedCannoliCanvasData
    ) {
        super(nodeData, fullCanvasData);

        if (this.references.length !== 1) {
            this.error(`Could not find reference.`);
        } else {
            this.reference = this.references[0];
        }
    }

    async execute(): Promise<void> {
        this.executing();

        let content: string | null = null;

        const writeOrLoggingContent = this.getWriteOrLoggingContent();

        const variableValues = this.getVariableValues(false);

        if (variableValues.length > 0) {
            // First, get the edges of the variable values
            const variableValueEdges = variableValues.map((variableValue) => {
                return this.graph[variableValue.edgeId ?? ""] as CannoliEdge;
            });

            // Then, filter out the edges that have the same name as the reference, or are of type folder or property
            const filteredVariableValueEdges = variableValueEdges.filter(
                (variableValueEdge) => {
                    return (
                        variableValueEdge.text !== this.reference.name &&
                        variableValueEdge.edgeModifier !==
                        EdgeModifier.Folder &&
                        variableValueEdge.edgeModifier !==
                        EdgeModifier.Property
                    );
                }
            );

            // Then, filter the variable values by the filtered edges
            const filteredVariableValues = variableValues.filter(
                (variableValue) => {
                    return filteredVariableValueEdges.some(
                        (filteredVariableValueEdge) => {
                            return (
                                filteredVariableValueEdge.id ===
                                variableValue.edgeId
                            );
                        }
                    );
                }
            );

            if (filteredVariableValues.length > 0) {
                // Then, get the content of the first variable value
                content = filteredVariableValues[0].content;
            } else if (writeOrLoggingContent !== null) {
                content = writeOrLoggingContent;
            }
        } else if (writeOrLoggingContent !== null) {
            content = writeOrLoggingContent;
        }

        // Get the property edges
        const propertyEdges = this.getIncomingEdges().filter(
            (edge) =>
                edge.edgeModifier === EdgeModifier.Property &&
                edge.text !== this.reference.name
        );

        if (content !== null) {
            // Append is dependent on if there is an incoming edge of type ChatResponse
            const append = this.getIncomingEdges().some(
                (edge) => edge.type === EdgeType.ChatResponse
            );

            if (
                this.reference.type === ReferenceType.CreateNote ||
                (this.reference.type === ReferenceType.Variable &&
                    this.reference.shouldExtract)
            ) {
                await this.processDynamicReference(content);
            } else {
                await this.editContent(content, append);

                // If there are property edges, edit the properties
                if (propertyEdges.length > 0) {
                    for (const edge of propertyEdges) {
                        if (
                            edge.content === null ||
                            edge.content === undefined ||
                            typeof edge.content !== "string"
                        ) {
                            this.error(`Property arrow has invalid content.`);
                            return;
                        }

                        await this.editProperty(edge.text, edge.content);
                    }
                }
            }

            // Load all outgoing edges
            await this.loadOutgoingEdges(content);
        } else {
            if (
                this.reference.type === ReferenceType.CreateNote ||
                (this.reference.type === ReferenceType.Variable &&
                    this.reference.shouldExtract)
            ) {
                await this.processDynamicReference("");

                const fetchedContent = await this.getContent();
                await this.loadOutgoingEdges(fetchedContent);
            } else {
                const fetchedContent = await this.getContent();
                await this.loadOutgoingEdges(fetchedContent);
            }

            // If there are property edges, edit the properties
            if (propertyEdges.length > 0) {
                for (const edge of propertyEdges) {
                    if (
                        edge.content === null ||
                        edge.content === undefined ||
                        typeof edge.content !== "string"
                    ) {
                        this.error(`Property arrow has invalid content.`);
                        return;
                    }

                    await this.editProperty(edge.text, edge.content);
                }
            }
        }

        // Load all outgoing edges
        this.completed();
    }

    async getContent(): Promise<string> {
        if (this.run.isMock) {
            return `Mock content`;
        }

        if (this.reference) {
            if (this.reference.type === ReferenceType.Note) {
                const content = await this.getContentFromNote(this.reference);
                if (content !== null && content !== undefined) {
                    return content;
                } else {
                    this.error(
                        `Invalid reference. Could not find note "${this.reference.name}".`
                    );
                }
            } else if (this.reference.type === ReferenceType.Selection) {
                const content = this.run.selection;

                if (content !== null && content !== undefined) {
                    return content;
                } else {
                    this.error(`Invalid reference. Could not find selection.`);
                }
            } else if (this.reference.type === ReferenceType.Floating) {
                const content = this.getContentFromFloatingNode(
                    this.reference.name
                );
                if (content !== null) {
                    return content;
                } else {
                    this.error(
                        `Invalid reference. Could not find floating node "${this.reference.name}".\n\nIf you want this node to inject a variable, turn it into a formatter node by wrapping the whole node in ""two sets of double quotes"".`
                    );
                }
            } else if (this.reference.type === ReferenceType.Variable) {
                const content = this.getContentFromFloatingNode(
                    this.reference.name
                );
                if (content !== null) {
                    return content;
                } else {
                    this.error(
                        `Invalid reference. Could not find floating node "${this.reference.name}".\n\nIf you want this node to inject a variable, turn it into a formatter node by wrapping the whole node in ""two sets of double quotes"".`
                    );
                }
            } else if (
                this.reference.type === ReferenceType.CreateNote
            ) {
                this.error(`Dynamic reference did not process correctly.`);
            }
        }

        return `Could not find reference.`;
    }

    async processDynamicReference(content: string) {
        if (this.run.isMock) {
            return;
        }

        const incomingEdges = this.getIncomingEdges();

        // Find the incoming edge with the same name as the reference name
        const referenceNameEdge = incomingEdges.find(
            (edge) => edge.text === this.reference.name
        );

        if (!referenceNameEdge) {
            this.error(`Could not find arrow containing note name.`);
            return;
        }

        if (
            referenceNameEdge.content === null ||
            referenceNameEdge.content === undefined ||
            typeof referenceNameEdge.content !== "string"
        ) {
            this.error(`Note name arrow has invalid content.`);
            return;
        }

        // Look for an incoming edge with a vault modifier of type folder
        const folderEdge = incomingEdges.find(
            (edge) => edge.edgeModifier === EdgeModifier.Folder
        );

        let path = "";

        if (folderEdge) {
            if (
                folderEdge.content === null ||
                folderEdge.content === undefined ||
                typeof folderEdge.content !== "string"
            ) {
                this.error(`Folder arrow has invalid content.`);
                return;
            }

            path = folderEdge.content;
        }

        // Look for incoming edges with a vault modifier of type property
        const propertyEdges = incomingEdges.filter(
            (edge) =>
                edge.edgeModifier === EdgeModifier.Property &&
                edge.text !== this.reference.name
        );

        // If this reference is a create note type, create the note
        if (this.reference.type === ReferenceType.CreateNote) {
            let noteName;

            // If there are properties edges, create a yaml frontmatter section, and fill it with the properties, where the key is the edge.text and the value is the edge.content
            if (propertyEdges.length > 0) {
                let yamlFrontmatter = "---\n";

                for (const edge of propertyEdges) {
                    if (
                        edge.content === null ||
                        edge.content === undefined ||
                        typeof edge.content !== "string"
                    ) {
                        this.error(`Property arrow has invalid content.`);
                        return;
                    }

                    // If the edge.content is a list (starts with a dash), add a newline and two spaces, and replace all newlines with newlines and two spaces
                    if (edge.content.startsWith("-")) {
                        yamlFrontmatter += `${edge.text}: \n  ${edge.content
                            .replace(/\n/g, "\n  ")
                            .trim()}\n`;
                    } else {
                        yamlFrontmatter += `${edge.text}: "${edge.content}"\n`;
                    }
                }

                yamlFrontmatter += "---\n";

                content = yamlFrontmatter + content;
            }

            try {
                // If there's no fileSystemInterface, throw an error
                if (!this.run.fileManager) {
                    throw new Error("No fileManager found");
                }

                noteName = await this.run.fileManager.createNoteAtExistingPath(
                    referenceNameEdge.content,
                    path,
                    content
                );
            } catch (e) {
                this.error(`Could not create note: ${e.message}`);
                return;
            }

            if (!noteName) {
                this.error(`"${referenceNameEdge.content}" already exists.`);
            } else {
                this.reference.name = noteName;
                this.reference.type = ReferenceType.Note;
            }
        } else {
            // Transform the reference
            this.reference.name = referenceNameEdge.content;
            this.reference.type = ReferenceType.Note;

            // If content is not null, edit the note
            if (content !== null) {
                await this.editContent(content, false);
            }

            // If there are property edges, edit the properties
            if (propertyEdges.length > 0) {
                for (const edge of propertyEdges) {
                    if (
                        edge.content === null ||
                        edge.content === undefined ||
                        typeof edge.content !== "string"
                    ) {
                        this.error(`Property arrow has invalid content.`);
                        return;
                    }

                    await this.editProperty(edge.text, edge.content);
                }
            }
        }
    }

    async editContent(newContent: string, append?: boolean): Promise<void> {
        if (this.run.isMock) {
            return;
        }

        if (this.reference) {
            if (this.reference.type === ReferenceType.Note) {
                // If there's no fileSystemInterface, throw an error
                if (!this.run.fileManager) {
                    throw new Error("No fileManager found");
                }

                const edit = await this.run.fileManager.editNote(
                    this.reference,
                    newContent,
                    this.run.isMock,
                    append ?? false
                );

                if (edit !== null) {
                    return;
                } else {
                    this.error(
                        `Invalid reference. Could not edit note ${this.reference.name}`
                    );
                }
            } else if (this.reference.type === ReferenceType.Selection) {
                // If there's no fileSystemInterface, throw an error
                if (!this.run.fileManager) {
                    throw new Error("No fileManager found");
                }

                this.run.fileManager.editSelection(newContent, this.run.isMock);
                return;
            } else if (this.reference.type === ReferenceType.Floating) {
                // Search through all nodes for a floating node with the correct name
                for (const objectId in this.graph) {
                    const object = this.graph[objectId];
                    if (
                        object instanceof FloatingNode &&
                        object.getName() === this.reference.name
                    ) {
                        object.editContent(newContent);
                        return;
                    }
                }

                this.error(
                    `Invalid reference. Could not find floating node ${this.reference.name}.\n\nIf you want this node to inject a variable, turn it into a formatter node by wrapping it in ""two sets of double quotes"".`
                );
            } else if (
                this.reference.type === ReferenceType.Variable) {
                // Search through all nodes for a floating node with the correct name
                for (const objectId in this.graph) {
                    const object = this.graph[objectId];
                    if (
                        object instanceof FloatingNode &&
                        object.getName() === this.reference.name
                    ) {
                        object.editContent(newContent);
                        return;
                    }
                }

                this.error(
                    `Invalid reference. Could not find floating node ${this.reference.name}.\n\nIf you want this node to inject a variable, turn it into a formatter node by wrapping it in ""two sets of double quotes"".`
                );
            } else if (
                this.reference.type === ReferenceType.CreateNote
            ) {
                this.error(`Dynamic reference did not process correctly.`);
            }
        }
    }

    async editProperty(
        propertyName: string,
        newContent: string
    ): Promise<void> {
        if (this.run.isMock) {
            return;
        }

        if (this.reference) {
            if (this.reference.type === ReferenceType.Note) {
                // If there's no fileSystemInterface, throw an error
                if (!this.run.fileManager) {
                    throw new Error("No fileManager found");
                }

                const edit = await this.run.fileManager.editPropertyOfNote(
                    this.reference.name,
                    propertyName,
                    newContent.trim()
                );

                if (edit !== null) {
                    return;
                } else {
                    this.error(
                        `Invalid reference. Could not edit property ${propertyName} of note ${this.reference.name}`
                    );
                }
            } else if (this.reference.type === ReferenceType.Floating) {
                // Search through all nodes for a floating node with the correct name

                for (const objectId in this.graph) {
                    const object = this.graph[objectId];
                    if (
                        object instanceof FloatingNode &&
                        object.getName() === this.reference.name
                    ) {
                        object.editProperty(propertyName, newContent.trim());
                        return;
                    }
                }
            } else if (
                this.reference.type === ReferenceType.Variable ||
                this.reference.type === ReferenceType.CreateNote
            ) {
                this.error(`Dynamic reference did not process correctly.`);
            }
        }
    }

    async loadOutgoingEdges(
        content: string,
        request?: GenericCompletionParams | undefined
    ) {
        // If this is a floating node, load all outgoing edges with the content
        if (this.reference.type === ReferenceType.Floating) {
            this.loadOutgoingEdgesFloating(content, request);
            return;
        }

        for (const edge of this.outgoingEdges) {
            const edgeObject = this.graph[edge];
            if (!(edgeObject instanceof CannoliEdge)) {
                continue;
            }

            if (edgeObject.edgeModifier === EdgeModifier.Property) {
                let value;

                if (edgeObject.text.length === 0) {
                    // If there's no fileSystemInterface, throw an error
                    if (!this.run.fileManager) {
                        throw new Error("No fileManager found");
                    }

                    value = await this.run.fileManager.getAllPropertiesOfNote(
                        this.reference.name,
                        true
                    );
                } else {
                    // If there's no fileSystemInterface, throw an error
                    if (!this.run.fileManager) {
                        throw new Error("No fileManager found");
                    }

                    // Get value of the property with the same name as the edge
                    value = await this.run.fileManager.getPropertyOfNote(
                        this.reference.name,
                        edgeObject.text,
                        true
                    );
                }

                if (value) {
                    edgeObject.load({
                        content: value ?? "",
                        request: request,
                    });
                }
            } else if (edgeObject.edgeModifier === EdgeModifier.Note) {
                // Load the edge with the name of the note
                edgeObject.load({
                    content: `${this.reference.name}`,
                    request: request,
                });
            } else if (edgeObject.edgeModifier === EdgeModifier.Folder) {
                // If there's no fileSystemInterface, throw an error
                if (!this.run.fileManager) {
                    throw new Error("No fileManager found");
                }

                const path = await this.run.fileManager.getNotePath(
                    this.reference.name
                );

                if (path) {
                    edgeObject.load({
                        content: path,
                        request: request,
                    });
                }
            } else if (
                edgeObject instanceof CannoliEdge &&
                !(edgeObject instanceof ChatResponseEdge)
            ) {
                edgeObject.load({
                    content: content,
                    request: request,
                });
            }
        }
    }

    loadOutgoingEdgesFloating(
        content: string,
        request?: GenericCompletionParams | undefined
    ) {
        for (const edge of this.outgoingEdges) {
            const edgeObject = this.graph[edge];
            if (!(edgeObject instanceof CannoliEdge)) {
                continue;
            }

            // If the edge has a note modifier, load it with the name of the floating node
            if (edgeObject.edgeModifier === EdgeModifier.Note) {
                edgeObject.load({
                    content: `${this.reference.name}`,
                    request: request,
                });
            } else if (edgeObject.edgeModifier === EdgeModifier.Property) {
                // Find the floating node with the same name as this reference
                let propertyContent = "";

                for (const objectId in this.graph) {
                    const object = this.graph[objectId];
                    if (
                        object instanceof FloatingNode &&
                        object.getName() === this.reference.name
                    ) {
                        propertyContent = object.getProperty(edgeObject.text);
                    }
                }

                if (propertyContent) {
                    edgeObject.load({
                        content: propertyContent,
                        request: request,
                    });
                }
            } else if (
                edgeObject instanceof CannoliEdge &&
                !(edgeObject instanceof ChatResponseEdge)
            ) {
                edgeObject.load({
                    content: content,
                    request: request,
                });
            }
        }
    }

    logDetails(): string {
        return super.logDetails() + `Subtype: Reference\n`;
    }
}