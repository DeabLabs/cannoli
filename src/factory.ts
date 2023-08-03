import { CanvasData } from "obsidian/canvas";
import {
	CallNode,
	CannoliEdge,
	CannoliGroup,
	CannoliNode,
	CannoliObject,
	CannoliVertex,
	ChatEdge,
	ConfigEdge,
	ContentNode,
	FloatingNode,
	ListGroup,
	LoggingEdge,
	MultipleVariableEdge,
	MultipleVariableEdgeType,
	RepeatGroup,
	SingleVariableEdge,
	SingleVariableEdgeType,
	SystemMessageEdge,
	WriteEdge,
} from "./models";
import { Vault } from "obsidian";

export enum NodeType {
	Call,
	Content,
	Floating,
}

export enum GroupType {
	Repeat,
	List,
}

export enum EdgeType {
	Standard,
	Write,
	Logging,
	Config,
	Chat,
	SystemMessage,
	List,
	Category,
	Function,
	ListItem,
	Choice,
	Vault,
	SingleVariable,
}

export class CannoliFactory {
	vault: Vault;
	parse(canvas: CanvasData): Record<string, CannoliObject> {
		// Create initial objects
		const edgesAndVertices = this.initialParse(canvas);

		// Assign enclosing groups to vertices
		this.setAllGroups(edgesAndVertices);

		// Assign edges to vertices
		this.setAllIncomingAndOutgoingEdges(edgesAndVertices);

		// Create nodes and groups
		const edgesNodesGroups = this.createNodesAndGroups(edgesAndVertices);

		// Set group members
		this.setAllGroupMembers(edgesNodesGroups);

		// Set crossing groups
		this.setAllCrossingGroups(edgesNodesGroups);

		// Categorize nodes and group types
		const edgesAndTypedVertices =
			this.createTypedVertices(edgesNodesGroups);

		// Categorize edges
		const typedEdgesAndVertices = this.createTypedEdges(
			edgesAndTypedVertices
		);

		return initialObjects;
	}

	constructor(vault: Vault) {
		this.vault = vault;
	}

	initialParse(canvas: CanvasData): Record<string, CannoliObject> {
		const graph: Record<string, CannoliObject> = {};

		canvas.nodes.forEach((node) => {
			if (node.type === "text" || node.type === "link") {
				graph[node.id] = new CannoliVertex(
					node.id,
					node.content,
					graph,
					false,
					node
				);
			} else if (node.type === "group") {
				graph[node.id] = new CannoliVertex(
					node.id,
					node.label ?? "",
					graph,
					false,
					node
				);
			}
		});

		canvas.edges.forEach((edge) => {
			graph[edge.id] = new CannoliEdge(
				edge.id,
				edge.text,
				graph,
				false,
				edge,

				edge.fromNode,
				edge.toNode
			);
		});

		return graph;
	}

	setAllIncomingAndOutgoingEdges(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			if (object instanceof CannoliEdge) {
				object.setIncomingAndOutgoingEdges();
			}
		}
	}

	setAllGroups(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			if (object instanceof CannoliVertex) {
				object.setGroups();
			}
		}
	}

	createNodesAndGroups(graph: Record<string, CannoliObject>) {
		const newGraph: Record<string, CannoliObject> = {};
		Object.values(graph).forEach((object) => {
			if (object instanceof CannoliVertex) {
				if (object.canvasData.type === "group") {
					const group = new CannoliGroup(
						object.id,
						object.text,
						graph,
						false,
						object.canvasData
					);
					newGraph[object.id] = group;
				} else if (
					object.canvasData.type === "text" ||
					object.canvasData.type === "link"
				) {
					const node = new CannoliNode(
						object.id,
						object.text,
						graph,
						false,
						object.canvasData
					);
					newGraph[object.id] = node;
				}
			}
		});

		return newGraph;
	}

	setAllGroupMembers(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			if (object instanceof CannoliGroup) {
				object.setMembers();
			}
		}
	}

	setAllCrossingGroups(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			if (object instanceof CannoliEdge) {
				object.setCrossingGroups();
			}
		}
	}

	createTypedVertices(
		graph: Record<string, CannoliObject>
	): Record<string, CannoliObject> {
		const newGraph: Record<string, CannoliObject> = {};
		Object.values(graph).forEach((object) => {
			// If object is a node, categorize it
			if (object instanceof CannoliNode) {
				const type = object.decideType();
				switch (type) {
					case NodeType.Call:
						newGraph[object.id] = new CallNode(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData
						);
						break;
					case NodeType.Content:
						newGraph[object.id] = new ContentNode(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData
						);
						break;
					case NodeType.Floating:
						newGraph[object.id] = new FloatingNode(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData
						);
						break;

					default:
						break;
				}
			} else if (object instanceof CannoliGroup) {
				const type = object.decideType();

				switch (type) {
					case GroupType.Repeat: {
						const maxLoops = object.getLabelNumber();

						if (maxLoops) {
							newGraph[object.id] = new RepeatGroup(
								object.id,
								object.text,
								graph,
								false,
								object.canvasData,
								maxLoops
							);
						}
						break;
					}
					case GroupType.List: {
						const numberOfVersions = object.getLabelNumber();

						if (numberOfVersions) {
							newGraph[object.id] = new ListGroup(
								object.id,
								object.text,
								graph,
								false,
								object.canvasData,
								numberOfVersions,
								0
							);
						}
						break;
					}

					default:
						break;
				}
			} else if (object instanceof CannoliEdge) {
				// Same edge
				newGraph[object.id] = object;
			}
		});

		return newGraph;
	}

	createTypedEdges(
		graph: Record<string, CannoliObject>
	): Record<string, CannoliObject> {
		const newGraph: Record<string, CannoliObject> = {};
		Object.values(graph).forEach((object) => {
			// If object is a node, categorize it
			if (object instanceof CannoliEdge) {
				const type = object.decideType();
				switch (type) {
					case EdgeType.Write:
						newGraph[object.id] = new WriteEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target
						);
						break;
					case EdgeType.Logging:
						newGraph[object.id] = new LoggingEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target
						);
						break;
					case EdgeType.Config: {
						const setting = object.getVariableInfo();
						newGraph[object.id] = new ConfigEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target,
							setting.name
						);
						break;
					}
					case EdgeType.Chat: {
						newGraph[object.id] = new ChatEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target
						);
						break;
					}
					case EdgeType.SystemMessage:
						newGraph[object.id] = new SystemMessageEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target
						);
						break;
					case EdgeType.ListItem: {
						const itemInfo = object.getVariableInfo();
						newGraph[object.id] = new SingleVariableEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target,
							itemInfo.name,
							itemInfo.chatOverride,
							SingleVariableEdgeType.ListItem
						);
						break;
					}
					case EdgeType.Category: {
						const catInfo = object.getVariableInfo();
						newGraph[object.id] = new MultipleVariableEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target,
							catInfo.name,
							catInfo.chatOverride,
							MultipleVariableEdgeType.Category
						);
						break;
					}
					case EdgeType.Function: {
						const funcInfo = object.getVariableInfo();
						newGraph[object.id] = new MultipleVariableEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target,
							funcInfo.name,
							funcInfo.chatOverride,
							MultipleVariableEdgeType.Function
						);
						break;
					}
					case EdgeType.List: {
						const listInfo = object.getVariableInfo();
						newGraph[object.id] = new MultipleVariableEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target,
							listInfo.name,
							listInfo.chatOverride,
							MultipleVariableEdgeType.List
						);
						break;
					}
					case EdgeType.Choice: {
						const choiceInfo = object.getVariableInfo();
						newGraph[object.id] = new SingleVariableEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target,
							choiceInfo.name,
							choiceInfo.chatOverride,
							SingleVariableEdgeType.Choice
						);
						break;
					}
					case EdgeType.Vault: {
						const vaultInfo = object.getVariableInfo();

						newGraph[object.id] = new SingleVariableEdge(
							object.id,
							object.text,
							graph,
							false,
							object.canvasData,
							object.source,
							object.target,
							vaultInfo.name,
							vaultInfo.chatOverride,
							SingleVariableEdgeType.Vault
						);
						break;
					}
					default:
						break;
				}
			} else {
				// Same node/group
				newGraph[object.id] = object;
			}
		});

		return newGraph;
	}
}
