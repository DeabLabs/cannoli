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
import { Run } from "src/run";
import { Vault } from "obsidian";
import {
	CannoliEdge,
	ChatEdge,
	ConfigEdge,
	ProvideEdge,
	SingleVariableEdge,
} from "./edge";
import { ChatCompletionRequestMessage } from "openai";
import { CannoliGroup } from "./group";

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

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges?: { id: string; isReflexive: boolean }[],
		incomingEdges?: { id: string; isReflexive: boolean }[],
		groups?: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
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

	buildRenderFunction(): (
		variables: {
			name: string;
			content: string;
		}[]
	) => Promise<string> {
		console.error(`Need to implement buildRenderFunction`);
		return async () => {
			return "Implement render function";
		};
	}

	dependencyCompleted(dependency: CannoliObject, run: Run): void {
		if (this.allDependenciesComplete()) {
			this.execute(run);
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
					this.graph[edge.id].getIndicatedType() ===
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
					this.graph[edge.id].getIndicatedType() ===
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
					this.graph[edge.id].getIndicatedType() ===
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
					this.vault,
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
					this.vault,
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
					this.vault,
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
					this.vault,
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
					this.vault,
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
					this.vault,
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
					this.vault,
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
					this.vault,
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
					this.vault,
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
				this.graph[edge.id].text,
				15
			)}"`;
		}

		let outgoingEdgesString = "";
		outgoingEdgesString += `Outgoing Edges: `;
		for (const edge of this.outgoingEdges) {
			outgoingEdgesString += `\n\t-"${this.ensureStringLength(
				this.graph[edge.id].text,
				15
			)}"`;
		}

		return (
			super.logDetails() +
			`[] Node ${this.id} Text: "${this.text}"\n${incomingEdgesString}\n${outgoingEdgesString}\n${groupsString}\n`
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
				(edge) => this.graph[edge.id].type === EdgeType.List
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

		// Log out the text and type of each special outgoing edge
		let specialEdgeLog = "Special Outgoing Edges:\n";

		for (const edge of specialOutgoingEdges) {
			specialEdgeLog += `\t"${this.graph[edge.id].text}" (${
				edge.type
			})\n`;
		}

		console.log(specialEdgeLog);

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
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges?: { id: string; isReflexive: boolean }[],
		incomingEdges?: { id: string; isReflexive: boolean }[],
		groups?: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);

		this.renderFunction = this.buildRenderFunction();
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

	getVariableValues(): { name: string; content: string }[] {
		const variableValues: { name: string; content: string }[] = [];

		// Get all available provide edges
		const availableEdges = this.getAllAvailableProvideEdges();

		for (const edge of availableEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof ProvideEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a provide edge.`
				);
			}

			// If the edge isn't complete, skip it
			if (!(edgeObject.status === CannoliObjectStatus.Complete)) {
				continue;
			}

			if (!edgeObject.content) {
				continue;
			}

			if (typeof edgeObject.content === "string" && edgeObject.name) {
				const variableValue = {
					name: edgeObject.name,
					content: edgeObject.content,
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
					};

					multipleVariableValues.push(variableValue);
				}

				variableValues.push(...multipleVariableValues);
			} else {
				continue;
			}
		}

		return variableValues;
	}

	getNewMessage(): ChatCompletionRequestMessage {
		const variables = this.getVariableValues();

		this.renderFunction(variables);

		return {
			role: "user",
			content: this.text,
		};
	}

	getConfig(): Record<string, string> {
		const config: Record<string, string> = {
			// Default config values
			model: "gpt-3.5-turbo",
		};

		// Starting at the last group in groups and working backward
		for (let i = this.groups.length - 1; i >= 0; i--) {
			const group = this.graph[this.groups[i]];
			if (group instanceof CannoliGroup) {
				const configEdges = group.getIncomingEdges().filter((edge) => {
					return edge.type === EdgeType.Config;
				});

				// If the setting of the config edge is a key in the config object, overwrite it
				for (const edge of configEdges) {
					const edgeObject = this.graph[edge.id];
					if (!(edgeObject instanceof ConfigEdge)) {
						throw new Error(
							`Error on object ${edgeObject.id}: object is not a config edge.`
						);
					}

					const content = edgeObject.content;

					if (typeof content === "string") {
						if (edgeObject.setting in config) {
							config[edgeObject.setting] = content;
						}
					} else if (typeof content === "object") {
						for (const key in content) {
							if (key in config) {
								config[key] = content[key];
							}
						}
					}
				}
			}
		}

		// Then do the same for the node itself
		const configEdges = this.getIncomingEdges().filter((edge) => {
			return edge.type === EdgeType.Config;
		});

		// If the setting of the config edge is a key in the config object, overwrite it
		for (const edge of configEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof ConfigEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a config edge.`
				);
			}

			const content = edgeObject.content;

			if (typeof content === "string") {
				if (edgeObject.setting in config) {
					config[edgeObject.setting] = content;
				}
			} else if (typeof content === "object") {
				for (const key in content) {
					if (key in config) {
						config[key] = content[key];
					}
				}
			}
		}

		return config;
	}

	async callLLM(
		run: Run
	): Promise<{ content: string; messages: ChatCompletionRequestMessage[] }> {
		console.log(`Calling LLM with text "${this.text}"`);

		const config = this.getConfig();

		const messages = this.getPrependedMessages();

		messages.push(this.getNewMessage());

		const response = await run.cannoli?.llmCall({
			messages: messages,
			model: config["model"],
			mock: run.isMock,
			verbose: true,
		});

		console.log(response?.message.content);

		if (response && response.message && response.message.content) {
			messages.push(response.message);
			const responseContent = response.message.content;

			return {
				content: responseContent,
				messages: messages,
			};
		} else {
			this.error(`LLM call failed.`);
			throw new Error(`LLM call failed.`);
		}
	}

	async run(run: Run) {
		console.log(`Running call node with text "${this.text}"`);

		// TEST VERSION (sleep for random time between 0 and 3 seconds)
		// const sleepTime = Math.random() * 3000;
		// await new Promise((resolve) => setTimeout(resolve, sleepTime));

		const { content, messages } = await this.callLLM(run);

		console.log(`LLM call returned content "${content}"`);

		// Load all outgoing edges
		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge.id];
			if (edgeObject instanceof CannoliEdge) {
				edgeObject.load({
					content: content,
					messages: messages,
				});
			}
		}

		console.log(`Finished running call node with text "${this.text}"`);
	}

	async mockRun(run: Run) {
		// Load all outgoing edges
		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge.id];
			if (edgeObject instanceof SingleVariableEdge) {
				edgeObject.load({
					content: "testing",
				});
			} else if (edgeObject instanceof ChatEdge) {
				edgeObject.load({
					messages: [
						{
							role: "user",
							content: "testing",
						},
					],
				});
			}
		}
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

export class ListNode extends CannoliNode {
	listNodeType: ListNodeType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges: { id: string; isReflexive: boolean }[],
		incomingEdges: { id: string; isReflexive: boolean }[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
	}

	setSpecialType() {
		// If there are any outgoing list item edges, it's a list item node
		if (
			this.getSpecialOutgoingEdges().some(
				(edge) => edge.type === EdgeType.ListItem
			)
		) {
			this.listNodeType = ListNodeType.ListItem;
		} else {
			this.listNodeType = ListNodeType.List;
		}
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Subtype: List\nList Type: ${this.listNodeType}\n`
		);
	}

	validate() {
		super.validate();

		const specialOutgoingEdges = this.getSpecialOutgoingEdges();

		// If there are no special outgoing edges, it's an error
		if (specialOutgoingEdges.length === 0) {
			this.error(`List nodes must have at least one outgoing list edge.`);
		}

		// Switch on the type of the first special outgoing edge
		switch (this.listNodeType) {
			case ListNodeType.ListItem:
				this.validateList(specialOutgoingEdges);
				break;
			case ListNodeType.List:
				this.validateListItem(specialOutgoingEdges);
				break;
			default:
				this.error(
					`All special outgoing edges must be list edges or list item edges.`
				);
		}
	}

	validateListItem(specialOutgoingEdges: CannoliEdge[]) {
		return;
	}

	validateList(specialOutgoingEdges: CannoliEdge[]) {
		// // All list edges must point to list groups or choice nodes
		// for (const edge of specialOutgoingEdges) {
		// 	const edgeObject = this.graph[edge.id];

		// 	if (!(edgeObject instanceof CannoliEdge)) {
		// 		throw new Error(
		// 			`Error on object ${edgeObject.id}: object is not an edge.`
		// 		);
		// 	}

		// 	const target = edgeObject.getTarget();

		// 	if (
		// 		!(target instanceof ListGroup) &&
		// 		!(
		// 			target instanceof ChoiceNode &&
		// 			(target.choiceNodeType === ChoiceNodeType.Category ||
		// 				target.choiceNodeType === ChoiceNodeType.Select)
		// 		)
		// 	) {
		// 		this.error(
		// 			`All list edges with multiple items in them must point to list groups or choice nodes.`
		// 		);
		// 	}
		// }
		return;
	}
}

export enum ChoiceNodeType {
	Branch = "Branch",
	Category = "Category",
	Select = "Select",
}

export class ChoiceNode extends CannoliNode {
	choiceNodeType: ChoiceNodeType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges: { id: string; isReflexive: boolean }[],
		incomingEdges: { id: string; isReflexive: boolean }[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
	}

	setSpecialType() {
		// If there are any branch edges in the special outgoing edges, it's a branch node
		if (
			this.getSpecialOutgoingEdges().some(
				(edge) => edge.type === EdgeType.Branch
			)
		) {
			this.choiceNodeType = ChoiceNodeType.Branch;
		} else if (
			this.getSpecialOutgoingEdges().some(
				(edge) => edge.type === EdgeType.Select
			)
		) {
			this.choiceNodeType = ChoiceNodeType.Select;
		} else {
			this.choiceNodeType = ChoiceNodeType.Category;
		}
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Subtype: Choice\nChoice Type: ${this.choiceNodeType}\n`
		);
	}

	validate() {
		super.validate();

		const specialOutgoingEdges = this.getSpecialOutgoingEdges();

		// If there are no special outgoing edges, it's an error
		if (specialOutgoingEdges.length === 0) {
			this.error(
				`Choice nodes must have at least one outgoing choice edge.`
			);
		}

		// Switch on the type of the first special outgoing edge
		switch (this.choiceNodeType) {
			case ChoiceNodeType.Category:
				this.validateCategory(specialOutgoingEdges);
				break;
			case ChoiceNodeType.Branch:
				this.validateBranch(specialOutgoingEdges);
				break;
			case ChoiceNodeType.Select:
				this.validateSelect(specialOutgoingEdges);
				break;
			default:
				this.error(
					`All outgoing choice edges must be branch edges or category edges.`
				);
		}
	}

	validateBranch(specialOutgoingEdges: CannoliEdge[]) {
		return;
	}

	validateCategory(specialOutgoingEdges: CannoliEdge[]) {
		// All category edges must point to list groups
		// for (const edge of specialOutgoingEdges) {
		// 	const edgeObject = this.graph[edge.id];

		// 	if (!(edgeObject instanceof CannoliEdge)) {
		// 		throw new Error(
		// 			`Error on object ${edgeObject.id}: object is not an edge.`
		// 		);
		// 	}

		// 	const target = edgeObject.getTarget();

		// 	if (!(target.type === GroupType.List)) {
		// 		this.error(
		// 			`All choice edges with multiple items in them must point to list groups or choice nodes.`
		// 		);
		// 	}
		// }
		return;
	}

	validateSelect(specialOutgoingEdges: CannoliEdge[]) {
		return;
	}
}

export class ContentNode extends CannoliNode {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges: { id: string; isReflexive: boolean }[],
		incomingEdges: { id: string; isReflexive: boolean }[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);
	}

	async run(run: Run) {
		// TEST VERSION (write a random string to the text field)
		console.log(`Running content node with text "${this.text}"`);
		this.text = Math.random().toString(36).substring(7);
	}

	async mockRun(run: Run) {
		console.log(`Mock running content node with text "${this.text}"`);
	}

	logDetails(): string {
		return super.logDetails() + `Type: Content\n`;
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

export class VaultNode extends CannoliNode {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges: { id: string; isReflexive: boolean }[],
		incomingEdges: { id: string; isReflexive: boolean }[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
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

export class ReferenceNode extends CannoliNode {
	reference: Reference;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges: { id: string; isReflexive: boolean }[],
		incomingEdges: { id: string; isReflexive: boolean }[],
		groups: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
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

	async getContent(): Promise<string> {
		if (this.reference.type === ReferenceType.Note) {
			const file = this.vault
				.getFiles()
				.find((file) => file.basename === this.reference.name);
			if (file) {
				return await this.vault.read(file);
			} else {
				return `Could not find file ${this.reference.name}`;
			}
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

	editContent(newContent: string, run: Run): void {
		if (this.reference.type === ReferenceType.Note) {
			const file = this.vault
				.getFiles()
				.find((file) => file.basename === this.reference.name);
			if (file) {
				this.vault.modify(file, newContent);
			} else {
				throw new Error(
					`Error on reference node ${this.id}: could not find file.`
				);
			}
		} else {
			// Search through all nodes for a floating node with the correct name
			for (const objectId in this.graph) {
				const object = this.graph[objectId];
				if (
					object instanceof FloatingNode &&
					object.getName() === this.reference.name
				) {
					object.editContent(newContent, run);
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

export class FormatterNode extends CannoliNode {
	renderFunction: (
		variables: { name: string; content: string }[]
	) => Promise<string>;
	references: Reference[];

	logDetails(): string {
		return super.logDetails() + `Subtype: Formatter\n`;
	}
}

export class InputNode extends CannoliNode {
	logDetails(): string {
		return super.logDetails() + `Subtype: Input\n`;
	}
}

export class DisplayNode extends CannoliNode {
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
}

export class FloatingNode extends CannoliNode {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone, vault, canvasData);
		this.status = CannoliObjectStatus.Complete;
	}

	dependencyCompleted(dependency: CannoliObject, run: Run): void {
		return;
	}

	dependencyRejected(dependency: CannoliObject, run: Run): void {
		return;
	}

	async execute(run: Run) {
		return;
	}

	async run(run: Run) {
		// We should never run a floating node, it shouldn't have any dependencies
		throw new Error(
			`Error on floating node ${this.id}: run is not implemented.`
		);
	}

	async mockRun(run: Run) {
		// We should never run a floating node, it shouldn't have any dependencies
		throw new Error(
			`Error on floating node ${this.id}: mockRun is not implemented.`
		);
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

	editContent(newContent: string, run: Run): void {
		const firstLine = this.text.split("\n")[0];
		this.text = `${firstLine}\n${newContent}`;

		// Emit an update event
		this.emit("update", this, this.status, run);
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: Floating\nName: ${this.getName()}\nContent: ${this.getContent()}\n`
		);
	}
}
