import { CanvasData } from "obsidian/canvas";
import {
	CannoliEdge,
	CannoliGroup,
	CannoliNode,
	CannoliObject,
	CannoliVertex,
} from "./models";
import { Vault } from "obsidian";

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

		// Categorize edges
		const thirdVersion = this.createTypedEdges(edgesNodesGroups);

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
					node
				);
			} else if (node.type === "group") {
				graph[node.id] = new CannoliVertex(
					node.id,
					node.label ?? "",
					graph,
					node
				);
			}
		});

		canvas.edges.forEach((edge) => {
			graph[edge.id] = new CannoliEdge(
				edge.id,
				edge.text,
				graph,
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
}
