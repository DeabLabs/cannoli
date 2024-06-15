import { TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { Persistor, CannoliCanvasData, CanvasData, AllCanvasNodeData, CanvasEdgeData, AllCannoliCanvasNodeData, CannoliCanvasEdgeData } from "@deablabs/cannoli-core";

export class ObsidianCanvas implements Persistor {
	canvasFile: TFile;
	editQueue: Promise<unknown>;
	allowCannoliData: boolean;

	constructor(canvasData: CanvasData, persistor?: TFile, allowCannoliData: boolean = false) {
		this.allowCannoliData = allowCannoliData;

		if (!persistor) {
			throw new Error("No canvas file provided");
		}

		this.canvasFile = persistor;

		this.editQueue = Promise.resolve();
	}

	async start(newCanvasData: CannoliCanvasData) {
		this.enqueueRemoveAllErrorNodes();

		const canvasData = await this.readCanvasData();

		newCanvasData.nodes.forEach((node) => {
			const existingNode = canvasData.nodes.find((n) => n.id === node.id);

			if (!this.allowCannoliData) {
				if (node.cannoliData?.originalObject) {
					// if (node.color === "5" && node.type === "group") {
					// 	const parallelGroup = node as CannoliCanvasGroupData;

					// 	const parentGroups = parallelGroup.cannoliData?.groups || [];
					// 	const hasParentParallelGroup = parentGroups.some((group) => newCanvasData.nodes.find((n) => n.id === group)?.color === "5");

					// 	const originalParallelGroup = canvasData.nodes.find((n) => n.id === parallelGroup.cannoliData?.originalObject) as CannoliCanvasGroupData;

					// 	if (!hasParentParallelGroup && originalParallelGroup) {
					// 		this.parallelGroupTracker.set(originalParallelGroup.id, 0);
					// 		originalParallelGroup.label = `0/${parallelGroup.cannoliData?.maxLoops}`;
					// 	}
					// }

					return;
				}

				delete node.cannoliData;
			}

			if (existingNode) {
				Object.assign(existingNode, node);
			} else {
				canvasData.nodes.push(node);
			}
		});

		newCanvasData.edges.forEach((edge) => {
			const existingEdge = canvasData.edges.find((e) => e.id === edge.id);

			if (!this.allowCannoliData) {
				if (edge.cannoliData?.originalObject) {
					return;
				}

				delete edge.cannoliData;
			}

			if (existingEdge) {
				Object.assign(existingEdge, edge);
			} else {
				canvasData.edges.push(edge);
			}
		});

		await this.writeCanvasData(canvasData);
	}

	async editNode(newNode: AllCannoliCanvasNodeData): Promise<void> {
		this.editQueue = this.editQueue.then(async () => {
			const canvasData = await this.readCanvasData();
			const existingNode = canvasData.nodes.find((n) => n.id === newNode.id);
			if (existingNode) {
				// keep the old x, y, height, and width
				newNode.x = existingNode.x;
				newNode.y = existingNode.y;
				newNode.height = existingNode.height;
				newNode.width = existingNode.width;

				if (!this.allowCannoliData) {
					if (newNode.cannoliData?.originalObject) {
						// if (newNode.cannoliData?.status === CannoliObjectStatus.Complete &&
						// 	this.parallelGroupTracker.get(newNode.cannoliData?.originalObject)
						// ) {
						// 	const currentCount = this.parallelGroupTracker.get(newNode.cannoliData?.originalObject) || 0;

						// 	this.parallelGroupTracker.set(newNode.cannoliData?.originalObject, currentCount + 1);
						// 	const originalParallelGroup = canvasData.nodes.find((n) => n.id === newNode.cannoliData?.originalObject) as CannoliCanvasGroupData;
						// 	originalParallelGroup.label = `${currentCount + 1}/${originalParallelGroup.cannoliData?.maxLoops}`;
						// }

						return;
					}

					delete newNode.cannoliData;
				}

				Object.assign(existingNode, newNode);
			}
			await this.writeCanvasData(canvasData);
		});
	}

	async editEdge(newEdge: CannoliCanvasEdgeData): Promise<void> {
		this.editQueue = this.editQueue.then(async () => {
			const canvasData = await this.readCanvasData();
			const existingEdge = canvasData.edges.find((e) => e.id === newEdge.id);
			if (existingEdge) {
				if (!this.allowCannoliData) {
					if (newEdge.cannoliData?.originalObject) {
						return;
					}

					delete newEdge.cannoliData;
				}

				Object.assign(existingEdge, newEdge);
			}

			await this.writeCanvasData(canvasData);
		});
	}

	async readCanvasData(): Promise<CannoliCanvasData> {
		const fileContent = await this.canvasFile.vault.read(this.canvasFile);
		return JSON.parse(fileContent);
	}

	private async writeCanvasData(data: CannoliCanvasData) {
		const newContent = JSON.stringify(data);

		// Callback function of the type '(data: string) => string'. Called to edit the file contents.
		const onEdit = (data: string) => {
			return newContent;
		};

		await this.canvasFile.vault.process(this.canvasFile, onEdit);
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

	async addError(nodeId: string, message: string) {
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

	async addWarning(nodeId: string, message: string) {
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
