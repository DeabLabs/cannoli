import {
  CanvasData,
  CanvasEdgeData,
  CanvasFileData,
  CanvasGroupData,
  CanvasLinkData,
  CanvasTextData,
} from "./persistor";

import { GenericCompletionResponse } from "./providers";
import { ReceiveInfo } from "./run";
import { CannoliObject } from "./graph/CannoliObject";
import { CannoliEdge } from "./graph/objects/CannoliEdge";
import { ChatConverterEdge } from "./graph/objects/edges/ChatConverterEdge";
import { ChatResponseEdge } from "./graph/objects/edges/ChatResponseEdge";
import { LoggingEdge } from "./graph/objects/edges/LoggingEdge";
import { SystemMessageEdge } from "./graph/objects/edges/SystemMessageEdge";
import { CannoliGroup } from "./graph/objects/vertices/CannoliGroup";
import { CannoliNode } from "./graph/objects/vertices/CannoliNode";
import { RepeatGroup } from "./graph/objects/vertices/groups/RepeatGroup";
import { ChooseNode } from "./graph/objects/vertices/nodes/call/ChooseNode";
import { FormNode } from "./graph/objects/vertices/nodes/call/FormNode";
import { CallNode } from "./graph/objects/vertices/nodes/CallNode";
import { FormatterNode } from "./graph/objects/vertices/nodes/content/FormatterNode";
import { HttpNode } from "./graph/objects/vertices/nodes/content/HttpNode";
import { ReferenceNode } from "./graph/objects/vertices/nodes/content/ReferenceNode";
import { SearchNode } from "./graph/objects/vertices/nodes/content/SearchNode";
import { ContentNode } from "./graph/objects/vertices/nodes/ContentNode";
import { FloatingNode } from "./graph/objects/FloatingNode";
import { SubcannoliNode } from "./graph/objects/vertices/nodes/content/SubcannoliNote";

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
  Field = "field",
  List = "list",
  Item = "item",
  Choice = "choice",
  Config = "config",
  Logging = "logging",
}

export enum CannoliObjectStatus {
  Pending = "pending",
  Executing = "executing",
  Complete = "complete",
  Rejected = "rejected",
  Error = "error",
  Warning = "warning",
  VersionComplete = "version-complete",
}

export type NodeType = CallNodeType | ContentNodeType | FloatingNodeType;

export enum CallNodeType {
  StandardCall = "standard-call",
  Choose = "choose",
  Form = "form",
}

export enum ContentNodeType {
  StandardContent = "standard-content",
  Input = "input",
  Output = "output",
  Reference = "reference",
  Formatter = "formatter",
  Http = "http",
  Search = "search",
  Subcannoli = "subcannoli",
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
  Selection = "selection",
}

export interface Reference {
  name: string;
  type: ReferenceType;
  shouldExtract: boolean;
  includeName?: boolean;
  includeProperties?: boolean;
  includeLink?: boolean;
  subpath?: string;
}

export enum EdgeModifier {
  Note = "note",
  Folder = "folder",
  Property = "property",
  List = "list",
  Headers = "headers",
  Table = "table",
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
  groups: string[];
  receiveInfo?: ReceiveInfo;
}

export interface CannoliEdgeData extends CannoliData {
  crossingInGroups: string[];
  crossingOutGroups: string[];
  addMessages: boolean;
  isReflexive: boolean;
  content?: string | Record<string, string>;
  messages?: GenericCompletionResponse[];
  name?: string;
  edgeModifier?: EdgeModifier;
  versions?: {
    header: string | null;
    subHeader: string | null;
  }[];
}

export interface CannoliGroupData extends CannoliVertexData {
  maxLoops?: number;
  currentLoop?: number;
  fromForEach?: boolean;
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
        case GroupType.Repeat: {
          const repeatGroup = node as VerifiedCannoliCanvasGroupData;
          this.graph[node.id] = new RepeatGroup(
            repeatGroup,
            this.cannoliCanvasData,
          );
          break;
        }
        case GroupType.Basic: {
          const basicGroup = node as VerifiedCannoliCanvasGroupData;
          this.graph[node.id] = new CannoliGroup(
            basicGroup,
            this.cannoliCanvasData,
          );
          break;
        }
        case ContentNodeType.StandardContent: {
          const standardContentNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new ContentNode(
            standardContentNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case ContentNodeType.Input: {
          const inputNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new ContentNode(
            inputNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case ContentNodeType.Output: {
          const outputNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new ContentNode(
            outputNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case ContentNodeType.Reference: {
          const referenceNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new ReferenceNode(
            referenceNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case ContentNodeType.Formatter: {
          const formatterNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new FormatterNode(
            formatterNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case ContentNodeType.Http: {
          const httpNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new HttpNode(httpNode, this.cannoliCanvasData);
          break;
        }
        case ContentNodeType.Subcannoli: {
          const subcannoliNode = node as VerifiedCannoliCanvasFileData;
          this.graph[node.id] = new SubcannoliNode(
            subcannoliNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case ContentNodeType.Search: {
          const searchNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new SearchNode(
            searchNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case CallNodeType.StandardCall: {
          const standardCallNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new CallNode(
            standardCallNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case CallNodeType.Choose: {
          const chooseNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new ChooseNode(
            chooseNode,
            this.cannoliCanvasData,
          );
          break;
        }
        case CallNodeType.Form: {
          const formNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new FormNode(formNode, this.cannoliCanvasData);
          break;
        }
        case FloatingNodeType.Variable: {
          const variableNode = node as VerifiedCannoliCanvasTextData;
          this.graph[node.id] = new FloatingNode(
            variableNode,
            this.cannoliCanvasData,
          );
          break;
        }

        default: {
          throw new Error(`Unknown node type: ${node.cannoliData?.type}`);
        }
      }
    }

    for (const edge of this.cannoliCanvasData.edges) {
      switch (edge.cannoliData?.type) {
        case EdgeType.Logging: {
          const loggingEdge = edge as VerifiedCannoliCanvasEdgeData;
          this.graph[edge.id] = new LoggingEdge(
            loggingEdge,
            this.cannoliCanvasData,
          );
          break;
        }
        case EdgeType.SystemMessage: {
          const systemMessageEdge = edge as VerifiedCannoliCanvasEdgeData;
          this.graph[edge.id] = new SystemMessageEdge(
            systemMessageEdge,
            this.cannoliCanvasData,
          );
          break;
        }
        case EdgeType.ChatConverter: {
          const chatConverterEdge = edge as VerifiedCannoliCanvasEdgeData;
          this.graph[edge.id] = new ChatConverterEdge(
            chatConverterEdge,
            this.cannoliCanvasData,
          );
          break;
        }
        case EdgeType.ChatResponse: {
          const chatResponseEdge = edge as VerifiedCannoliCanvasEdgeData;
          this.graph[edge.id] = new ChatResponseEdge(
            chatResponseEdge,
            this.cannoliCanvasData,
          );
          break;
        }

        default: {
          const genericEdge = edge as VerifiedCannoliCanvasEdgeData;
          this.graph[edge.id] = new CannoliEdge(
            genericEdge,
            this.cannoliCanvasData,
          );
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
