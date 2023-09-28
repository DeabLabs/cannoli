import { CannoliObject, CannoliVertex } from "./object";
import { ChatRole, type OpenAIConfig } from "src/run";
import { CannoliEdge, ChatResponseEdge, LoggingEdge } from "./edge";
import { CannoliGroup } from "./group";
import {
	CannoliObjectStatus,
	ContentNodeType,
	EdgeType,
	GroupType,
	Reference,
	ReferenceType,
	VaultModifier,
	VerifiedCannoliCanvasFileData,
	VerifiedCannoliCanvasLinkData,
	VerifiedCannoliCanvasTextData,
} from "./graph";
import {
	ChatCompletionCreateParams,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessage,
} from "openai/resources/chat";

type VariableValue = { name: string; content: string; edgeId: string };

export class CannoliNode extends CannoliVertex {
	references: Reference[] = [];
	renderFunction: (
		variables: { name: string; content: string }[]
	) => Promise<string>;

	constructor(
		nodeData:
			| VerifiedCannoliCanvasFileData
			| VerifiedCannoliCanvasLinkData
			| VerifiedCannoliCanvasTextData
	) {
		super(nodeData);
		this.references = nodeData.cannoliData.references || [];
		this.renderFunction = this.buildRenderFunction();
	}

	buildRenderFunction() {
		// Replace references with placeholders using an index-based system
		let textCopy = this.text;

		let index = 0;
		textCopy = textCopy.replace(/\{\{[^{}]+\}\}/g, () => `{{${index++}}}`); // Updated regex pattern to match {{thing}}

		// Define and return the render function
		const renderFunction = async (
			variables: { name: string; content: string }[]
		) => {
			// Process embedded notes
			textCopy = await this.processEmbeds(textCopy);

			// Create a map to look up variable content by name
			const varMap = new Map(variables.map((v) => [v.name, v.content]));
			// Replace the indexed placeholders with the content from the variables
			return textCopy.replace(/\{\{(\d+)\}\}/g, (match, index) => {
				// Retrieve the reference by index
				const reference = this.references[Number(index)];
				// Retrieve the content from the varMap using the reference's name
				return varMap.get(reference.name) || "{{invalid}}";
			});
		};

		return renderFunction;
	}

	async processEmbeds(content: string): Promise<string> {
		// Check for embedded notes (e.g. ![[Note Name]]), and replace them with the note content
		const embeddedNotes = content.match(/!\[\[[\s\S]*?\]\]/g);

		if (embeddedNotes) {
			for (const embeddedNote of embeddedNotes) {
				let noteName = embeddedNote
					.replace("![[", "")
					.replace("]]", "");

				let subpath;

				// If there's a pipe, split and use the first part as the note name
				if (noteName.includes("|")) {
					noteName = noteName.split("|")[0];
				}

				// If there's a "#", split and use the first part as the note name, and the second part as the heading
				if (noteName.includes("#")) {
					const split = noteName.split("#");
					noteName = split[0];
					subpath = split[1];
				}

				const noteContent = await this.run.getNote({
					name: noteName,
					type: ReferenceType.Note,
					shouldExtract: true,
					includeName: true,
					subpath: subpath,
				});

				if (noteContent) {
					const blockquotedNoteContent =
						"> " + noteContent.replace(/\n/g, "\n> ");
					content = content.replace(
						embeddedNote,
						blockquotedNoteContent
					);
				}
			}
		}

		return content;
	}

	async getContentFromNote(reference: Reference): Promise<string | null> {
		const note = await this.run.getNote(reference);

		if (!note) {
			return null;
		}

		return note;
	}

	getContentFromFloatingNode(name: string): string | null {
		for (const object of Object.values(this.graph)) {
			if (object instanceof FloatingNode && object.getName() === name) {
				return object.getContent();
			}
		}
		return null;
	}

	async processReferences() {
		const variableValues = this.getVariableValues(true);

		// console.log(`References: ${JSON.stringify(this.references, null, 2)}`);
		// console.log(
		// 	`Variable values: ${JSON.stringify(variableValues, null, 2)}`
		// );

		const resolvedReferences = await Promise.all(
			this.references.map(async (reference) => {
				let content = "{{invalid reference}}";
				const { name } = reference;

				if (
					reference.type === ReferenceType.Variable &&
					!reference.shouldExtract
				) {
					const variable = variableValues.find(
						(variable: { name: string }) =>
							variable.name === reference.name
					);

					if (variable) {
						content = variable.content;
					}
					// If the reference name contains only "#" symbols, replace it with the loop index
					else if (reference.name.match(/^#+$/)) {
						// Depth is the number of hash symbols minus 1
						const depth = reference.name.length - 1;
						const loopIndex = this.getLoopIndex(depth);
						if (loopIndex !== null) {
							content = loopIndex.toString();
						} else {
							content = `{{${reference.name}}}`;
						}
					} else {
						// this.warning(`Variable "${reference.name}" not found`);
						content = `{{${reference.name}}}`;
					}
				} else if (
					reference.type === ReferenceType.Variable &&
					reference.shouldExtract
				) {
					const variable = variableValues.find(
						(variable) => variable.name === reference.name
					);
					if (variable && variable.content) {
						// Save original variable name
						const originalName = reference.name;

						// Set reference name to the content of the variable
						reference.name = variable.content;

						// Get the content from the note
						const noteContent = await this.getContentFromNote(
							reference
						);

						// Restore original variable name
						reference.name = originalName;
						if (noteContent) {
							content = noteContent;
						} else {
							this.warning(
								`Note "${variable.content}" not found`
							);
							content = `{{@${reference.name}}}`;
						}
					} else {
						//this.warning(`Variable "${reference.name}" not found`);
						content = `{{@${reference.name}}}`;
					}
				} else if (reference.type === ReferenceType.Note) {
					if (reference.shouldExtract) {
						const noteContent = await this.getContentFromNote(
							reference
						);
						if (noteContent) {
							content = noteContent;
						} else {
							this.warning(`Note "${reference.name}" not found`);
							content = `{{${reference.name}}}`;
						}
					}
				} else if (reference.type === ReferenceType.Floating) {
					if (reference.shouldExtract) {
						const floatingContent = this.getContentFromFloatingNode(
							reference.name
						);
						if (floatingContent) {
							content = floatingContent;
						} else {
							this.warning(`Floating node "${name}" not found`);
							content = `{{[${reference.name}]}}`;
						}
					}
				}

				return { name, content };
			})
		);

		return this.renderFunction(resolvedReferences);
	}

	getLoopIndex(depth: number): number | null {
		// Get the group at the specified depth (0 is the most immediate group)
		const group = this.graph[this.groups[depth]];

		// If group is not there, return null
		if (!group) {
			return null;
		}

		// If group is not a CannoliGroup, return null
		if (!(group instanceof CannoliGroup)) {
			return null;
		}

		// If the group is not a repeat or forEach group, return null
		if (
			group.type !== GroupType.Repeat &&
			group.type !== GroupType.ForEach
		) {
			return null;
		}

		// Get the loop index from the group
		const loopIndex = group.currentLoop + 1;

		return loopIndex;
	}

	getVariableValues(includeGroupEdges: boolean): VariableValue[] {
		const variableValues: VariableValue[] = [];

		// Get all available provide edges
		let availableEdges = this.getAllAvailableProvideEdges();

		// If includeGroupEdges is not true, filter for only incoming edges of this node
		if (!includeGroupEdges) {
			availableEdges = availableEdges.filter((edge) =>
				this.incomingEdges.includes(edge.id)
			);
		}

		for (const edge of availableEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof CannoliEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a provide edge.`
				);
			}

			// If the edge isn't complete, (MAYBE DEPRECATED) check if its a rejected reflexive edge with content, if not, continue
			if (!(edgeObject.status === CannoliObjectStatus.Complete)) {
				if (
					!(edgeObject.status === CannoliObjectStatus.Rejected) ||
					!edgeObject.isReflexive ||
					!edgeObject.content
				) {
					continue;
				}
			}

			let content: string;

			if (!edgeObject.content) {
				continue;
			}

			if (typeof edgeObject.content === "string" && edgeObject.text) {
				content = edgeObject.content;

				const variableValue = {
					name: edgeObject.text,
					content: content,
					edgeId: edgeObject.id,
				};

				variableValues.push(variableValue);
			} else if (
				typeof edgeObject.content === "object" &&
				!Array.isArray(edgeObject.content)
			) {
				const multipleVariableValues = [];

				for (const name in edgeObject.content) {
					const variableValue = {
						name: name,
						content: edgeObject.content[name],
						edgeId: edgeObject.id,
					};

					multipleVariableValues.push(variableValue);
				}

				variableValues.push(...multipleVariableValues);
			} else {
				continue;
			}
		}

		// Add the default "NOTE" variable
		if (this.run.currentNote && includeGroupEdges) {
			const currentNoteVariableValue = {
				name: "NOTE",
				content: this.run.currentNote,
				edgeId: "",
			};

			variableValues.push(currentNoteVariableValue);
		}

		// Resolve variable conflicts
		const resolvedVariableValues =
			this.resolveVariableConflicts(variableValues);

		return resolvedVariableValues;
	}

	resolveVariableConflicts(variableValues: VariableValue[]): VariableValue[] {
		const finalVariables: VariableValue[] = [];
		const groupedByName: Record<string, VariableValue[]> = {};

		// Group the variable values by name
		for (const variable of variableValues) {
			if (!groupedByName[variable.name]) {
				groupedByName[variable.name] = [];
			}
			groupedByName[variable.name].push(variable);
		}

		// Iterate through the grouped names
		for (const name in groupedByName) {
			// Get all the variable values for this name
			const variables = groupedByName[name];

			let selectedVariable = variables[0]; // Start with the first variable

			// Iterate through the variables, preferring the reflexive edge if found
			for (const variable of variables) {
				const edgeObject = this.graph[variable.edgeId];

				// Check if edgeObject is an instance of CannoliEdge (or another specific subtype that has the isReflexive property)
				if (
					edgeObject instanceof CannoliEdge &&
					edgeObject.isReflexive
				) {
					selectedVariable = variable;
					break; // Exit the loop once a reflexive edge is found
				}
			}

			// Add the selected variable to the final array
			finalVariables.push(selectedVariable);
		}

		return finalVariables;
	}

	loadOutgoingEdges(content: string, request?: ChatCompletionCreateParams) {
		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge];
			if (
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

	dependencyCompleted(dependency: CannoliObject): void {
		if (
			this.allDependenciesComplete() &&
			this.status === CannoliObjectStatus.Pending
		) {
			this.execute();
		}
	}

	getNoteOrFloatingReference(): Reference | null {
		const notePattern = /^{{\[\[([^\]]+)\]\]([\W]*)}}$/;
		const floatingPattern = /^{{\[([^\]]+)\]}}$/;
		const currentNotePattern = /^{{NOTE([\W]*)}}$/;

		const strippedText = this.text.trim();

		let match = notePattern.exec(strippedText);
		if (match) {
			const reference: Reference = {
				name: match[1],
				type: ReferenceType.Note,
				shouldExtract: false,
			};

			const modifiers = match[2];
			if (modifiers) {
				if (modifiers.includes("!#")) {
					reference.includeName = false;
				} else if (modifiers.includes("#")) {
					reference.includeName = true;
				}

				if (modifiers.includes("!$")) {
					reference.includeProperties = false;
				} else if (modifiers.includes("$")) {
					reference.includeProperties = true;
				}
			}
			return reference;
		}

		match = floatingPattern.exec(strippedText);
		if (match) {
			const reference = {
				name: match[1],
				type: ReferenceType.Floating,
				shouldExtract: false,
			};
			return reference;
		}

		match = currentNotePattern.exec(strippedText);
		if (match && this.run.currentNote) {
			const reference: Reference = {
				name: this.run.currentNote,
				type: ReferenceType.Note,
				shouldExtract: false,
			};

			const modifiers = match[1];
			if (modifiers) {
				if (modifiers.includes("!#")) {
					reference.includeName = false;
				} else if (modifiers.includes("#")) {
					reference.includeName = true;
				}

				if (modifiers.includes("!$")) {
					reference.includeProperties = false;
				} else if (modifiers.includes("$")) {
					reference.includeProperties = true;
				}
			}
			return reference;
		}

		return null;
	}

	logDetails(): string {
		let groupsString = "";
		groupsString += `Groups: `;
		for (const group of this.groups) {
			groupsString += `\n\t-"${this.ensureStringLength(
				this.graph[group].text,
				15
			)}"`;
		}

		let incomingEdgesString = "";
		incomingEdgesString += `Incoming Edges: `;
		for (const edge of this.incomingEdges) {
			incomingEdgesString += `\n\t-"${this.ensureStringLength(
				this.graph[edge].text,
				15
			)}"`;
		}

		let outgoingEdgesString = "";
		outgoingEdgesString += `Outgoing Edges: `;
		for (const edge of this.outgoingEdges) {
			outgoingEdgesString += `\n\t-"${this.ensureStringLength(
				this.graph[edge].text,
				15
			)}"`;
		}

		return (
			`[] Node ${this.id} Text: "${this.text}"\n${incomingEdgesString}\n${outgoingEdgesString}\n${groupsString}\n` +
			super.logDetails()
		);
	}

	validate(): void {
		super.validate();

		// All special outgoing edges must be homogeneous
		if (!this.specialOutgoingEdgesAreHomogeneous()) {
			this.error(
				`If a call node has an outgoing variable edge, all outgoing variable edges must be of the same type. (Custom function edges are an exception.)`
			);
		}

		// If there are any incoming list edges, there must only be one
		if (
			this.incomingEdges.filter(
				(edge) => this.graph[edge].type === EdgeType.List
			).length > 1
		) {
			this.error(`Nodes can only have one incoming list edge.`);
		}
	}

	getSpecialOutgoingEdges(): CannoliEdge[] {
		// Get all special outgoing edges
		const specialOutgoingEdges = this.getOutgoingEdges().filter((edge) => {
			return (
				edge.type === EdgeType.Key ||
				edge.type === EdgeType.Choice ||
				edge.type === EdgeType.Category ||
				edge.type === EdgeType.Merge ||
				edge.type === EdgeType.List ||
				edge.type === EdgeType.Variable
			);
		});

		return specialOutgoingEdges;
	}

	specialOutgoingEdgesAreHomogeneous(): boolean {
		const specialOutgoingEdges = this.getSpecialOutgoingEdges();

		if (specialOutgoingEdges.length === 0) {
			return true;
		}

		const firstEdgeType = specialOutgoingEdges[0].type;

		for (const edge of specialOutgoingEdges) {
			if (edge.type !== firstEdgeType) {
				return false;
			}
		}

		return true;
	}

	getAllAvailableProvideEdges(): CannoliEdge[] {
		const availableEdges: CannoliEdge[] = [];

		// Get the incoming edges of all groups
		for (const group of this.groups) {
			const groupObject = this.graph[group];
			if (!(groupObject instanceof CannoliVertex)) {
				throw new Error(
					`Error on node ${this.id}: group is not a vertex.`
				);
			}

			const groupIncomingEdges = groupObject.getIncomingEdges();

			availableEdges.push(...groupIncomingEdges);
		}

		// Get the incoming edges of this node
		const nodeIncomingEdges = this.getIncomingEdges();

		availableEdges.push(...nodeIncomingEdges);

		// Filter out all logging, and write edges
		const filteredEdges = availableEdges.filter(
			(edge) =>
				edge.type !== EdgeType.Logging &&
				edge.type !== EdgeType.Write &&
				edge.type !== EdgeType.Config
		);

		return filteredEdges as CannoliEdge[];
	}
}

export class CallNode extends CannoliNode {
	getPrependedMessages(): ChatCompletionMessage[] {
		const messages: ChatCompletionMessage[] = [];

		// Get all available provide edges
		const availableEdges = this.getAllAvailableProvideEdges();

		// filter for only incoming edges of this node
		const directEdges = availableEdges.filter((edge) =>
			this.incomingEdges.includes(edge.id)
		);

		// Filter for indirect edges (not incoming edges of this node)
		const indirectEdges = availableEdges.filter(
			(edge) => !this.incomingEdges.includes(edge.id)
		);

		for (const edge of directEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof CannoliEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a provide edge.`
				);
			}

			const edgeMessages = edgeObject.messages;

			// console.log(
			// 	`Edge messages: ${JSON.stringify(edgeMessages, null, 2)}`
			// );

			if (!edgeMessages) {
				continue;
			}

			if (edgeMessages.length < 1) {
				continue;
			}

			// If the edge is crossing a group, check if there are any indirect edges pointing to that group
			for (const group of edgeObject.crossingInGroups) {
				const indirectEdgesToGroup = indirectEdges.filter(
					(edge) => edge.target === group
				);

				// Filter for those indirect edges that have addMessages = true
				const indirectEdgesToAdd = indirectEdgesToGroup.filter(
					(edge) =>
						this.graph[edge.id] instanceof CannoliEdge &&
						(this.graph[edge.id] as CannoliEdge).addMessages
				);

				// For each indirect edge
				for (const indirectEdge of indirectEdgesToAdd) {
					const indirectEdgeObject = this.graph[indirectEdge.id];
					if (!(indirectEdgeObject instanceof CannoliEdge)) {
						throw new Error(
							`Error on object ${indirectEdgeObject.id}: object is not a provide edge.`
						);
					}

					const indirectEdgeMessages = indirectEdgeObject.messages;

					if (!indirectEdgeMessages) {
						continue;
					}

					if (indirectEdgeMessages.length < 1) {
						continue;
					}

					// Overwrite edgeMessages with indirectEdgeMessages
					edgeMessages.length = 0;
					edgeMessages.push(...indirectEdgeMessages);
				}
			}

			if (edgeMessages) {
				// If its a system message, add it to the beginning of the array
				if (edge.type === EdgeType.SystemMessage) {
					messages.unshift(edgeMessages[0]);
				} else {
					messages.push(...edgeMessages);
				}
			}
		}

		// If messages is empty and there are no incoming edges with addMessages = true, try it with indirect edges
		if (
			messages.length === 0 &&
			this.incomingEdges.filter(
				(edge) =>
					this.cannoliGraph.isEdge(this.graph[edge]) &&
					(this.graph[edge] as CannoliEdge).addMessages
			).length === 0
		) {
			for (const edge of indirectEdges) {
				const edgeObject = this.graph[edge.id];
				if (!(edgeObject instanceof CannoliEdge)) {
					throw new Error(
						`Error on object ${edgeObject.id}: object is not a provide edge.`
					);
				}

				const edgeMessages = edgeObject.messages;

				if (!edgeMessages) {
					continue;
				}

				if (edgeMessages.length < 1) {
					continue;
				}

				if (edgeMessages) {
					// If its a system message, add it to the beginning of the array
					if (edge.type === EdgeType.SystemMessage) {
						messages.unshift(edgeMessages[0]);
					} else {
						messages.push(...edgeMessages);
					}
				}
			}
		}

		return messages;
	}

	async getNewMessage(role?: string): Promise<ChatCompletionMessage | null> {
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

	findNoteReferencesInMessages(messages: ChatCompletionMessage[]): string[] {
		const references: string[] = [];
		const noteRegex = /\[\[(.+?)\]\]/g;

		// Get the contents of each double bracket
		for (const message of messages) {
			const matches = message.content?.matchAll(noteRegex);

			if (!matches) {
				continue;
			}

			for (const match of matches) {
				references.push(match[1]);
			}
		}

		return references;
	}

	private getDefaultConfig(): OpenAIConfig {
		const config = JSON.parse(JSON.stringify(this.run.getDefaultConfig()));
		return config;
	}

	private updateConfigWithValue(
		runConfig: OpenAIConfig,
		content: string | Record<string, string> | null,
		setting?: string | null
	): void {
		// Sample object to validate keys against
		const sampleOpenAIConfig: OpenAIConfig = {
			model: "",
			frequency_penalty: undefined,
			presence_penalty: undefined,
			stop: undefined,
			function_call: undefined,
			functions: undefined,
			temperature: undefined,
			top_p: undefined,
			role: "user" || "assistant" || "system",
		};

		// Define the expected types for each key
		const keyTypeMap: {
			[key in keyof OpenAIConfig]?: "string" | "number";
		} = {
			frequency_penalty: "number",
			presence_penalty: "number",
			temperature: "number",
			top_p: "number",
		};

		// Convert value based on its expected type
		const convertValue = (key: keyof OpenAIConfig, value: string) => {
			const expectedType = keyTypeMap[key];
			return expectedType === "number" ? parseFloat(value) : value;
		};

		// Type guard to check if a string is a key of OpenAIConfig
		const isValidKey = (key: string): key is keyof OpenAIConfig => {
			return key in sampleOpenAIConfig;
		};

		if (typeof content === "string") {
			if (setting && isValidKey(setting)) {
				// Use isValidKey
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(runConfig as any)[setting] = convertValue(setting, content); // Using type assertion with conversion
			} else {
				this.error(`"${setting}" is not a valid config setting.`);
			}
		} else if (typeof content === "object") {
			for (const key in content) {
				if (isValidKey(key)) {
					// Use isValidKey
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(runConfig as any)[key] = convertValue(key, content[key]); // Using type assertion with conversion
				} else {
					this.error(`"${key}" is not a valid config setting.`);
				}
			}
		}
	}

	private processSingleEdge(
		runConfig: OpenAIConfig,
		edgeObject: CannoliEdge
	): void {
		if (
			typeof edgeObject.content === "string" ||
			typeof edgeObject.content === "object"
		) {
			this.updateConfigWithValue(
				runConfig,
				edgeObject.content,
				edgeObject.text
			);
		} else {
			this.error(`Config edge has invalid content.`);
		}
	}

	private processEdges(runConfig: OpenAIConfig, edges: CannoliEdge[]): void {
		for (const edgeObject of edges) {
			if (!(edgeObject instanceof CannoliEdge)) {
				throw new Error(
					`Error processing config edges: object is not an edge.`
				);
			}
			this.processSingleEdge(runConfig, edgeObject);
		}
	}

	private processGroups(runConfig: OpenAIConfig): void {
		for (let i = this.groups.length - 1; i >= 0; i--) {
			const group = this.graph[this.groups[i]];
			if (group instanceof CannoliGroup) {
				const configEdges = group
					.getIncomingEdges()
					.filter((edge) => edge.type === EdgeType.Config);
				this.processEdges(runConfig, configEdges);
			}
		}
	}

	private processNodes(runConfig: OpenAIConfig): void {
		const configEdges = this.getIncomingEdges().filter(
			(edge) => edge.type === EdgeType.Config
		);
		this.processEdges(runConfig, configEdges);
	}

	getConfig(): OpenAIConfig {
		const runConfig = this.getDefaultConfig();

		this.processGroups(runConfig);
		this.processNodes(runConfig);

		return runConfig;
	}

	async execute() {
		this.executing();

		const request = await this.createLLMRequest();

		// If the node has an outgoing chatResponse edge, call with streaming
		const chatResponseEdges = this.getOutgoingEdges().filter(
			(edge) => edge.type === EdgeType.ChatResponse
		);

		if (chatResponseEdges.length > 0) {
			request.stream = true;

			const stream = await this.run.callLLMStream(
				request as ChatCompletionCreateParamsStreaming
			);

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
				if (part instanceof Error) {
					this.error(`Error calling LLM:\n${part.message}`);
					return;
				}

				if (!part) {
					this.error(`Error calling LLM: no part returned.`);
					return;
				}

				// If the stream is done, break out of the loop
				if (part.choices[0].finish_reason) {
					// Load outgoing chatResponse edges with the message "END OF STREAM"
					for (const edge of chatResponseEdges) {
						edge.load({
							content: "END OF STREAM",
							request: request,
						});
					}

					continue;
				}

				// Add the part to the message content
				messageContent += part.choices[0].delta.content;

				// Load outgoing chatResponse edges with the part
				for (const edge of chatResponseEdges) {
					edge.load({
						content: part.choices[0].delta.content ?? "",
						request: request,
					});
				}
			}

			// Add an assistant message to the messages array of the request
			request.messages.push({
				role: "assistant",
				content: messageContent,
			});

			// After the stream is done, load the outgoing edges
			this.loadOutgoingEdges(messageContent, request);
		} else {
			delete request.stream;

			const message = (await this.run.callLLM(
				request as ChatCompletionCreateParamsNonStreaming
			)) as ChatCompletionMessage;

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
				if (message.function_call.name === "enter_note_name") {
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

	async createLLMRequest(): Promise<ChatCompletionCreateParams> {
		const config = this.getConfig();

		const messages = this.getPrependedMessages();

		const newMessage = await this.getNewMessage(config.role);

		// Remove the role from the config
		delete config.role;

		if (newMessage) {
			messages.push(newMessage);
		}

		const functions = this.getFunctions(messages);

		const function_call =
			functions && functions.length > 0
				? { name: functions[0].name }
				: undefined;

		return {
			messages: messages,
			...config,
			functions:
				functions && functions.length > 0 ? functions : undefined,
			function_call: function_call ? function_call : undefined,
		};
	}

	getFunctions(
		messages: ChatCompletionMessage[]
	): ChatCompletionCreateParams.Function[] {
		if (
			this.getOutgoingEdges().some(
				(edge) => edge.vaultModifier === VaultModifier.Note
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

export class DistributeNode extends CallNode {
	getFunctions(
		messages: ChatCompletionMessage[]
	): ChatCompletionCreateParams.Function[] {
		// Get the name of the list items
		const listItems = this.getListItems();

		const items: { name: string; noteNames?: string[] }[] = [];

		// If one of the outgoing edges has a vault modifier of type "note", get the note names and pass it into that list item
		const noteEdges = this.getOutgoingEdges().filter(
			(edge) => edge.vaultModifier === VaultModifier.Note
		);

		for (const item of listItems) {
			// If the item matches the name of one of the note edges
			if (noteEdges.find((edge) => edge.text === item)) {
				// Get the note names
				const noteNames = this.findNoteReferencesInMessages(messages);

				items.push({ name: item, noteNames: noteNames });
			} else {
				items.push({ name: item });
			}
		}

		// Generate the list function
		const listFunc = this.run.createListFunction(items);

		return [listFunc];
	}

	getListItems(): string[] {
		// Get the unique names of all outgoing listitem edges
		const outgoingListItemEdges = this.getOutgoingEdges().filter((edge) => {
			return edge.type === EdgeType.Key;
		});

		const uniqueNames = new Set<string>();

		for (const edge of outgoingListItemEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof CannoliEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a key edge.`
				);
			}

			const name = edgeObject.text;

			if (name) {
				uniqueNames.add(name);
			}
		}

		return Array.from(uniqueNames);
	}

	loadOutgoingEdges(
		content: string,
		request: ChatCompletionCreateParams
	): void {
		const messages = request.messages;

		// Get the list items from the last message
		const listFunctionArgs =
			messages[messages.length - 1].function_call?.arguments;

		if (!listFunctionArgs) {
			this.error(`List function call has no arguments.`);
			return;
		}

		// Parse the list items from the arguments
		const listItems = JSON.parse(listFunctionArgs);

		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge];
			if (edgeObject instanceof CannoliEdge) {
				// If the edge is a list item edge, load it with the content of the corresponding list item name
				if (
					edgeObject instanceof CannoliEdge &&
					edgeObject.type === EdgeType.Key
				) {
					const name = edgeObject.text;

					if (name) {
						const listItemContent = listItems[name];

						if (listItemContent) {
							edgeObject.load({
								content: listItemContent,
								request: request,
							});
						}
					}
				} else {
					edgeObject.load({
						content: listFunctionArgs,
						request: request,
					});
				}
			}
		}
	}

	logDetails(): string {
		return super.logDetails() + `Subtype: List\n`;
	}

	validate() {
		super.validate();
		// If there are no outgoing key edges, error

		if (
			!this.getOutgoingEdges().some((edge) => edge.type === EdgeType.Key)
		) {
			this.error(`List nodes must have at least one outgoing list edge.`);
		}
	}
}

export class AccumulateNode extends CallNode {
	logDetails(): string {
		return super.logDetails() + `Subtype: Accumulate\n`;
	}
}
export class ChooseNode extends CallNode {
	getFunctions(
		messages: ChatCompletionMessage[]
	): ChatCompletionCreateParams.Function[] {
		const choices = this.getBranchChoices();

		// Create choice function
		const choiceFunc = this.run.createChoiceFunction(choices);

		return [choiceFunc];
	}

	loadOutgoingEdges(
		content: string,
		request: ChatCompletionCreateParams
	): void {
		const messages = request.messages;

		// Get the chosen variable from the last message
		const choiceFunctionArgs =
			messages[messages.length - 1].function_call?.arguments;

		if (!choiceFunctionArgs) {
			this.error(`Choice function call has no arguments.`);
			return;
		}

		const parsedVariable = JSON.parse(choiceFunctionArgs);

		// Reject all unselected options
		this.rejectUnselectedOptions(parsedVariable.choice);

		super.loadOutgoingEdges(choiceFunctionArgs, request);
	}

	rejectUnselectedOptions(choice: string) {
		// Call reject on any outgoing edges that aren't the selected one
		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge];
			if (edgeObject.type === EdgeType.Choice) {
				const branchEdge = edgeObject as CannoliEdge;
				if (branchEdge.text !== choice) {
					branchEdge.reject();
				}
			}
		}
	}

	getBranchChoices(): string[] {
		// Get the unique names of all outgoing choice edges
		const outgoingChoiceEdges = this.getOutgoingEdges().filter((edge) => {
			return edge.type === EdgeType.Choice;
		});

		const uniqueNames = new Set<string>();

		for (const edge of outgoingChoiceEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof CannoliEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a branch edge.`
				);
			}

			const name = edgeObject.text;

			if (name) {
				uniqueNames.add(name);
			}
		}

		return Array.from(uniqueNames);
	}

	logDetails(): string {
		return super.logDetails() + `Subtype: Choice\n`;
	}

	validate() {
		super.validate();

		// If there are no branch edges, error
		if (
			!this.getOutgoingEdges().some(
				(edge) => edge.type === EdgeType.Choice
			)
		) {
			this.error(
				`Choice nodes must have at least one outgoing choice edge.`
			);
		}
	}
}

export class ContentNode extends CannoliNode {
	reset(): void {
		// If its a standard content node and it has incoming edges, reset the text and then call the super
		if (
			this.type === ContentNodeType.StandardContent &&
			this.incomingEdges.length > 0
		) {
			this.text = "";
		}

		super.reset();
	}

	async execute(): Promise<void> {
		this.executing();

		let content = this.getWriteOrLoggingContent();

		if (!content) {
			const variableValues = this.getVariableValues(false);

			// Get first variable value
			if (variableValues.length > 0) {
				content = variableValues[0].content || "";
			} else {
				content = "";
			}
		}

		if (content !== null && content !== undefined && content !== "") {
			this.text = content;
		} else {
			content = await this.processReferences();
		}

		// Load all outgoing edges
		this.loadOutgoingEdges(content);

		this.completed();
	}

	dependencyCompleted(dependency: CannoliObject): void {
		// If the dependency is a logging edge not crossing out of a forEach group or a chatResponse edge, execute regardless of this node's status
		if (
			(dependency instanceof LoggingEdge &&
				!dependency.crossingOutGroups.some((group) => {
					const groupObject = this.graph[group];
					if (!(groupObject instanceof CannoliGroup)) {
						throw new Error(
							`Error on object ${groupObject.id}: object is not a group.`
						);
					}
					return groupObject.type === GroupType.ForEach;
				})) ||
			dependency instanceof ChatResponseEdge
		) {
			this.execute();
		} else if (
			this.allDependenciesComplete() &&
			this.status === CannoliObjectStatus.Pending
		) {
			this.execute();
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Content\n`;
	}

	getWriteOrLoggingContent(): string | null {
		// Get all incoming edges
		const incomingEdges = this.getIncomingEdges();

		// If there are multiple logging edges
		if (
			incomingEdges.filter((edge) => edge.type === EdgeType.Logging)
				.length > 1
		) {
			// Append the content of all logging edges
			let content = "";
			for (const edge of incomingEdges) {
				const edgeObject = this.graph[edge.id];
				if (edgeObject instanceof LoggingEdge) {
					if (edgeObject.content) {
						content += edgeObject.content;
					}
				}
			}

			return content;
		}

		// Filter out all non-write, non-logging, non-chatResponse edges, as well as any edges that aren't complete
		const filteredEdges = incomingEdges.filter(
			(edge) =>
				(edge.type === EdgeType.Write ||
					edge.type === EdgeType.Logging ||
					edge.type === EdgeType.ChatResponse) &&
				this.graph[edge.id].status === CannoliObjectStatus.Complete
		);

		if (filteredEdges.length === 0) {
			return null;
		}

		// If there are write or logging edges, return the content of the first one
		const firstEdge = filteredEdges[0];
		const firstEdgeObject = this.graph[firstEdge.id];
		if (firstEdgeObject instanceof CannoliEdge) {
			if (
				firstEdgeObject.content &&
				typeof firstEdgeObject.content === "string"
			) {
				return firstEdgeObject.content;
			}
		} else {
			throw new Error(
				`Error on object ${firstEdgeObject.id}: object is not an edge.`
			);
		}

		return null;
	}

	validate(): void {
		super.validate();

		// // There must not be more than one incoming edge of type write
		// if (
		// 	this.getIncomingEdges().filter(
		// 		(edge) => edge.type === EdgeType.Write
		// 	).length > 1
		// ) {
		// 	this.error(`Content nodes can only have one incoming write edge.`);
		// }

		// If there are more than one incoming edges and its a standard content node, there must only be one non-config edge
		// if (
		// 	this.type === ContentNodeType.StandardConent &&
		// 	this.getIncomingEdges().filter(
		// 		(edge) => edge.type !== EdgeType.Config
		// 	).length > 1
		// ) {
		// 	this.error(
		// 		`Standard content nodes can only have one incoming edge that is not of type config.`
		// 	);
		// }

		// Content nodes must not have any outgoing edges of type ListItem, List, Category, Select, Branch, or Function
		if (
			this.getOutgoingEdges().some(
				(edge) =>
					edge.type === EdgeType.List ||
					edge.type === EdgeType.Category ||
					edge.type === EdgeType.Function ||
					edge.type === EdgeType.Choice ||
					edge.type === EdgeType.Logging
			)
		) {
			this.error(
				`Content nodes cannot have any outgoing list, choice, or function edges.`
			);
		}
	}
}

export class ReferenceNode extends ContentNode {
	reference: Reference;
	isDynamic: boolean;

	constructor(
		nodeData:
			| VerifiedCannoliCanvasTextData
			| VerifiedCannoliCanvasLinkData
			| VerifiedCannoliCanvasFileData
	) {
		super(nodeData);

		if (this.references.length !== 1) {
			this.error(`Could not find reference.`);
		} else {
			this.reference = this.references[0];
		}

		// If the text matches "{{@variable name}}" then it is dynamic
		this.isDynamic = this.text.match(/{{@.*}}/) !== null;
	}

	async execute(): Promise<void> {
		this.executing();

		if (this.isDynamic) {
			await this.loadDynamicReference();
		}

		let content = "";

		const writeOrLoggingContent = this.getWriteOrLoggingContent();

		const variableValues = this.getVariableValues(false);

		if (variableValues.length > 0) {
			// If the variable value's id has a vaultModifier of note, createNote, folder, or createFolder, ignore it
			// First, get the edges of the variable values
			const variableValueEdges = variableValues.map((variableValue) => {
				return this.graph[variableValue.edgeId] as CannoliEdge;
			});

			// Then, filter out the edges that have a vaultModifier of note, createNote, folder, or createFolder
			const filteredVariableValueEdges = variableValueEdges.filter(
				(variableValueEdge) => {
					return (
						variableValueEdge.vaultModifier !==
							VaultModifier.Note &&
						variableValueEdge.vaultModifier !==
							VaultModifier.CreateNote &&
						variableValueEdge.vaultModifier !==
							VaultModifier.Folder &&
						variableValueEdge.vaultModifier !==
							VaultModifier.CreateFolder
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
			} else if (writeOrLoggingContent) {
				content = writeOrLoggingContent;
			}
		} else if (writeOrLoggingContent) {
			content = writeOrLoggingContent;
		}

		if (content) {
			// Append is dependent on if there is an incoming edge of type ChatResponse
			const append = this.getIncomingEdges().some(
				(edge) => edge.type === EdgeType.ChatResponse
			);

			await this.editContent(content, append);
		}

		const fetchedContent = await this.getContent();

		// Load all outgoing edges
		await this.loadOutgoingEdges(fetchedContent);

		this.completed();
	}

	async getContent(): Promise<string> {
		if (this.reference) {
			if (this.reference.type === ReferenceType.Note) {
				const content = await this.getContentFromNote(this.reference);
				if (content) {
					return content;
				} else {
					this.error(
						`Invalid reference. Could not find note "${this.reference.name}"`
					);
				}
			} else {
				const content = this.getContentFromFloatingNode(
					this.reference.name
				);
				if (content) {
					return content;
				} else {
					this.error(
						`Invalid reference. Could not find floating node "${this.reference.name}"`
					);
				}
			}
		}

		return `Could not find reference.`;
	}

	async loadDynamicReference() {
		// Search the incoming edges for any that have a vault modifier of type "note" or "create note"
		const incomingEdges = this.getIncomingEdges();
		const vaultModifierEdges = incomingEdges.filter(
			(edge) => edge.vaultModifier !== null
		);

		if (vaultModifierEdges.length > 0) {
			// Find the edges with the vault modifier of "note" or "create note"
			const noteVaultModifierEdges = vaultModifierEdges.filter(
				(edge) =>
					edge.vaultModifier === VaultModifier.Note ||
					edge.vaultModifier === VaultModifier.CreateNote
			);

			// Find the edges with the vault modifier of "folder" or "create folder"
			const folderVaultModifierEdges = vaultModifierEdges.filter(
				(edge) =>
					edge.vaultModifier === VaultModifier.Folder ||
					edge.vaultModifier === VaultModifier.CreateFolder
			);

			// If there's more than one of either, throw an error
			if (noteVaultModifierEdges.length > 1) {
				this.error(
					`Invalid reference node. More than one incoming edge with a vault modifier of "note" or "create note".`
				);
			}

			if (folderVaultModifierEdges.length > 1) {
				this.error(
					`Invalid reference node. More than one incoming edge with a vault modifier of "folder" or "create folder".`
				);
			}

			let noteName = {
				name: "",
				create: false,
			};
			let path = {
				path: "",
				create: false,
			};

			// If there's a note vault modifier edge, use that to get the note name and whether or not to create it
			if (noteVaultModifierEdges.length === 1) {
				const noteVaultModifierEdge = noteVaultModifierEdges[0];

				noteName = {
					name:
						typeof noteVaultModifierEdge.content === "string"
							? noteVaultModifierEdge.content
							: "",
					create:
						noteVaultModifierEdge.vaultModifier ===
						VaultModifier.CreateNote,
				};
			}

			// If there's a folder vault modifier edge, use that to get the path and whether or not to create it
			if (folderVaultModifierEdges.length === 1) {
				const folderVaultModifierEdge = folderVaultModifierEdges[0];
				path = {
					path:
						typeof folderVaultModifierEdge.content === "string"
							? folderVaultModifierEdge.content
							: "",
					create:
						folderVaultModifierEdge.vaultModifier ===
						VaultModifier.CreateFolder,
				};
			}

			// Use the noteName and path variables to decide between the functions: createNoteAtExistingPath, createNoteAtNewPath, createFolder, moveNote
			if (noteName.name && path.path) {
				if (noteName.create && path.create) {
					await this.run.createNoteAtNewPath(
						noteName.name,
						path.path
					);
				} else if (noteName.create && !path.create) {
					await this.run.createNoteAtExistingPath(
						noteName.name,
						path.path
					);
				} else if (!noteName.create && path.create) {
					await this.run.createFolder(path.path);
					await this.run.moveNote(noteName.name, path.path);
				} else {
					await this.run.moveNote(noteName.name, path.path, false);
				}
			} else if (noteName.name && !path.path) {
				if (noteName.create) {
					// Create it at the root
					await this.run.createNoteAtExistingPath(noteName.name);
				}
			} else if (!noteName.name && path.path) {
				if (path.create) {
					await this.run.createFolder(path.path);
				}
			}

			// If noteName isn't empty, create a Reference object with the note
			if (noteName.name) {
				this.reference.name = noteName.name;
				this.reference.type = ReferenceType.Note;
				this.reference.shouldExtract = false;
			}
		}
	}

	async editContent(newContent: string, append?: boolean): Promise<void> {
		if (this.reference) {
			if (this.reference.type === ReferenceType.Note) {
				const edit = await this.run.editNote(
					this.reference,
					newContent,
					append
				);

				if (edit !== null) {
					return;
				} else {
					this.error(
						`Invalid reference. Could not edit note ${this.reference.name}`
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
						object.editContent(newContent);
						return;
					}
				}

				this.error(
					`Invalid reference. Could not find floating node ${this.reference.name}`
				);
			}
		}
	}

	async loadOutgoingEdges(
		content: string,
		request?: ChatCompletionCreateParams | undefined
	) {
		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge];
			if (!(edgeObject instanceof CannoliEdge)) {
				continue;
			}

			if (edgeObject.type === EdgeType.Key) {
				// Get value of the property with the same name as the edge
				const value = await this.run.getPropertyOfNote(
					this.reference.name,
					edgeObject.text
				);

				if (value) {
					edgeObject.load({
						content: value ?? "",
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

	validate(): void {
		super.validate();

		// // Reference nodes cant have incoming edges of type category, list, or function
		// if (
		// 	this.getIncomingEdges().some(
		// 		(edge) =>
		// 			edge.type === EdgeType.Category ||
		// 			edge.type === EdgeType.List ||
		// 			edge.type === EdgeType.Function
		// 	)
		// ) {
		// 	this.error(
		// 		`Reference nodes cannot have incoming category, list, or function edges.`
		// 	);
		// }

		// // If there are more than one incoming edges, there must only be one non-config edge
		// if (
		// 	this.getIncomingEdges().filter(
		// 		(edge) => edge.type !== EdgeType.Config
		// 	).length > 1
		// ) {
		// 	this.error(
		// 		`Reference nodes can only have one incoming edge that is not of type config.`
		// 	);
		// }
	}
}

export class HttpNode extends ContentNode {
	logDetails(): string {
		return super.logDetails() + `Subtype: Http\n`;
	}

	async execute(): Promise<void> {
		this.executing();

		let content: string | Record<string, string> | null =
			this.getWriteOrLoggingContent();

		if (!content) {
			const variableValues = this.getVariableValues(false);

			// If there are variable values, make a record of them and set it to content
			if (variableValues.length > 0) {
				content = {};
				for (const variableValue of variableValues) {
					content[variableValue.name] = variableValue.content || "";
				}
			}
		}

		let template: string | null = null;

		// Check if the text matches the name of a floating node
		for (const objectId in this.graph) {
			const object = this.graph[objectId];
			if (
				object instanceof FloatingNode &&
				object.getName() === this.text
			) {
				template = object.text;
			}
		}

		let result: string | Error;

		// If there's a template, call executeTemplateFromFloatingNode
		if (template) {
			result = await this.run.executeHttpTemplateFromFloatingNode(
				template,
				content
			);
		} else {
			// Make the request
			result = await this.run.executeHttpTemplateByName(
				this.text,
				content
			);
		}

		if (result instanceof Error) {
			this.error(result.message);
			return;
		}

		if (typeof result === "string") {
			this.loadOutgoingEdges(result);
		}

		this.completed();
	}
}

export class FormatterNode extends ContentNode {
	logDetails(): string {
		return super.logDetails() + `Subtype: Formatter\n`;
	}

	async execute(): Promise<void> {
		this.executing();

		const content = await this.processReferences();

		// Take off the first 2 and last 2 characters (the double double quotes)
		const processedContent = content.slice(2, -2);

		// Load all outgoing edges
		this.loadOutgoingEdges(processedContent);

		this.completed();
	}
}

export class FloatingNode extends CannoliNode {
	constructor(
		nodeData:
			| VerifiedCannoliCanvasTextData
			| VerifiedCannoliCanvasLinkData
			| VerifiedCannoliCanvasFileData
	) {
		super(nodeData);
		this.status = CannoliObjectStatus.Complete;
	}

	dependencyCompleted(dependency: CannoliObject): void {
		return;
	}

	dependencyRejected(dependency: CannoliObject): void {
		return;
	}

	async execute() {
		this.completed();
	}

	getName(): string {
		const firstLine = this.text.split("\n")[0].trim();
		// Take the first and last characters off the first line
		return firstLine.substring(1, firstLine.length - 1);
	}

	// Content is everything after the first line
	getContent(): string {
		const firstLine = this.text.split("\n")[0];
		return this.text.substring(firstLine.length + 1);
	}

	editContent(newContent: string): void {
		const firstLine = this.text.split("\n")[0];
		this.text = `${firstLine}\n${newContent}`;

		const event = new CustomEvent("update", {
			detail: { obj: this, status: this.status },
		});
		this.dispatchEvent(event);
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: Floating\nName: ${this.getName()}\nContent: ${this.getContent()}\n`
		);
	}
}
