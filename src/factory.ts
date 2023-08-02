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
		const initialGraph = this.initialParse(canvas);

		// Assign edges to vertices
		this.setAllIncomingAndOutgoingEdges(initialGraph);

		// Assign parent groups to vertices
		this.setAllParentGroups(initialGraph);

		// Create nodes and groups
		const secondVersion = this.createNodesAndGroups(initialGraph);

		// Set group children
		this.setAllGroupChildren(secondVersion);

		// Categorize edges
		const thirdVersion = this.categorizeEdges(secondVersion);

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
				object.setIncomingAndOutgoingEdges(graph);
			}
		}
	}

	setAllParentGroups(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			if (object instanceof CannoliVertex) {
				object.setParentGroups(graph);
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

	setAllGroupChildren(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			if (object instanceof CannoliGroup) {
				object.setChildren(graph);
			}
		}
	}
}
