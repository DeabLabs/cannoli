// import { ErrorModal } from "main";
import { TFile } from "obsidian";
import {
	CanvasColor,
	CanvasData,
	CanvasEdgeData,
	CanvasGroupData,
	CanvasTextData,
} from "obsidian/canvas.d";
import { CannoliGraph } from "./cannoli";
import { v4 as uuidv4 } from "uuid";
import {
	CannoliObject,
	CannoliVertex,
	CannoliObjectStatus,
} from "./models/object";
import { Run } from "./run";
import { CallNode, DisplayNode, FloatingNode, VaultNode } from "./models/node";

export class Canvas {
	canvasFile: TFile;
	canvasData: CanvasData;
	subCanvasGroupId?: string;
	cannoli: CannoliGraph;
	editQueue: Promise<unknown>;

	constructor(
		canvasFile: TFile,
		cannoli: CannoliGraph,
		subCanvasGroupId?: string
	) {
		this.canvasFile = canvasFile;
		this.subCanvasGroupId = subCanvasGroupId;
		this.cannoli = cannoli;

		this.editQueue = Promise.resolve();
	}

	getCanvasData(): CanvasData {
		return this.canvasData;
	}

	async fetchData() {
		const fileContent = await this.canvasFile.vault.read(this.canvasFile);
		const parsedContent = JSON.parse(fileContent) as CanvasData;

		// Search for any nodes with type "group" and text "cannoli"
		for (const node of parsedContent.nodes) {
			if (
				node.type === "group" &&
				(node.label === "cannoli" || node.label === "Cannoli")
			) {
				this.subCanvasGroupId = node.id;
				break;
			}
		}

		this.canvasData = parsedContent;

		// If the subcanvas group id is set, filter the canvas data to only include the nodes and edges in the group
		if (this.subCanvasGroupId) {
			const subCanvasGroup = parsedContent.nodes.find(
				(node) => node.id === this.subCanvasGroupId
			) as CanvasGroupData;
			if (!subCanvasGroup) {
				throw new Error(
					`Group with id ${this.subCanvasGroupId} not found.`
				);
			}

			const { nodeIds, edgeIds } =
				this.getNodesAndEdgesInGroup(subCanvasGroup);

			parsedContent.nodes = parsedContent.nodes.filter(
				(node: { id: string }) => nodeIds.includes(node.id)
			);
			parsedContent.edges = parsedContent.edges.filter(
				(edge: { id: string }) => edgeIds.includes(edge.id)
			);

			// log out stringified version of the filtered canvas data
			console.log(JSON.stringify(parsedContent, null, 2));

			this.canvasData = parsedContent;
		}
	}

	getNodesAndEdgesInGroup(group: CanvasGroupData): {
		nodeIds: string[];
		edgeIds: string[];
	} {
		// Create a rectangle for the given group
		const groupRectangle = this.createRectangle(
			group.x,
			group.y,
			group.width,
			group.height
		);

		// Arrays to store the IDs of nodes and edges within the given group
		const nodeIds: string[] = [];
		const edgeIds: string[] = [];

		// Loop over all nodes in canvasData and check which nodes are within the given group
		for (const node of this.canvasData.nodes) {
			if (node.id === group.id) continue;

			const nodeRectangle = this.createRectangle(
				node.x,
				node.y,
				node.width,
				node.height
			);

			if (this.encloses(groupRectangle, nodeRectangle)) {
				nodeIds.push(node.id);
			} else if (this.overlaps(groupRectangle, nodeRectangle)) {
				throw new Error(
					`Invalid layout: Node with id ${node.id} overlaps with the group but is not fully enclosed. Nodes should be fully inside or outside of each group.`
				);
			}
		}

		// Loop over all edges in canvasData and check which edges are fully within the given group
		for (const edge of this.canvasData.edges) {
			if (
				nodeIds.includes(edge.fromNode) &&
				nodeIds.includes(edge.toNode)
			) {
				edgeIds.push(edge.id);
			}
		}

		return { nodeIds, edgeIds };
	}

	createRectangle(x: number, y: number, width: number, height: number) {
		return {
			x,
			y,
			width,
			height,
			x_right: x + width,
			y_bottom: y + height,
		};
	}

	encloses(
		a: ReturnType<typeof this.createRectangle>,
		b: ReturnType<typeof this.createRectangle>
	): boolean {
		return (
			a.x <= b.x &&
			a.y <= b.y &&
			a.x_right >= b.x_right &&
			a.y_bottom >= b.y_bottom
		);
	}

	overlaps(
		a: ReturnType<typeof this.createRectangle>,
		b: ReturnType<typeof this.createRectangle>
	): boolean {
		const horizontalOverlap = a.x < b.x_right && a.x_right > b.x;
		const verticalOverlap = a.y < b.y_bottom && a.y_bottom > b.y;
		const overlap = horizontalOverlap && verticalOverlap;
		return overlap && !this.encloses(a, b) && !this.encloses(b, a);
	}

	async readCanvasData(): Promise<CanvasData> {
		const fileContent = await this.canvasFile.vault.read(this.canvasFile);
		return JSON.parse(fileContent);
	}

	private async writeCanvasData(data: CanvasData) {
		const newContent = JSON.stringify(data);
		await this.canvasFile.vault.modify(this.canvasFile, newContent);
	}

	setListeners(graph: Record<string, CannoliObject>) {
		for (const object of Object.values(graph)) {
			// Only set listeners for the following objects
			if (object instanceof CannoliVertex) {
				object.on("update", (obj, status, run, message) => {
					this.onObjectUpdate(obj, status, run, message);
				});
			}
		}
	}

	onObjectUpdate(
		object: CannoliObject,
		status: CannoliObjectStatus,
		run: Run,
		message?: string
	) {
		if (run.isMock) {
			return;
		}

		switch (status) {
			case CannoliObjectStatus.Complete:
				this.onObjectComplete(object);
				break;
			case CannoliObjectStatus.Executing:
				this.onObjectExecuting(object);
				break;
			case CannoliObjectStatus.Pending:
				this.onObjectPending(object);
				break;
			case CannoliObjectStatus.Error:
				this.onObjectError(object, message);
				break;
			default:
				break;
		}
	}

	onObjectComplete(object: CannoliObject) {
		if (object instanceof CallNode) {
			this.enqueueChangeNodeColor(object.id, "4");
		} else if (
			object instanceof DisplayNode ||
			object instanceof VaultNode ||
			object instanceof FloatingNode
		) {
			this.enqueueChangeNodeText(object.id, object.text);
		}
	}

	onObjectExecuting(object: CannoliObject) {
		if (object instanceof CallNode) {
			this.enqueueChangeNodeColor(object.id, "3");
		}
	}

	onObjectPending(object: CannoliObject) {
		if (object instanceof CallNode) {
			this.enqueueChangeNodeColor(object.id, "0");
		}
	}

	onObjectError(object: CannoliObject, message?: string) {
		if (object instanceof CannoliVertex && message) {
			this.enqueueAddErrorNode(object.id, message);
		} else {
			throw new Error(
				`Error: Object ${object.id} is not a CannoliVertex or error is undefined.`
			);
		}
	}

	private changeNodeColor(
		data: CanvasData,
		nodeId: string,
		newColor: CanvasColor
	): CanvasData {
		const node = data.nodes.find((node) => node.id === nodeId);
		if (node) {
			node.color = newColor;
		}
		return data;
	}

	private addErrorNode(
		data: CanvasData,
		nodeId: string,
		error: string
	): CanvasData {
		const node = data.nodes.find((node) => node.id === nodeId);
		if (node) {
			const newNodeId = this.generateNewId();
			const errorNode: CanvasTextData = {
				id: newNodeId,
				x: node.x + node.width + 50,
				y: node.y,
				width: 500,
				height: 150,
				color: "1",
				text: `<u>Error:</u>\n` + error,
				type: "text", // Add the 'type' property
			};
			const newEdge: CanvasEdgeData = {
				id: this.generateNewId(),
				fromNode: nodeId,
				fromSide: "right",
				toNode: newNodeId,
				toSide: "left",
				fromEnd: "none",
				toEnd: "none",
				color: "1", // red color
			};
			data.nodes.push(errorNode);
			data.edges.push(newEdge);
		}
		return data;
	}

	private changeNodeText(
		data: CanvasData,
		nodeId: string,
		newText: string
	): CanvasData {
		const node = data.nodes.find((node) => node.id === nodeId);
		if (node) {
			node.text = newText;
		}
		return data;
	}

	async enqueueChangeNodeColor(nodeId: string, newColor: CanvasColor) {
		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.changeNodeColor(data, nodeId, newColor);
			await this.writeCanvasData(newData);
		});
		return this.editQueue;
	}

	async enqueueAddErrorNode(nodeId: string, message: string) {
		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.addErrorNode(data, nodeId, message);
			await this.writeCanvasData(newData);
		});
		return this.editQueue;
	}

	async enqueueChangeNodeText(nodeId: string, newText: string) {
		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.changeNodeText(data, nodeId, newText);
			await this.writeCanvasData(newData);
		});
		return this.editQueue;
	}

	generateNewId(): string {
		return uuidv4().replace(/-/g, "").substring(0, 16);
	}
}
