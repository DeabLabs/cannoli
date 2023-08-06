import { CanvasData } from "obsidian/canvas";
import { Vault } from "obsidian";
import { CannoliObject, CannoliVertex } from "./models/object";
import { CannoliEdge } from "./models/edge";
import { CannoliGroup } from "./models/group";
import { CannoliNode, FloatingNode } from "./models/node";

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

		// Create typed objects
		const typedObjects = this.createTypedObjects(edgesNodesGroups);

		// This is where we would make copies of list groups
		// this.makeListCopies(typedObjects);

		// Set dependencies
		this.setAllDependencies(typedObjects);

		// Set listener functions
		this.setAllListeners(typedObjects);

		// Set special types
		this.setAllSpecialTypes(typedObjects);

		// Return typed objects
		return typedObjects;
	}

	constructor(vault: Vault) {
		this.vault = vault;
	}

	initialParse(canvas: CanvasData): Record<string, CannoliObject> {
		const graph: Record<string, CannoliObject> = {};

		canvas.nodes.forEach((node) => {
			// Ignore red ("1") objects
			if (node.color === "1") {
				return;
			}

			if (node.type === "text" || node.type === "link") {
				graph[node.id] = new CannoliVertex(
					node.id,
					node.text ?? "",
					graph,
					false,
					this.vault,
					node
				);
			} else if (node.type === "group") {
				graph[node.id] = new CannoliVertex(
					node.id,
					node.label ?? "",
					graph,
					false,
					this.vault,
					node
				);
			}
		});

		canvas.edges.forEach((edge) => {
			// Ignore red ("1") objects
			if (edge.color === "1") {
				return;
			}

			graph[edge.id] = new CannoliEdge(
				edge.id,
				edge.label ?? "",
				graph,
				false,
				this.vault,
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
						newGraph,
						false,
						this.vault,
						object.canvasData,
						object.outgoingEdges,
						object.incomingEdges,
						object.groups
					);
					newGraph[object.id] = group;
				} else if (
					object.canvasData.type === "text" ||
					object.canvasData.type === "link"
				) {
					let node;

					// Check if its floating
					if (
						object.outgoingEdges.length === 0 &&
						object.incomingEdges.length === 0
					) {
						node = new FloatingNode(
							object.id,
							object.text,
							newGraph,
							false,
							this.vault,
							object.canvasData
						);
					} else {
						node = new CannoliNode(
							object.id,
							object.text,
							newGraph,
							false,
							this.vault,
							object.canvasData,
							object.outgoingEdges,
							object.incomingEdges,
							object.groups
						);
					}
					newGraph[object.id] = node;
				}
			} else if (object instanceof CannoliEdge) {
				const edge = new CannoliEdge(
					object.id,
					object.text,
					newGraph,
					false,
					this.vault,
					object.canvasData,
					object.source,
					object.target
				);
				newGraph[object.id] = edge;
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

	createTypedObjects(
		graph: Record<string, CannoliObject>
	): Record<string, CannoliObject> {
		const newGraph: Record<string, CannoliObject> = {};
		Object.values(graph).forEach((object) => {
			const typedObject = object.createTyped(newGraph);
			if (typedObject) {
				newGraph[object.id] = typedObject;
			}
		});
		return newGraph;
	}

	setAllListeners(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			object.setupListeners();
		}
	}

	logAll(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			console.log(object.logDetails());
		}
	}

	setAllDependencies(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			object.setDependencies();
		}
	}

	setAllSpecialTypes(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			object.setSpecialType();
		}
	}
}
