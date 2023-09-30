import {
	CanvasData,
	CanvasEdgeData,
	CanvasFileData,
	CanvasGroupData,
	CanvasLinkData,
	CanvasTextData,
} from "obsidian/canvas";

import { CannoliObject } from "./object";
import { CannoliGroup, ForEachGroup, RepeatGroup } from "./group";
import {
	AccumulateNode,
	CallNode,
	CannoliNode,
	ChooseNode,
	ContentNode,
	DistributeNode,
	FloatingNode,
	FormatterNode,
	HttpNode,
	ReferenceNode,
} from "./node";
import {
	CannoliEdge,
	ChatConverterEdge,
	ChatResponseEdge,
	LoggingEdge,
	SystemMessageEdge,
} from "./edge";
import { ChatCompletionMessage } from "openai/resources/chat";

export enum CannoliObjectKind {
	Node = "node",
	Edge = "edge",
	Group = "group",
}

export enum GroupType {
	SignifiedForEach = "signified-for-each",
	ForEach = "for-each",
	Repeat = "repeat",
	Basic = "basic",
}

export enum EdgeType {
	Chat = "chat",
	ChatConverter = "chat-converter",
	ChatResponse = "chat-response",
	SystemMessage = "system-message",
	Write = "write",
	Variable = "variable",
	Key = "key",
	List = "list",
	Merge = "merge",
	Choice = "choice",
	Category = "category",
	Config = "config",
	Function = "function",
	Logging = "logging",
}

export enum CannoliObjectStatus {
	Pending = "pending",
	Executing = "executing",
	Complete = "complete",
	Rejected = "rejected",
	Error = "error",
	Warning = "warning",
}

export type NodeType = CallNodeType | ContentNodeType | FloatingNodeType;

export enum CallNodeType {
	StandardCall = "standard-call",
	Select = "select",
	Categorize = "categorize",
	Choose = "choose",
	Distribute = "distribute",
	Accumulate = "accumulate",
}

export enum ContentNodeType {
	StandardContent = "standard-content",
	Reference = "reference",
	Formatter = "formatter",
	Http = "http",
}

export enum FloatingNodeType {
	Variable = "variable",
	ActionTemplate = "action-template",
}

export enum ReferenceType {
	Variable = "variable",
	Floating = "floating",
	Note = "note",
	CreateNote = "create-note",
}

export interface Reference {
	name: string;
	type: ReferenceType;
	shouldExtract: boolean;
	includeName?: boolean;
	includeProperties?: boolean;
	subpath?: string;
}

export enum VaultModifier {
	Note = "note",
	Folder = "folder",
	Property = "property",
}

export interface CannoliData {
	text: string;
	status: CannoliObjectStatus;
	dependencies: string[];
	originalObject: string | null;
	kind: CannoliObjectKind;
	type: EdgeType | NodeType | GroupType;
}

export interface CannoliVertexData extends CannoliData {
	outgoingEdges: string[];
	incomingEdges: string[];
	groups: string[];
}

export interface CannoliEdgeData extends CannoliData {
	crossingInGroups: string[];
	crossingOutGroups: string[];
	addMessages: boolean;
	isReflexive: boolean;
	content?: string | Record<string, string>;
	messages?: ChatCompletionMessage[];
	name?: string;
	vaultModifier?: VaultModifier;
}

export interface CannoliGroupData extends CannoliVertexData {
	members: string[];
	maxLoops?: number;
	currentLoop?: number;
}

export interface CannoliNodeData extends CannoliVertexData {
	references?: Reference[];
}

export interface CannoliCanvasFileData extends CanvasFileData {
	cannoliData?: CannoliNodeData;
}

export interface CannoliCanvasTextData extends CanvasTextData {
	cannoliData?: CannoliNodeData;
}

export interface CannoliCanvasLinkData extends CanvasLinkData {
	cannoliData?: CannoliNodeData;
}

export interface CannoliCanvasGroupData extends CanvasGroupData {
	cannoliData?: CannoliGroupData;
}

export interface CannoliCanvasEdgeData extends CanvasEdgeData {
	cannoliData?: CannoliEdgeData;
}

export interface VerifiedCannoliCanvasFileData extends CanvasFileData {
	cannoliData: CannoliNodeData;
}

export interface VerifiedCannoliCanvasTextData extends CanvasTextData {
	cannoliData: CannoliNodeData;
}

export interface VerifiedCannoliCanvasLinkData extends CanvasLinkData {
	cannoliData: CannoliNodeData;
}

export interface VerifiedCannoliCanvasGroupData extends CanvasGroupData {
	cannoliData: CannoliGroupData;
}

export interface VerifiedCannoliCanvasEdgeData extends CanvasEdgeData {
	cannoliData: CannoliEdgeData;
}

export type AllCannoliCanvasNodeData =
	| CannoliCanvasFileData
	| CannoliCanvasTextData
	| CannoliCanvasLinkData
	| CannoliCanvasGroupData;

export type AllVerifiedCannoliCanvasNodeData =
	| VerifiedCannoliCanvasFileData
	| VerifiedCannoliCanvasTextData
	| VerifiedCannoliCanvasLinkData
	| VerifiedCannoliCanvasGroupData;

export interface CannoliCanvasData extends CanvasData {
	nodes: AllCannoliCanvasNodeData[];
	edges: CannoliCanvasEdgeData[];
}

export interface VerifiedCannoliCanvasData extends CanvasData {
	nodes: AllVerifiedCannoliCanvasNodeData[];
	edges: VerifiedCannoliCanvasEdgeData[];
}

export class CannoliGraph {
	cannoliCanvasData: VerifiedCannoliCanvasData;
	graph: Record<string, CannoliObject> = {};

	constructor(cannoliCanvasData: VerifiedCannoliCanvasData) {
		this.cannoliCanvasData = cannoliCanvasData;

		this.hydrateGraph();
		this.addGraphToAll();
		this.setupAllListeners();
	}

	hydrateGraph() {
		for (const node of this.cannoliCanvasData.nodes) {
			switch (node.cannoliData?.type) {
				case GroupType.ForEach: {
					const forEachGroup = node as VerifiedCannoliCanvasGroupData;
					this.graph[node.id] = new ForEachGroup(forEachGroup);
					break;
				}
				case GroupType.Repeat: {
					const repeatGroup = node as VerifiedCannoliCanvasGroupData;
					this.graph[node.id] = new RepeatGroup(repeatGroup);
					break;
				}
				case GroupType.Basic: {
					const basicGroup = node as VerifiedCannoliCanvasGroupData;
					this.graph[node.id] = new CannoliGroup(basicGroup);
					break;
				}
				case ContentNodeType.StandardContent: {
					const standardContentNode =
						node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new ContentNode(standardContentNode);
					break;
				}
				case ContentNodeType.Reference: {
					const referenceNode = node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new ReferenceNode(referenceNode);
					break;
				}
				case ContentNodeType.Formatter: {
					const formatterNode = node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new FormatterNode(formatterNode);
					break;
				}
				case ContentNodeType.Http: {
					const httpNode = node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new HttpNode(httpNode);
					break;
				}
				case CallNodeType.StandardCall: {
					const standardCallNode =
						node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new CallNode(standardCallNode);
					break;
				}
				case CallNodeType.Choose: {
					const chooseNode = node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new ChooseNode(chooseNode);
					break;
				}
				case CallNodeType.Distribute: {
					const distributeNode =
						node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new DistributeNode(distributeNode);
					break;
				}
				case CallNodeType.Accumulate: {
					const accumulateNode =
						node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new AccumulateNode(accumulateNode);
					break;
				}
				case CallNodeType.Categorize: {
					console.error("Categorize node not implemented");
					// const categorizeNode =
					// 	node as VerifiedCannoliCanvasTextData;
					// this.graph[node.id] = new CategorizeNode(categorizeNode);
					break;
				}
				case CallNodeType.Select: {
					console.error("Select node not implemented");
					// const selectNode = node as VerifiedCannoliCanvasTextData;
					// this.graph[node.id] = new SelectNode(selectNode);
					break;
				}
				case FloatingNodeType.Variable: {
					const variableNode = node as VerifiedCannoliCanvasTextData;
					this.graph[node.id] = new FloatingNode(variableNode);
					break;
				}

				default: {
					throw new Error(
						`Unknown node type: ${node.cannoliData?.type}`
					);
				}
			}
		}

		for (const edge of this.cannoliCanvasData.edges) {
			switch (edge.cannoliData?.type) {
				case EdgeType.Logging: {
					const loggingEdge = edge as VerifiedCannoliCanvasEdgeData;
					this.graph[edge.id] = new LoggingEdge(loggingEdge);
					break;
				}
				case EdgeType.SystemMessage: {
					const systemMessageEdge =
						edge as VerifiedCannoliCanvasEdgeData;
					this.graph[edge.id] = new SystemMessageEdge(
						systemMessageEdge
					);
					break;
				}
				case EdgeType.ChatConverter: {
					const chatConverterEdge =
						edge as VerifiedCannoliCanvasEdgeData;
					this.graph[edge.id] = new ChatConverterEdge(
						chatConverterEdge
					);
					break;
				}
				case EdgeType.ChatResponse: {
					const chatResponseEdge =
						edge as VerifiedCannoliCanvasEdgeData;
					this.graph[edge.id] = new ChatResponseEdge(
						chatResponseEdge
					);
					break;
				}

				default: {
					const genericEdge = edge as VerifiedCannoliCanvasEdgeData;
					this.graph[edge.id] = new CannoliEdge(genericEdge);
					break;
				}
			}
		}
	}

	addGraphToAll() {
		// Call setGraph with the graph on every object
		for (const id in this.graph) {
			this.graph[id].setGraph(this.graph, this);
		}
	}

	setupAllListeners() {
		// Call setupListeners on every object
		for (const id in this.graph) {
			this.graph[id].setupListeners();
		}
	}

	isEdge(edge: CannoliObject): edge is CannoliEdge {
		return edge.kind === CannoliObjectKind.Edge;
	}

	isNode(node: CannoliObject): node is CannoliNode {
		return node.kind === CannoliObjectKind.Node;
	}

	isGroup(group: CannoliObject): group is CannoliGroup {
		return group.kind === CannoliObjectKind.Group;
	}
}
