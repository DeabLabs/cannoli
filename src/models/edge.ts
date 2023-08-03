import { CanvasEdgeData } from "obsidian/canvas";
import {
	CannoliObject,
	CannoliObjectKind,
	CannoliVertex,
	EdgeType,
	IndicatedEdgeType,
	IndicatedGroupType,
	IndicatedNodeType,
} from "./object";
import { ChatCompletionRequestMessage } from "openai";
import { Run } from "src/run";
import { Vault } from "obsidian";

export class CannoliEdge extends CannoliObject {
	source: string;
	target: string;
	crossingInGroups: string[];
	crossingOutGroups: string[];
	canvasData: CanvasEdgeData;
	content: string | Record<string, string> | undefined;
	isLoaded: boolean;

	EdgePrefixMap: Record<string, IndicatedEdgeType> = {
		"*": IndicatedEdgeType.Config,
		"?": IndicatedEdgeType.Choice,
		"<": IndicatedEdgeType.List,
		"=": IndicatedEdgeType.Function,
		"^": IndicatedEdgeType.Vault,
	};

	EdgeColorMap: Record<string, IndicatedEdgeType> = {
		"2": IndicatedEdgeType.Config,
		"3": IndicatedEdgeType.Choice,
		"4": IndicatedEdgeType.Function,
		"5": IndicatedEdgeType.List,
		"6": IndicatedEdgeType.Vault,
	};

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, isClone, vault);
		this.source = source;
		this.target = target;
		this.canvasData = canvasData;

		this.isLoaded = false;

		this.addDependency(source);

		this.kind = CannoliObjectKind.Edge;
	}

	getSource(): CannoliVertex {
		return this.graph[this.source] as CannoliVertex;
	}

	getTarget(): CannoliVertex {
		return this.graph[this.target] as CannoliVertex;
	}

	setIncomingAndOutgoingEdges() {
		const source = this.getSource();
		const target = this.getTarget();

		if (
			source instanceof CannoliVertex &&
			target instanceof CannoliVertex
		) {
			if (
				source.groups.includes(this.target) ||
				target.groups.includes(this.source)
			) {
				source.addIncomingEdge(this.id, true);
				target.addOutgoingEdge(this.id, true);
			} else {
				source.addOutgoingEdge(this.id, false);
				target.addIncomingEdge(this.id, false);
			}
		}
	}

	setCrossingGroups() {
		// Get the source and target vertices
		const source = this.getSource();
		const target = this.getTarget();

		// Find the first shared group
		const sharedGroup = source.groups.find((group) =>
			target.groups.includes(group)
		);

		// Handle case where no shared group is found
		if (sharedGroup === undefined) {
			this.crossingOutGroups = [...source.groups];
			this.crossingInGroups = [...target.groups].reverse();
		} else {
			// Set crossingOutGroups
			const sourceIndex = source.groups.indexOf(sharedGroup);
			this.crossingOutGroups = source.groups.slice(0, sourceIndex);

			// Set crossingInGroups
			const targetIndex = target.groups.indexOf(sharedGroup);
			const tempCrossingInGroups = target.groups.slice(0, targetIndex);
			this.crossingInGroups = tempCrossingInGroups.reverse();
		}

		// Add the crossingOut groups to this edge's dependencies
		this.crossingOutGroups.forEach((group) => this.addDependency(group));
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		// We should never be calling the base class load method
		throw new Error(
			`Error on edge ${
				this.id
			}: load is not implemented. Attempted to load content "${content}" and messages "${JSON.stringify(
				messages,
				null,
				2
			)}".`
		);
	}

	dependencyCompleted(dependency: CannoliObject, run: Run): void {
		if (this.allDependenciesComplete()) {
			this.execute(run);
		}
	}

	async run() {
		if (!this.isLoaded) {
			throw new Error(
				`Error on edge ${this.id}: edge is being run but has not been loaded.`
			);
		}
	}

	async mockRun() {
		if (!this.isLoaded) {
			throw new Error(
				`Error on edge ${this.id}: edge is being run but has not been loaded.`
			);
		}
	}

	logDetails(): string {
		// Build crossing groups string of the text of the crossing groups
		let crossingGroupsString = "";
		crossingGroupsString += `Crossing Out Groups: `;
		for (const group of this.crossingOutGroups) {
			crossingGroupsString += `\t-"${this.ensureStringLength(
				this.graph[group].text,
				15
			)}`;
		}
		crossingGroupsString += `\nCrossing In Groups: `;
		for (const group of this.crossingInGroups) {
			crossingGroupsString += `\t-"${this.ensureStringLength(
				this.graph[group].text,
				15
			)}`;
		}

		return (
			super.logDetails() +
			`---> Edge ${this.id} Text: "(${
				this.text
			})"\nSource: "${this.ensureStringLength(
				this.getSource().text,
				15
			)}\nTarget: "${this.ensureStringLength(
				this.getTarget().text,
				15
			)}"\n${crossingGroupsString}\n`
		);
	}

	reset(run: Run) {
		super.reset(run);
		this.isLoaded = false;
		this.content = undefined;
	}

	getIndicatedType():
		| IndicatedEdgeType
		| IndicatedNodeType
		| IndicatedGroupType {
		let type = IndicatedEdgeType.Blank;

		// Check if the first character is in the prefix map
		const firstCharacter = this.text[0];
		if (firstCharacter in this.EdgePrefixMap) {
			type = this.EdgePrefixMap[firstCharacter];
		} // If not, check the color map
		else {
			const color = this.canvasData.color;
			if (color) {
				if (color in this.EdgeColorMap) {
					type = this.EdgeColorMap[color];
				}
			}
		}

		// If the type is blank, check if there is a variable in the text
		if (type === IndicatedEdgeType.Blank) {
			const variableInfo = this.getVariableInfo();
			if (variableInfo.name !== "") {
				type = IndicatedEdgeType.Variable;
			}
		}
		// If the type is config, check if there is a variable in the text
		else if (type === IndicatedEdgeType.Config) {
			const variableInfo = this.getVariableInfo();
			if (variableInfo.name === "") {
				type = IndicatedEdgeType.Logging;
			}
		}

		return type;
	}

	decideType(): EdgeType {
		const indicatedType = this.getIndicatedType();
		switch (indicatedType) {
			case IndicatedEdgeType.Blank:
				return this.decideBlankType();
			case IndicatedEdgeType.Variable:
				return EdgeType.SingleVariable;
			case IndicatedEdgeType.List:
				return this.decideListType();
			case IndicatedEdgeType.Choice:
				return this.decideChoiceType();
			case IndicatedEdgeType.Config:
				return EdgeType.Config;
			case IndicatedEdgeType.Function:
				return EdgeType.Function;
			case IndicatedEdgeType.Vault:
				return EdgeType.Vault;
			case IndicatedEdgeType.Logging:
				return EdgeType.Logging;
			default:
				throw new Error(
					`Error on edge ${this.id}: invalid indicated type ${indicatedType}.`
				);
		}
	}

	decideBlankType(): EdgeType {
		const sourceType = this.getSource().getIndicatedType();
		const targetType = this.getTarget().getIndicatedType();

		// If the source is a call node
		if (sourceType === IndicatedNodeType.Call) {
			// If the target is a group or a call node
			if (
				this.getTarget().kind === CannoliObjectKind.Group ||
				targetType === IndicatedNodeType.Call
			) {
				return EdgeType.Chat;
				// If the target is a content node
			} else if (targetType === IndicatedNodeType.Content) {
				return EdgeType.Write;
			} else if (targetType === IndicatedNodeType.NonLogic) {
				return EdgeType.NonLogic;
			} else {
				// Error
				throw new Error(
					`Error on blank edge ${this.id}: invalid target for blank edge coming from call node.`
				);
			}
			// If the source is a content node
		} else if (sourceType === IndicatedNodeType.Content) {
			// If the target is a group or a call node
			if (
				this.getTarget().kind === CannoliObjectKind.Group ||
				targetType === IndicatedNodeType.Call
			) {
				return EdgeType.SystemMessage;
			}
			// If the target is a content node
			else if (targetType === IndicatedNodeType.Content) {
				return EdgeType.Write;
			} else if (targetType === IndicatedNodeType.NonLogic) {
				return EdgeType.NonLogic;
			} else {
				// Error
				throw new Error(
					`Error on blank edge ${this.id}: invalid target for blank edge coming from content node.`
				);
			}
		}
		// If the source is a group, error
		else {
			throw new Error(
				`Error on blank edge ${this.id}: source is a group.`
			);
		}
	}

	decideListType(): EdgeType {
		// Filter for all outgoing list edges from the source
		const outgoingListEdges = this.getSource().outgoingEdges.filter(
			(edge) => {
				const edgeObject = this.graph[edge.id];
				if (edgeObject instanceof CannoliEdge) {
					return (
						edgeObject.getIndicatedType() === IndicatedEdgeType.List
					);
				} else {
					return false;
				}
			}
		);

		// Call get variable on all outgoing list edges
		const outgoingListEdgeNames = outgoingListEdges.map((edge) => {
			const edgeObject = this.graph[edge.id];
			if (edgeObject instanceof CannoliEdge) {
				return edgeObject.getVariableInfo().name;
			} else {
				return "";
			}
		});

		// If they're all the same, return List
		if (
			outgoingListEdgeNames.every(
				(name) => name === outgoingListEdgeNames[0]
			)
		) {
			return EdgeType.List;
		} else {
			return EdgeType.ListItem;
		}
	}

	decideChoiceType(): EdgeType {
		// If the target is a list group, return category
		if (
			this.getTarget().kind === CannoliObjectKind.Group &&
			this.getTarget().getIndicatedType() === IndicatedGroupType.List
		) {
			return EdgeType.Category;
		}

		// Fliter for all outgoing choice edges from the source
		const outgoingChoiceEdges = this.getSource().outgoingEdges.filter(
			(edge) => {
				const edgeObject = this.graph[edge.id];
				if (edgeObject instanceof CannoliEdge) {
					return (
						edgeObject.getIndicatedType() ===
						IndicatedEdgeType.Choice
					);
				} else {
					return false;
				}
			}
		);

		// Call get variable on all outgoing choice edges
		const outgoingChoiceEdgeNames = outgoingChoiceEdges.map((edge) => {
			const edgeObject = this.graph[edge.id];
			if (edgeObject instanceof CannoliEdge) {
				return edgeObject.getVariableInfo().name;
			} else {
				return "";
			}
		});

		// If they're all the same, return Select
		if (
			outgoingChoiceEdgeNames.every(
				(name) => name === outgoingChoiceEdgeNames[0]
			)
		) {
			return EdgeType.Select;
		} else {
			// If they're not all the same, return Branch
			return EdgeType.Branch;
		}
	}

	getVariableInfo(): { name: string; chatOverride: boolean } {
		let name = this.text;

		// If the first character is in the edge prefix map, remove it
		const firstCharacter = this.text[0];
		if (firstCharacter in this.EdgePrefixMap) {
			name = name.slice(1);
		}

		// If the last character is a "|", it's a chat override, remove it
		if (name[name.length - 1] === "|") {
			name = name.slice(0, -1);
			return { name, chatOverride: true };
		} else {
			return { name, chatOverride: false };
		}
	}

	createTyped(graph: Record<string, CannoliObject>): CannoliObject | null {
		const type = this.decideType();
		const varName = this.getVariableInfo().name;
		const chatOverride = this.getVariableInfo().chatOverride;

		switch (type) {
			case EdgeType.Write:
				return new WriteEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target
				);

			case EdgeType.Logging:
				return new LoggingEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target
				);

			case EdgeType.Config: {
				return new ConfigEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName
				);
			}
			case EdgeType.Chat: {
				return new ChatEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target
				);
			}
			case EdgeType.SystemMessage:
				return new SystemMessageEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target
				);

			case EdgeType.ListItem: {
				return new SingleVariableEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName,
					chatOverride,
					SingleVariableEdgeType.ListItem
				);
			}
			case EdgeType.Category: {
				return new MultipleVariableEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName,
					chatOverride,
					MultipleVariableEdgeType.Category
				);
			}
			case EdgeType.Function: {
				return new MultipleVariableEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName,
					chatOverride,
					MultipleVariableEdgeType.Function
				);
			}
			case EdgeType.List: {
				return new MultipleVariableEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName,
					chatOverride,
					MultipleVariableEdgeType.List
				);
			}
			case EdgeType.Branch: {
				return new SingleVariableEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName,
					chatOverride,
					SingleVariableEdgeType.Branch
				);
			}
			case EdgeType.Select: {
				return new SingleVariableEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName,
					chatOverride,
					SingleVariableEdgeType.Branch
				);
			}
			case EdgeType.Vault: {
				return new SingleVariableEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName,
					chatOverride,
					SingleVariableEdgeType.Vault
				);
			}
			case EdgeType.SingleVariable: {
				return new SingleVariableEdge(
					this.id,
					this.text,
					graph,
					false,
					this.vault,
					this.canvasData,
					this.source,
					this.target,
					varName,
					chatOverride,
					SingleVariableEdgeType.Standard
				);
			}
			case EdgeType.NonLogic: {
				return null;
			}
			default:
				throw new Error(
					`Error on edge ${this.id}: invalid type ${type}.`
				);
		}
	}
}

export class ProvideEdge extends CannoliEdge {
	name: string | null;
	messages: ChatCompletionRequestMessage[] | undefined;
	addMessages: boolean;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		name: string | null,
		addMessages: boolean
	) {
		super(id, text, graph, isClone, vault, canvasData, source, target);
		this.name = name;
		this.addMessages = addMessages;
	}

	reset(run: Run): void {
		super.reset(run);
		this.messages = [];
	}
}

export class ChatEdge extends ProvideEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			source,
			target,
			null,
			true
		);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (messages !== undefined) {
			this.messages = messages;
		} else {
			throw new Error(
				`Error on Chat edge ${this.id}: messages is undefined.`
			);
		}

		if (content !== undefined) {
			throw new Error(
				`Error on Chat edge ${this.id}: cannot load content.`
			);
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Chat ${this.id}`;
	}
}

export class SystemMessageEdge extends ProvideEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			source,
			target,
			null,
			true
		);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (content !== undefined) {
			this.messages = [
				{
					role: "system",
					content: content as string,
				},
			];
		} else {
			throw new Error(
				`Error on SystemMessage edge ${this.id}: content is undefined.`
			);
		}

		if (messages !== undefined) {
			throw new Error(
				`Error on SystemMessage edge ${this.id}: cannot load messages.`
			);
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: SystemMessage\n`;
	}
}

export class WriteEdge extends CannoliEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, isClone, vault, canvasData, source, target);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (typeof content === "string") {
			if (content !== undefined) {
				this.content = content;
			} else {
				throw new Error(
					`Error on Write edge ${this.id}: content is undefined.`
				);
			}

			if (messages !== undefined) {
				throw new Error(
					`Error on Write edge ${this.id}: cannot load messages.`
				);
			}
		} else {
			throw new Error(
				`Error on Write edge ${this.id}: content is a Record.`
			);
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Write\n`;
	}
}

export class LoggingEdge extends WriteEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, isClone, vault, canvasData, source, target);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (content !== undefined) {
			this.content = content;
		} else {
			throw new Error(
				`Error on Logging edge ${this.id}: content is undefined.`
			);
		}

		if (messages !== undefined) {
			// Append the chatHistory to the content as a string
			this.content = `${this.content}\n${JSON.stringify(
				messages,
				null,
				2
			)}`;
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Logging\n`;
	}
}

export enum ConfigEdgeSetting {
	Config = "config",
	Model = "model",
	MaxTokens = "max_tokens",
	Temperature = "temperature",
	TopP = "top_p",
	FrequencyPenalty = "frequency_penalty",
	PresencePenalty = "presence_penalty",
	Stop = "stop",
}

export class ConfigEdge extends CannoliEdge {
	setting: string;
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		setting: string
	) {
		super(id, text, graph, isClone, vault, canvasData, source, target);
		this.setting = setting;
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (content === undefined) {
			throw new Error(
				`Error on Config edge ${this.id}: content is undefined.`
			);
		} else {
			this.content = content;
		}

		if (messages !== undefined) {
			throw new Error(
				`Error on Config edge ${this.id}: cannot load messages.`
			);
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Config\nSetting: ${this.setting}\n`;
	}
}

export enum SingleVariableEdgeType {
	ListItem = "listItem",
	Branch = "branch",
	Select = "select",
	Vault = "vault",
	Standard = "standard",
}

export class SingleVariableEdge extends ProvideEdge {
	type: SingleVariableEdgeType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		name: string | null,
		addMessages: boolean,
		type: SingleVariableEdgeType
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			source,
			target,
			name,
			addMessages
		);
		this.type = type;
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (typeof content === "string") {
			if (content !== undefined) {
				this.content = content;
			} else {
				throw new Error(
					`Error on SingleVariable edge ${this.id}: content is undefined.`
				);
			}

			if (this.addMessages) {
				if (messages !== undefined) {
					this.messages = messages;
				} else {
					throw new Error(
						`Error on SingleVariable edge ${this.id}: messages undefined.`
					);
				}
			} else {
				if (messages !== undefined) {
					throw new Error(
						`Error on SingleVariable edge ${this.id}: cannot load chatHistory.`
					);
				}
			}
		} else {
			throw new Error(
				`Error on SingleVariable edge ${this.id}: content is a Record.`
			);
		}
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: SingleVariable\nName: ${this.name}\nSubtype: ${this.type}\nAddMessages: ${this.addMessages}\n`
		);
	}
}

export enum MultipleVariableEdgeType {
	List = "list",
	Category = "category",
	Function = "function",
}

export class MultipleVariableEdge extends ProvideEdge {
	type: MultipleVariableEdgeType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		name: string,
		addMessages: boolean,
		type: MultipleVariableEdgeType
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			source,
			target,
			name,
			addMessages
		);
		this.type = type;
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (typeof content === "object") {
			if (content !== undefined) {
				this.content = content;
			} else {
				throw new Error(
					`Error on MultipleVariable edge ${this.id}: content is undefined.`
				);
			}

			if (this.addMessages) {
				if (messages !== undefined) {
					this.messages = messages;
				} else {
					throw new Error(
						`Error on MultipleVariable edge ${this.id}: messages undefined.`
					);
				}
			} else {
				if (messages !== undefined) {
					throw new Error(
						`Error on MultipleVariable edge ${this.id}: cannot load messages.`
					);
				}
			}
		} else {
			throw new Error(
				`Error on MultipleVariable edge ${this.id}: content is a string.`
			);
		}
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: MultipleVariable\nName: ${this.name}\nSubtype: ${this.type}\nAddMessages: ${this.addMessages}\n`
		);
	}
}
