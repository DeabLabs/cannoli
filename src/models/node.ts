import { AllCanvasNodeData } from "obsidian/canvas";
import {
	CannoliObject,
	CannoliObjectKind,
	CannoliObjectStatus,
	CannoliVertex,
	EdgeType,
	GroupType,
	IndicatedEdgeType,
	IndicatedGroupType,
	IndicatedNodeType,
	NodeType,
	Reference,
	ReferenceType,
} from "./object";
import { isValidKey, type OpenAIConfig, type Run } from "src/run";
import {
	BranchEdge,
	CannoliEdge,
	ConfigEdge,
	LoggingEdge,
	ProvideEdge,
	SingleVariableEdge,
} from "./edge";
import {
	ChatCompletionFunctions,
	ChatCompletionRequestMessage,
	CreateChatCompletionRequest,
} from "openai";
import { CannoliGroup } from "./group";

type VariableValue = { name: string; content: string; edgeId: string };

export class CannoliNode extends CannoliVertex {
	NodePrefixMap: Record<string, IndicatedNodeType> = {
		$: IndicatedNodeType.Call,
	};

	NodeColorMap: Record<string, IndicatedNodeType> = {
		"0": IndicatedNodeType.Call,
		"1": IndicatedNodeType.Call,
		"3": IndicatedNodeType.Call,
		"4": IndicatedNodeType.Call,
		"6": IndicatedNodeType.Content,
	};

	references: Reference[] = [];
	renderFunction: (
		variables: { name: string; content: string }[]
	) => Promise<string>;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges?: string[],
		incomingEdges?: string[],
		groups?: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
		incomingEdges = incomingEdges || [];
		outgoingEdges = outgoingEdges || [];
		groups = groups || [];

		this.kind = CannoliObjectKind.Node;
	}

	parseReferencesInText(): {
		references: Reference[];
		renderFunction: (
			variables: { name: string; content: string }[]
		) => Promise<string>;
	} {
		const regex = /\{\[\[(.+?)\]\]\}|\{\[(.+?)\]\}|{{(.+?)}}|{(.+?)}/g;
		let match: RegExpExecArray | null;
		const references: Reference[] = [];
		let textCopy = this.text;

		while ((match = regex.exec(textCopy)) !== null) {
			let name = "";
			let type: ReferenceType = ReferenceType.Variable;
			let shouldExtract = false;

			if (match[1]) {
				type = ReferenceType.Note;
				name = match[1];
				shouldExtract = true;
			} else if (match[2]) {
				type = ReferenceType.Floating;
				name = match[2];
				shouldExtract = true;
			} else if (match[3] || match[4]) {
				name = match[3] || match[4];
				shouldExtract = !!match[3];
			}

			const reference: Reference = {
				name,
				type,
				shouldExtract,
			};
			references.push(reference);
			textCopy = textCopy.replace(match[0], `{${references.length - 1}}`);
		}

		const renderFunction = async (
			variables: { name: string; content: string }[]
		) => {
			const varMap = new Map(variables.map((v) => [v.name, v.content]));
			return textCopy.replace(/\{(\d+)\}/g, (match, index) => {
				const reference = references[Number(index)];
				return varMap.get(reference.name) || "{invalid reference}";
			});
		};

		return { references, renderFunction };
	}

	async getContentFromNote(name: string): Promise<string> {
		console.log(`Getting content from note: ${name}`);

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
		const variableValues = this.getVariableValues();

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

	getVariableValues(): VariableValue[] {
		const variableValues: VariableValue[] = [];

		// Get all available provide edges
		const availableEdges = this.getAllAvailableProvideEdges();

		for (const edge of availableEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof ProvideEdge)) {
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
				content = "";
			}

			if (typeof edgeObject.content === "string" && edgeObject.name) {
				content = edgeObject.content;

				const variableValue = {
					name: edgeObject.name,
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
					content:
						content && content.length > 0 ? content : undefined,
					messages:
						messages && messages.length > 0 ? messages : undefined,
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

	getIndicatedType():
		| IndicatedEdgeType
		| IndicatedNodeType
		| IndicatedGroupType {
		// If the node has no incoming or outgoing edges
		if (
			this.incomingEdges.length === 0 &&
			this.outgoingEdges.length === 0
		) {
			// Check the first line of its text
			const firstLine = this.text.split("\n")[0].trim();
			// If it starts with [ and ends with ], it's a floating node
			if (firstLine.startsWith("[") && firstLine.endsWith("]")) {
				return IndicatedNodeType.Floating;
			} else {
				return IndicatedNodeType.NonLogic;
			}
		}

		// If the node's type in the canvas data is "file", its a reference node, so return Content regardless of the first line or color
		if (this.canvasData.type === "file") {
			return IndicatedNodeType.Content;
		}

		// Check if the first line is a single character, and if it's in the prefix map
		const firstLine = this.text.split("\n")[0];
		if (firstLine.length === 1 && firstLine in this.NodePrefixMap) {
			return this.NodePrefixMap[firstLine];
		}

		// If not, check the color map
		const color = this.canvasData.color;
		if (color) {
			if (color in this.NodeColorMap) {
				return this.NodeColorMap[color];
			} else {
				return IndicatedNodeType.NonLogic;
			}
		} else {
			return IndicatedNodeType.Call;
		}
	}

	decideType(): EdgeType | NodeType | GroupType {
		switch (this.getIndicatedType()) {
			case IndicatedNodeType.Call:
				return this.decideCallType();
			case IndicatedNodeType.Content:
				return this.decideContentType();
			case IndicatedNodeType.Floating:
				return NodeType.Floating;
			case IndicatedNodeType.NonLogic:
				return NodeType.NonLogic;

			default:
				throw new Error(
					`Error on node ${this.id}: could not decide type.`
				);
		}
	}

	decideCallType(): NodeType {
		// If there are any outgoing choice edges
		if (
			this.outgoingEdges.some(
				(edge) =>
					this.graph[edge].getIndicatedType() ===
					IndicatedEdgeType.Choice
			)
		) {
			// Return choice
			return NodeType.Choice;
		}
		// If there are any outgoing list edges, it's a list node
		else if (
			this.outgoingEdges.some(
				(edge) =>
					this.graph[edge].getIndicatedType() ===
					IndicatedEdgeType.List
			)
		) {
			return NodeType.List;
		} else {
			return NodeType.StandardCall;
		}
	}

	decideContentType(): NodeType {
		// If the text starts and ends with `, it's a formatter (check that it isn't a code block)
		const formatPattern = /^`[^`].*[^`]`$/;
		const codeBlockPattern = /^```[\s\S]*```$/;

		if (
			formatPattern.test(this.text.trim()) &&
			!codeBlockPattern.test(this.text.trim())
		) {
			return NodeType.Formatter;
		}

		// If the result of getNoteOrFloatingReference is not null, it's a reference node
		if (this.getNoteOrFloatingReference() !== null) {
			return NodeType.Reference;
		}

		// If there are any incoming vault edges, it's a vault node
		if (
			this.incomingEdges.some(
				(edge) =>
					this.graph[edge].getIndicatedType() ===
					IndicatedEdgeType.Vault
			)
		) {
			return NodeType.Vault;
		}

		// If there are no incoming edges, it's an input node
		if (this.incomingEdges.length === 0) {
			return NodeType.Input;
		}

		return NodeType.Display;
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

	createTyped(graph: Record<string, CannoliObject>): CannoliObject | null {
		switch (this.decideType()) {
			case NodeType.StandardCall:
				return new CallNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups
				);
			case NodeType.List:
				return new ListNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups
				);

			case NodeType.Choice:
				return new ChoiceNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups
				);
			case NodeType.Display:
				return new DisplayNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups
				);
			case NodeType.Input:
				return new InputNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups
				);
			case NodeType.Formatter:
				return new FormatterNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups
				);
			case NodeType.Reference:
				return new ReferenceNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups
				);
			case NodeType.Vault:
				return new VaultNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups
				);
			case NodeType.Floating:
				return new FloatingNode(
					this.id,
					this.text,
					graph,
					false,
					this.canvasData
				);
			case NodeType.NonLogic:
				return null;

			default:
				throw new Error(
					`Error on node ${this.id}: could not create typed node.`
				);
		}
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
				edge.type === EdgeType.ListItem ||
				edge.type === EdgeType.Branch ||
				edge.type === EdgeType.Category ||
				edge.type === EdgeType.Select ||
				edge.type === EdgeType.List ||
				edge.type === EdgeType.SingleVariable
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

	getAllAvailableProvideEdges(): ProvideEdge[] {
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

		// Filter out all logging and write edges
		const filteredEdges = availableEdges.filter(
			(edge) =>
				edge.type !== EdgeType.Logging &&
				edge.type !== EdgeType.Write &&
				edge.type !== EdgeType.Config
		);

		return filteredEdges as ProvideEdge[];
	}
}

export class CallNode extends CannoliNode {
	renderFunction: (
		variables: { name: string; content: string }[]
	) => Promise<string>;
	references: Reference[];

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges?: string[],
		incomingEdges?: string[],
		groups?: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);

		const { renderFunction, references } = this.parseReferencesInText();
		this.renderFunction = renderFunction;
		this.references = references;
	}

	getPrependedMessages(): ChatCompletionRequestMessage[] {
		const messages: ChatCompletionRequestMessage[] = [];

		// Get all available provide edges
		const availableEdges = this.getAllAvailableProvideEdges();

		for (const edge of availableEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof ProvideEdge)) {
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

	getConfig(): OpenAIConfig {
		const runConfig = this.run.getDefaultConfig();

		const updateConfig = (
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			content: string | Record<string, any>,
			setting?: string
		) => {
			if (typeof content === "string") {
				if (setting && isValidKey(setting, runConfig)) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(runConfig as any)[setting] = content; // Using type assertion
				} else {
					this.error(
						`"${setting}" is not a valid LLM config setting.`
					);
				}
			} else if (typeof content === "object") {
				for (const key in content) {
					if (isValidKey(key, runConfig)) {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(runConfig as any)[key] = content[key]; // Using type assertion
					} else {
						this.error(
							`"${key}" is not a valid LLM config setting.`
						);
					}
				}
			}
		};

		// Starting at the last group in groups and working backward
		for (let i = this.groups.length - 1; i >= 0; i--) {
			const group = this.graph[this.groups[i]];
			if (group instanceof CannoliGroup) {
				const configEdges = group
					.getIncomingEdges()
					.filter((edge) => edge.type === EdgeType.Config);
				for (const edge of configEdges) {
					const edgeObject = this.graph[edge.id];
					if (!(edgeObject instanceof ConfigEdge)) {
						throw new Error(
							`Error on object ${edgeObject.id}: object is not a config edge.`
						);
					}
					if (
						typeof edgeObject.content === "string" ||
						typeof edgeObject.content === "object"
					) {
						updateConfig(edgeObject.content, edgeObject.setting);
					} else {
						this.error(`Config edge has invalid content.`);
					}
				}
			}

			// Then do the same for the node itself
			const configEdges = this.getIncomingEdges().filter(
				(edge) => edge.type === EdgeType.Config
			);
			for (const edge of configEdges) {
				const edgeObject = this.graph[edge.id];
				if (!(edgeObject instanceof ConfigEdge)) {
					throw new Error(
						`Error on object ${edgeObject.id}: object is not a config edge.`
					);
				}
				if (
					typeof edgeObject.content === "string" ||
					typeof edgeObject.content === "object"
				) {
					updateConfig(edgeObject.content, edgeObject.setting);
				} else {
					this.error(`Config edge has invalid content.`);
				}
			}
		}

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

	getFunctions(): ChatCompletionFunctions[] {
		return [];
	}

	logDetails(): string {
		return super.logDetails() + `Type: Call\n`;
	}

	validate() {
		super.validate();

		// There must not be more than one incoming edge of type Chat
		if (
			this.getIncomingEdges().filter(
				(edge) => edge.type === EdgeType.Chat
			).length > 1
		) {
			this.error(`Call nodes can only have one incoming chat edge.`);
		}
	}
}

export enum ListNodeType {
	ListItem = "ListItem",
	List = "List",
}

export class ListNode extends CallNode {
	// listNodeType: ListNodeType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
	}

	getFunctions(): ChatCompletionFunctions[] {
		// Get the name of the list items
		const listItems = this.getListItems();

		// Generate the list function
		const listFunc = this.run.createListFunction(listItems);

		console.log(`List Function:\n${JSON.stringify(listFunc, null, 2)}`);

		return [listFunc];
	}

	getListItems(): string[] {
		// Get the unique names of all outgoing listitem edges
		const outgoingListItemEdges = this.getOutgoingEdges().filter((edge) => {
			return edge.type === EdgeType.ListItem;
		});

		const uniqueNames = new Set<string>();

		for (const edge of outgoingListItemEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof SingleVariableEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a list item edge.`
				);
			}

			const name = edgeObject.name;

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
					edgeObject instanceof SingleVariableEdge &&
					edgeObject.type === EdgeType.ListItem
				) {
					const name = edgeObject.name;

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
		// If there are no outgoing list edges, error

		if (
			!this.getOutgoingEdges().some(
				(edge) => edge.type === EdgeType.ListItem
			)
		) {
			this.error(`List nodes must have at least one outgoing list edge.`);
		}
	}
}

export enum ChoiceNodeType {
	Branch = "Branch",
	Category = "Category",
	Select = "Select",
}

export class ChoiceNode extends CallNode {
	// choiceNodeType: ChoiceNodeType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
	}

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
		// Get the selected variable from the last message
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

	async runCategory(run: Run) {
		throw new Error(`Not implemented`);
	}

	async runSelect(run: Run) {
		throw new Error(`Not implemented`);
	}

	rejectUnselectedOptions(choice: string) {
		// Call reject on any outgoing edges that aren't the selected one
		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge];
			if (edgeObject.type === EdgeType.Branch) {
				const branchEdge = edgeObject as BranchEdge;
				if (branchEdge.name !== choice) {
					branchEdge.reject();
				}
			}
		}
	}

	getBranchChoices(): string[] {
		// Get the unique names of all outgoing choice edges
		const outgoingChoiceEdges = this.getOutgoingEdges().filter((edge) => {
			return edge.type === EdgeType.Branch;
		});

		const uniqueNames = new Set<string>();

		for (const edge of outgoingChoiceEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof BranchEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a branch edge.`
				);
			}

			const name = edgeObject.name;

			if (name) {
				uniqueNames.add(name);
			}
		}

		return Array.from(uniqueNames);
	}

	// setSpecialType() {
	// 	// If there are any branch edges in the special outgoing edges, it's a branch node
	// 	if (
	// 		this.getSpecialOutgoingEdges().some(
	// 			(edge) => edge.type === EdgeType.Branch
	// 		)
	// 	) {
	// 		this.choiceNodeType = ChoiceNodeType.Branch;
	// 	} else if (
	// 		this.getSpecialOutgoingEdges().some(
	// 			(edge) => edge.type === EdgeType.Select
	// 		)
	// 	) {
	// 		this.choiceNodeType = ChoiceNodeType.Select;
	// 	} else {
	// 		this.choiceNodeType = ChoiceNodeType.Category;
	// 	}
	// }

	logDetails(): string {
		return super.logDetails() + `Subtype: Choice\n`;
	}

	validate() {
		super.validate();

		// If there are no branch edges, error
		if (
			!this.getOutgoingEdges().some(
				(edge) => edge.type === EdgeType.Branch
			)
		) {
			this.error(
				`Choice nodes must have at least one outgoing branch edge.`
			);
		}
	}
}

export class ContentNode extends CannoliNode {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
	}

	logDetails(): string {
		return super.logDetails() + `Type: Content\n`;
	}

	getWriteOrLoggingContent(): string | null {
		// Get all incoming edges
		const incomingEdges = this.getIncomingEdges();

		console.log(`Number of incoming edges: ${incomingEdges.length}`);
		console.log(`Edge type: ${incomingEdges[0].type}`); // TODO: Remove

		// Filter out all non-write and non-logging edges
		const filteredEdges = incomingEdges.filter(
			(edge) =>
				edge.type === EdgeType.Write || edge.type === EdgeType.Logging
		);

		if (filteredEdges.length === 0) {
			console.log(`No write or logging edges found.`); // TODO: Remove
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

		// There must not be more than one incoming edge of type write
		if (
			this.getIncomingEdges().filter(
				(edge) => edge.type === EdgeType.Write
			).length > 1
		) {
			this.error(`Content nodes can only have one incoming write edge.`);
		}

		// Content nodes must not have any outgoing edges of type ListItem, List, Category, Select, Branch, or Function
		if (
			this.getOutgoingEdges().some(
				(edge) =>
					edge.type === EdgeType.ListItem ||
					edge.type === EdgeType.List ||
					edge.type === EdgeType.Category ||
					edge.type === EdgeType.Select ||
					edge.type === EdgeType.Branch ||
					edge.type === EdgeType.Function
			)
		) {
			this.error(
				`Content nodes cannot have any outgoing list, choice, or function edges.`
			);
		}
	}
}

export class VaultNode extends ContentNode {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
	}

	logDetails(): string {
		return super.logDetails() + `Subtype: Vault\n`;
	}

	validate(): void {
		// Vault nodes cant have incoming edges of type category, list, or function
		if (
			this.getIncomingEdges().some(
				(edge) =>
					edge.type === EdgeType.Category ||
					edge.type === EdgeType.List ||
					edge.type === EdgeType.Function
			)
		) {
			this.error(
				`Vault nodes cannot have incoming category, list, or function edges.`
			);
		}
	}
}

export class ReferenceNode extends ContentNode {
	reference: Reference;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);

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
		const variableValues = this.getVariableValues();

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

			if (edit) {
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

		// Reference nodes cant have incoming edges of type category, list, or function
		if (
			this.getIncomingEdges().some(
				(edge) =>
					edge.type === EdgeType.Category ||
					edge.type === EdgeType.List ||
					edge.type === EdgeType.Function
			)
		) {
			this.error(
				`Reference nodes cannot have incoming category, list, or function edges.`
			);
		}

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
	}
}

export class FormatterNode extends ContentNode {
	renderFunction: (
		variables: { name: string; content: string }[]
	) => Promise<string>;
	references: Reference[];

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);

		const { renderFunction, references } = this.parseReferencesInText();
		this.renderFunction = renderFunction;
		this.references = references;
	}

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
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
	}

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

		console.log(`Content: ${content}`);

		if (!content) {
			const variableValues = this.getVariableValues();

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
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone, canvasData);
		this.status = CannoliObjectStatus.Complete;
	}

	dependencyCompleted(dependency: CannoliObject): void {
		return;
	}

	dependencyRejected(dependency: CannoliObject): void {
		return;
	}

	async execute() {
		return;
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
