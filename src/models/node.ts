import { CannoliObject, CannoliVertex } from "./object";
import { type OpenAIConfig } from "src/run";
import { CannoliEdge, LoggingEdge } from "./edge";
import {
	ChatCompletionFunctions,
	ChatCompletionRequestMessage,
	CreateChatCompletionRequest,
} from "openai";
import { CannoliGroup } from "./group";
import {
	CannoliObjectStatus,
	EdgeType,
	Reference,
	ReferenceType,
	VerifiedCannoliCanvasFileData,
	VerifiedCannoliCanvasLinkData,
	VerifiedCannoliCanvasTextData,
} from "./graph";

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
		console.log(JSON.stringify(this.references, null, 2));
		this.renderFunction = this.buildRenderFunction();
	}

	buildRenderFunction() {
		// Replace references with placeholders using an index-based system
		let textCopy = this.text;
		let index = 0;
		textCopy = textCopy.replace(/{.+?}/g, () => `{${index++}}`);

		// Define and return the render function
		const renderFunction = async (
			variables: { name: string; content: string }[]
		) => {
			// Create a map to look up variable content by name
			const varMap = new Map(variables.map((v) => [v.name, v.content]));
			// Replace the indexed placeholders with the content from the variables
			return textCopy.replace(/\{(\d+)\}/g, (match, index) => {
				// Retrieve the reference by index
				const reference = this.references[Number(index)];
				// Retrieve the content from the varMap using the reference's name
				return varMap.get(reference.name) || "{invalid reference}";
			});
		};

		return renderFunction;
	}

	async getContentFromNote(name: string): Promise<string> {
		const note = await this.run.getNote(name);

		if (!note) {
			this.error(`Note ${name} not found`);
			return "";
		}

		return note;
	}

	getContentFromFloatingNode(name: string): string {
		for (const object of Object.values(this.graph)) {
			if (object instanceof FloatingNode && object.getName() === name) {
				return object.getContent();
			}
		}
		throw new Error(`Floating node ${name} not found`);
	}

	async processReferences() {
		const variableValues = this.getVariableValues(true);

		const resolvedReferences = await Promise.all(
			this.references.map(async (reference) => {
				let content = "{invalid reference}";
				const { name } = reference;

				if (
					reference.type === ReferenceType.Variable &&
					!reference.shouldExtract
				) {
					const variable = variableValues.find(
						(variable) => variable.name === reference.name
					);
					content = variable
						? variable.content
						: `{${reference.name}}`;
				} else if (
					reference.type === ReferenceType.Variable &&
					reference.shouldExtract
				) {
					const variable = variableValues.find(
						(variable) => variable.name === reference.name
					);
					if (variable && variable.content) {
						content = await this.getContentFromNote(
							variable.content
						);
					} else {
						content = `{{${reference.name}}}`;
					}
				} else if (reference.type === ReferenceType.Note) {
					content = reference.shouldExtract
						? await this.getContentFromNote(reference.name)
						: `{[[${reference.name}]]}`;
				} else if (reference.type === ReferenceType.Floating) {
					content = reference.shouldExtract
						? this.getContentFromFloatingNode(reference.name)
						: `{[${reference.name}]}`;
				}

				return { name, content };
			})
		);

		return this.renderFunction(resolvedReferences);
	}

	getVariableValues(includeGroupEdges: boolean): VariableValue[] {
		const variableValues: VariableValue[] = [];

		// Get all available provide edges
		const availableEdges = this.getAllAvailableProvideEdges();

		// If includeGroupEdges is not true, filter for only incoming edges of this node
		if (!includeGroupEdges) {
			availableEdges.filter((edge) =>
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

	loadOutgoingEdges(
		content: string,
		messages: ChatCompletionRequestMessage[]
	) {
		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge];
			if (edgeObject instanceof CannoliEdge) {
				edgeObject.load({
					content: content,
					messages: messages,
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
		const notePattern = /^>\[\[([^\]]+)\]\]$/;
		const floatingPattern = /^>\[([^\]]+)\]$/;

		const strippedText = this.text.trim();

		let match = strippedText.match(notePattern);
		if (match) {
			return {
				name: match[1],
				type: ReferenceType.Note,
				shouldExtract: false,
			};
		}

		match = strippedText.match(floatingPattern);
		if (match) {
			return {
				name: match[1],
				type: ReferenceType.Floating,
				shouldExtract: false,
			};
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
	getPrependedMessages(): ChatCompletionRequestMessage[] {
		const messages: ChatCompletionRequestMessage[] = [];

		// Get all available provide edges
		const availableEdges = this.getAllAvailableProvideEdges();

		for (const edge of availableEdges) {
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

		return messages;
	}

	async getNewMessage(): Promise<ChatCompletionRequestMessage> {
		const content = await this.processReferences();

		return {
			role: "user",
			content: content,
		};
	}

	private getDefaultConfig(): OpenAIConfig {
		const config = this.run.getDefaultConfig();
		return config;
	}

	private updateConfigWithValue(
		runConfig: OpenAIConfig,
		content: string | Record<string, string> | null,
		setting?: string | null
	): void {
		const isValidKey = (key: string, config: OpenAIConfig) =>
			Object.prototype.hasOwnProperty.call(config, key);

		if (typeof content === "string") {
			if (setting && isValidKey(setting, runConfig)) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(runConfig as any)[setting] = content; // Using type assertion
			} else {
				this.error(`"${setting}" is not a valid config setting.`);
			}
		} else if (typeof content === "object") {
			for (const key in content) {
				if (isValidKey(key, runConfig)) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(runConfig as any)[key] = content[key]; // Using type assertion
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

		const message = (await this.run.callLLM(
			request,
			true
		)) as ChatCompletionRequestMessage;

		if (message instanceof Error) {
			this.error(`Error calling LLM:\n${message.message}`);
			return;
		}

		if (!message) {
			this.error(`Error calling LLM: no message returned.`);
			return;
		}

		// Append the message to the end of the request messages
		const messages = request.messages;

		messages.push(message);

		this.loadOutgoingLoggingEdges(request);

		this.loadOutgoingEdges(message.content ?? "", messages);

		this.completed();
	}

	async createLLMRequest(): Promise<CreateChatCompletionRequest> {
		const config = this.getConfig();

		const messages = this.getPrependedMessages();

		const newMessage = await this.getNewMessage();

		messages.push(newMessage);

		const functions = this.getFunctions();

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

	loadOutgoingLoggingEdges(request: CreateChatCompletionRequest) {
		const loggingEdges = this.getOutgoingEdges().filter(
			(edge) => edge.type === EdgeType.Logging
		);

		let configString = "";

		// Loop through all the properties of the request except for messages, and if they aren't undefined add them to the config string formatted nicely
		for (const key in request) {
			if (key !== "messages" && request[key as keyof typeof request]) {
				configString += `${key}: ${
					request[key as keyof typeof request]
				}\n`;
			}
		}

		for (const edge of loggingEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof LoggingEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a logging edge.`
				);
			} else {
				console.log(
					`Loading logging edge with config:\n${configString}`
				);
				edgeObject.content = configString;
			}
		}
	}

	getFunctions(): ChatCompletionFunctions[] {
		return [];
	}

	logDetails(): string {
		return super.logDetails() + `Type: Call\n`;
	}

	validate() {
		super.validate();
	}
}

export class DistributeNode extends CallNode {
	getFunctions(): ChatCompletionFunctions[] {
		// Get the name of the list items
		const listItems = this.getListItems();

		// Generate the list function
		const listFunc = this.run.createListFunction(listItems);

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
		messages: ChatCompletionRequestMessage[]
	): void {
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
								messages: messages,
							});
						}
					}
				} else {
					edgeObject.load({
						content: content,
						messages: messages,
					});
				}
			}
		}
	}

	// setSpecialType() {
	// 	// If there are any outgoing list item edges, it's a list item node
	// 	if (
	// 		this.getSpecialOutgoingEdges().some(
	// 			(edge) => edge.type === EdgeType.ListItem
	// 		)
	// 	) {
	// 		this.listNodeType = ListNodeType.ListItem;
	// 	} else {
	// 		this.listNodeType = ListNodeType.List;
	// 	}
	// }

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

export class ChooseNode extends CallNode {
	getFunctions(): ChatCompletionFunctions[] {
		const choices = this.getBranchChoices();

		// Create choice function
		const choiceFunc = this.run.createChoiceFunction(choices);

		return [choiceFunc];
	}

	loadOutgoingEdges(
		content: string,
		messages: ChatCompletionRequestMessage[]
	): void {
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

		super.loadOutgoingEdges(content, messages);
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
	logDetails(): string {
		return super.logDetails() + `Type: Content\n`;
	}

	getWriteOrLoggingContent(): string | null {
		// Get all incoming edges
		const incomingEdges = this.getIncomingEdges();

		// Filter out all non-write and non-logging edges
		const filteredEdges = incomingEdges.filter(
			(edge) =>
				edge.type === EdgeType.Write || edge.type === EdgeType.Logging
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

		// // Content nodes must not have any outgoing edges of type ListItem, List, Category, Select, Branch, or Function
		// if (
		// 	this.getOutgoingEdges().some(
		// 		(edge) =>
		// 			edge.type === EdgeType.ListItem ||
		// 			edge.type === EdgeType.List ||
		// 			edge.type === EdgeType.Category ||
		// 			edge.type === EdgeType.Select ||
		// 			edge.type === EdgeType.Branch ||
		// 			edge.type === EdgeType.Function
		// 	)
		// ) {
		// 	this.error(
		// 		`Content nodes cannot have any outgoing list, choice, or function edges.`
		// 	);
		// }
	}
}

export class ReferenceNode extends ContentNode {
	reference: Reference;

	constructor(
		nodeData:
			| VerifiedCannoliCanvasTextData
			| VerifiedCannoliCanvasLinkData
			| VerifiedCannoliCanvasFileData
	) {
		super(nodeData);

		const reference = this.getNoteOrFloatingReference();

		if (reference === null) {
			throw new Error(
				`Error on reference node ${this.id}: could not find reference.`
			);
		} else {
			this.reference = reference;
		}
	}

	async execute(): Promise<void> {
		this.executing();

		const writeOrLoggingContent = this.getWriteOrLoggingContent();
		const variableValues = this.getVariableValues(false);

		let content = "";
		if (variableValues.length > 0) {
			content = variableValues[0].content || "";
		} else if (writeOrLoggingContent) {
			content = writeOrLoggingContent;
		}

		if (content) {
			this.editContent(content);
		}

		const fetchedContent = await this.getContent();

		// Load all outgoing edges
		this.loadOutgoingEdges(fetchedContent, []);

		this.completed();
	}

	async getContent(): Promise<string> {
		if (this.reference.type === ReferenceType.Note) {
			return this.getContentFromNote(this.reference.name);
		} else {
			// Search through all nodes for a floating node with the correct name
			for (const objectId in this.graph) {
				const object = this.graph[objectId];
				if (
					object instanceof FloatingNode &&
					object.getName() === this.reference.name
				) {
					return object.getContent();
				}
			}
		}

		return `Could not find reference ${this.reference.name}`;
	}

	async editContent(newContent: string): Promise<void> {
		if (this.reference.type === ReferenceType.Note) {
			const edit = await this.run.editNote(
				this.reference.name,
				newContent
			);

			if (edit !== null) {
				return;
			} else {
				this.error(`Could not edit note ${this.reference.name}`);
			}
		} else {
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
		}
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Subtype: Reference\nReference name: ${this.reference.name}\n`
		);
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

export class DynamicReferenceNode extends ReferenceNode {}

export class FormatterNode extends ContentNode {
	logDetails(): string {
		return super.logDetails() + `Subtype: Formatter\n`;
	}

	async execute(): Promise<void> {
		this.executing();

		const content = await this.processReferences();

		// Take off the first and last characters (the backticks)
		const processedContent = content.slice(1, -1);

		// Load all outgoing edges
		this.loadOutgoingEdges(processedContent, []);

		this.completed();
	}
}

export class InputNode extends CannoliNode {
	logDetails(): string {
		return super.logDetails() + `Subtype: Input\n`;
	}

	async execute(): Promise<void> {
		this.executing();

		// Load all outgoing edges
		this.loadOutgoingEdges(this.text, []);

		this.completed();
	}
}

export class DisplayNode extends ContentNode {
	logDetails(): string {
		return super.logDetails() + `Subtype: Display\n`;
	}

	validate(): void {
		super.validate();

		// If there are more than one incoming edges, there must only be one non-config edge
		if (
			this.getIncomingEdges().filter(
				(edge) => edge.type !== EdgeType.Config
			).length > 1
		) {
			this.error(
				`Reference nodes can only have one incoming edge that is not of type config.`
			);
		}

		// Display nodes cant have incoming edges of type category, list, or function
		if (
			this.getIncomingEdges().some(
				(edge) =>
					edge.type === EdgeType.Category ||
					edge.type === EdgeType.List ||
					edge.type === EdgeType.Function
			)
		) {
			this.error(
				`Display nodes cannot have incoming category, list, or function edges.`
			);
		}
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

		// If the incoming edge is a logging edge, append the content to this node's text rather than replacing it
		if (
			this.getIncomingEdges().some(
				(edge) => edge.type === EdgeType.Logging
			)
		) {
			this.text += (this.text.length > 0 ? "\n" : "") + content;
		} else {
			this.text = content;
		}

		// Load all outgoing edges
		this.loadOutgoingEdges(content, []);

		this.completed();
	}

	dependencyCompleted(dependency: CannoliObject): void {
		// If the dependency is a logging edge, execute regardless of this node's status
		if (dependency instanceof LoggingEdge) {
			this.execute();
		} else if (
			this.allDependenciesComplete() &&
			this.status === CannoliObjectStatus.Pending
		) {
			this.execute();
		}
	}

	reset(): void {
		super.reset();
		this.text = "";
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

		// Emit an update event
		this.emit("update", this, this.status);
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: Floating\nName: ${this.getName()}\nContent: ${this.getContent()}\n`
		);
	}
}
