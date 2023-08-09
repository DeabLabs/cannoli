// import { ErrorModal } from "main";
import { TFile } from "obsidian";
import {
	CanvasColor,
	CanvasData,
	CanvasEdgeData,
	CanvasGroupData,
	CanvasTextData,
} from "obsidian/canvas.d";
import { v4 as uuidv4 } from "uuid";

export class Canvas {
	canvasFile: TFile;
	canvasData: CanvasData;
	subCanvasGroupId?: string;
	editQueue: Promise<unknown>;

	constructor(canvasFile: TFile, subCanvasGroupId?: string) {
		this.canvasFile = canvasFile;
		this.subCanvasGroupId = subCanvasGroupId;

		this.editQueue = Promise.resolve();
	}

	getCanvasData(): CanvasData {
		return this.canvasData;
	}

	async fetchData() {
		const fileContent = await this.canvasFile.vault.cachedRead(
			this.canvasFile
		);
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
		// await this.canvasFile.vault.modify(this.canvasFile, newContent);

		// Callback function of the type '(data: string) => string'. Called to edit the file contents.
		const onEdit = (data: string) => {
			return newContent;
		};

		await this.canvasFile.vault.process(this.canvasFile, onEdit);
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

		// Find the node's vertical center
		const nodeCenterY = node ? node.y + node.height / 2 : 0;

		if (node) {
			const newNodeId = this.generateNewId();
			const errorNode: CanvasTextData = {
				id: newNodeId,
				x: node.x + node.width + 50,
				y: nodeCenterY - 75,
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

	private removeAllErrorNodes(data: CanvasData): CanvasData {
		// Find all error nodes (nodes that are red and have text starting with "<u>Error:</u>\n")
		const errorNodes = data.nodes.filter(
			(node) =>
				node.color === "1" && node.text?.startsWith("<u>Error:</u>\n")
		);

		// Collect all the IDs of the edges connected to error nodes
		const errorEdgeIds = new Set<string>();
		errorNodes.forEach((node) => {
			data.edges.forEach((edge) => {
				if (edge.fromNode === node.id || edge.toNode === node.id) {
					errorEdgeIds.add(edge.id);
				}
			});
		});

		// Remove all error edges
		data.edges = data.edges.filter((edge) => !errorEdgeIds.has(edge.id));

		// Remove all error nodes
		data.nodes = data.nodes.filter((node) => !errorNodes.includes(node));

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

	async enqueueRemoveAllErrorNodes() {
		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.removeAllErrorNodes(data);
			await this.writeCanvasData(newData);
		});
		return this.editQueue;
	}

	generateNewId(): string {
		return uuidv4().replace(/-/g, "").substring(0, 16);
	}
}
