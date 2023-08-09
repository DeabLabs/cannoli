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
	Repeat = "repeat",
	List = "list",
	Basic = "basic",
	While = "while",
	NonLogic = "non-logic",
}

export enum CannoliObjectStatus {
	Pending = "pending",
	Executing = "executing",
	Complete = "complete",
	Rejected = "rejected",
	Error = "error",
}

export enum EdgeType {
	Write = "write",
	Logging = "logging",
	Config = "config",
	Chat = "chat",
	SystemMessage = "system-message",
	List = "list",
	Function = "function",
	ListItem = "list-item",
	Select = "select",
	Branch = "branch",
	Category = "category",
	Vault = "vault",
	SingleVariable = "single-variable",
	NonLogic = "non-logic",
	Untyped = "untyped",
}

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
	type?: EdgeType | NodeType | GroupType;
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
}

export interface ProvideEdgeData extends CannoliEdgeData {
	name?: string;
	addMessagesOverride: boolean;
}

export interface ConfigEdgeData extends CannoliEdgeData {
	setting: string;
}

export interface CannoliGroupData extends CannoliData {
	members: string[];
}

export interface RepeatGroupData extends CannoliGroupData {
	maxLoops: number;
	currentLoop: number;
}

export interface ForEachGroupData extends CannoliGroupData {
	index: number;
}

export interface CannoliNodeData extends CannoliData {
	references?: Reference[];
}

export interface CannoliCanvasFileData extends CanvasFileData {
	cannoliData: CannoliNodeData;
}

export interface CannoliCanvasTextData extends CanvasTextData {
	cannoliData: CannoliNodeData;
}

export interface CannoliCanvasLinkData extends CanvasLinkData {
	cannoliData: CannoliNodeData;
}

export interface CannoliCanvasGroupData extends CanvasGroupData {
	cannoliData: CannoliGroupData;
}

export interface CannoliCanvasEdgeData extends CanvasEdgeData {
	cannoliData: CannoliEdgeData;
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
