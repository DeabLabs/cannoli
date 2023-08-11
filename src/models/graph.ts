import {
	CanvasData,
	CanvasEdgeData,
	CanvasFileData,
	CanvasGroupData,
	CanvasLinkData,
	CanvasTextData,
} from "obsidian/canvas";
import { ChatCompletionRequestMessage } from "openai";

export enum CannoliObjectKind {
	Node = "node",
	Edge = "edge",
	Group = "group",
}

export enum GroupType {
	ForEach = "for-each",
	Repeat = "repeat",
	Basic = "basic",
	While = "while",
	NonLogic = "non-logic",
}

export enum EdgeType {
	Blank,
	Variable,
	Key,
	List,
	Merge,
	Choice,
	Category,
	Config,
	Function,
	Logging,
}

export enum CannoliObjectStatus {
	Pending = "pending",
	Executing = "executing",
	Complete = "complete",
	Rejected = "rejected",
	Error = "error",
}

// export enum EdgeType {
// 	Write = "write",
// 	Logging = "logging",
// 	Config = "config",
// 	Chat = "chat",
// 	SystemMessage = "system-message",
// 	List = "list",
// 	Function = "function",
// 	ListItem = "list-item",
// 	Select = "select",
// 	Branch = "branch",
// 	Category = "category",
// 	Vault = "vault",
// 	SingleVariable = "single-variable",
// 	NonLogic = "non-logic",
// 	Untyped = "untyped",
// }

export enum NodeType {
	Choice = "choice",
	List = "list",
	StandardCall = "standard-call",
	Formatter = "formatter",
	Input = "input",
	Display = "display",
	Vault = "vault",
	Reference = "reference",
	Floating = "floating",
	NonLogic = "non-logic",
}

export enum CallNodeType {
	Standard = "standard",
	Select = "select",
	Categorize = "categorize",
	Choose = "choose",
	Distribute = "distribute",
}

export enum ContentNodeType {
	Input = "input",
	Display = "display",
	StaticReference = "static-reference",
	DynamicReference = "dynamic-reference",
	Formatter = "formatter",
}

export enum FloatingNodeType {
	Variable = "variable",
}

export enum ReferenceType {
	Variable = "variable",
	Floating = "floating",
	Note = "note",
}

export interface Reference {
	name: string;
	type: ReferenceType;
	shouldExtract: boolean;
}

export interface CannoliData {
	text: string;
	status: CannoliObjectStatus;
	dependencies: string[];
	isClone: boolean;
	kind: CannoliObjectKind;
	type:
		| EdgeType
		| GroupType
		| CallNodeType
		| ContentNodeType
		| FloatingNodeType
		| null;
}

export interface CannoliVertexData extends CannoliData {
	outgoingEdges: string[];
	incomingEdges: string[];
	groups: string[];
}

export interface CannoliEdgeData extends CannoliData {
	crossingInGroups: string[];
	crossingOutGroups: string[];
	content?: string | Record<string, string>;
	messages?: ChatCompletionRequestMessage[];
	name?: string;
	addMessages: boolean;
}

export interface CannoliGroupData extends CannoliVertexData {
	members: string[];
}

export interface RepeatGroupData extends CannoliGroupData {
	maxLoops: number;
	currentLoop: number;
}

export interface ForEachGroupData extends CannoliGroupData {
	index: number;
}

export interface CannoliNodeData extends CannoliVertexData {
	references?: Reference[];
}

export interface CannoliCanvasFileData extends CanvasFileData {
	cannoliData?: CannoliVertexData;
}

export interface CannoliCanvasTextData extends CanvasTextData {
	cannoliData?: CannoliVertexData;
}

export interface CannoliCanvasLinkData extends CanvasLinkData {
	cannoliData?: CannoliVertexData;
}

export interface CannoliCanvasGroupData extends CanvasGroupData {
	cannoliData?: CannoliGroupData;
}

export interface CannoliCanvasEdgeData extends CanvasEdgeData {
	cannoliData?: CannoliEdgeData;
}

export type AllCannoliCanvasNodeData =
	| CannoliCanvasFileData
	| CannoliCanvasTextData
	| CannoliCanvasLinkData
	| CannoliCanvasGroupData;

export interface CannoliCanvasData extends CanvasData {
	nodes: AllCannoliCanvasNodeData[];
	edges: CannoliCanvasEdgeData[];
}

export class CannoliGraph {
	cannoliCanvasData: CannoliCanvasData;

	constructor(cannoliCanvasData: CannoliCanvasData) {
		this.cannoliCanvasData = cannoliCanvasData;
	}
}
