import { TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { Canvas, CanvasColor, CanvasData, CanvasEdgeData, AllCanvasNodeData } from "@deablabs/cannoli-core";



export class ObsidianCanvas implements Canvas {
	canvasFile: TFile;
	canvasData: CanvasData;
	subCanvasGroupId?: string;
	editQueue: Promise<unknown>;

	constructor(canvasData: CanvasData, persistor?: TFile) {
		this.canvasData = canvasData;

		// Throw error if no persistor is provided
		if (!persistor) {
			throw new Error("No canvas file provided");
		}

		this.canvasFile = persistor;

		this.editQueue = Promise.resolve();
	}

	getCanvasData(): CanvasData {
		return this.canvasData;
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
		newColor?: CanvasColor
	): CanvasData {
		const node = data.nodes.find((node: AllCanvasNodeData) => node.id === nodeId);
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
			const errorNode: AllCanvasNodeData = {
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

	private addWarningNode(
		data: CanvasData,
		nodeId: string,
		error: string
	): CanvasData | null {
		const node = data.nodes.find((node) => node.id === nodeId);

		// Find the node's vertical center
		const nodeCenterY = node ? node.y + node.height / 2 : 0;

		if (node) {
			const newNodeId = this.generateNewId();
			const errorNode: AllCanvasNodeData = {
				id: newNodeId,
				x: node.x + node.width + 50,
				y: nodeCenterY - 75,
				width: 500,
				height: 150,
				color: "1",
				text: `<u>Warning:</u>\n` + error,
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

			// If there's already a node at the same position with the same text, return
			const existingWarningNode = data.nodes.find(
				(node) =>
					node.x === errorNode.x &&
					node.y === errorNode.y &&
					node.width === errorNode.width &&
					node.height === errorNode.height &&
					node.text === errorNode.text
			);

			if (existingWarningNode) {
				return null;
			}

			data.nodes.push(errorNode);
			data.edges.push(newEdge);
		}
		return data;
	}

	private removeAllErrorNodes(data: CanvasData): CanvasData {
		// Find all error nodes (nodes that are red and have text starting with "<u>Error:</u>\n")
		const errorNodes = data.nodes.filter(
			(node) =>
				node.color === "1" &&
				(node.text?.startsWith("<u>Error:</u>\n") ||
					node.text?.startsWith("<u>Warning:</u>\n"))
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
			if (node.type === "text") {
				node.text = newText;
			} else if (node.type === "group") {
				node.label = newText;
			}
		}
		return data;
	}

	async enqueueChangeNodeColor(nodeId: string, newColor?: CanvasColor) {
		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.changeNodeColor(data, nodeId, newColor);
			await this.writeCanvasData(newData);
		});
	}

	async enqueueAddErrorNode(nodeId: string, message: string) {
		// If the id has a "-" in it, remove it and everything after it
		if (nodeId.includes("-")) {
			nodeId = nodeId.split("-")[0];
		}

		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.addErrorNode(data, nodeId, message);
			await this.writeCanvasData(newData);
		});
	}

	async enqueueAddWarningNode(nodeId: string, message: string) {
		// If the id has a "-" in it, remove it and everything after it
		if (nodeId.includes("-")) {
			nodeId = nodeId.split("-")[0];
		}

		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.addWarningNode(data, nodeId, message);
			if (newData) {
				await this.writeCanvasData(newData);
			}
		});
	}

	async enqueueChangeNodeText(nodeId: string, newText: string) {
		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.changeNodeText(data, nodeId, newText);
			await this.writeCanvasData(newData);
		});
	}

	async enqueueRemoveAllErrorNodes() {
		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.removeAllErrorNodes(data);
			await this.writeCanvasData(newData);
		});
	}

	generateNewId(): string {
		return uuidv4().replace(/-/g, "").substring(0, 16);
	}
}
