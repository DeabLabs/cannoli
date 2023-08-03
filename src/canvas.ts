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

	private addErrorNode(data: CanvasData, nodeId: string): CanvasData {
		const node = data.nodes.find((node) => node.id === nodeId);
		if (node) {
			const newNodeId = this.generateNewId();
			const errorNode: CanvasTextData = {
				id: newNodeId,
				x: node.x + 100,
				y: node.y,
				width: node.width,
				height: node.height,
				color: "1",
				text: "Error",
				type: "text", // Add the 'type' property
			};
			const newEdge: CanvasEdgeData = {
				id: this.generateNewId(),
				fromNode: nodeId,
				fromSide: "right",
				toNode: newNodeId,
				toSide: "left",
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

	async enqueueAddErrorNode(nodeId: string) {
		this.editQueue = this.editQueue.then(async () => {
			const data = await this.readCanvasData();
			const newData = this.addErrorNode(data, nodeId);
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

	// parseVariablesInContent(
	// 	node: CannoliNode,
	// 	nodes: Record<string, CannoliNode>,
	// 	cannoli: CannoliGraph,
	// 	suppressErrors = false
	// ): {
	// 	references: Reference[];
	// 	renderFunction: (references: Reference[]) => Promise<string>;
	// } {
	// 	const variables = node.incomingEdges.flatMap((edge) => edge.variables);
	// 	const content = node.content;
	// 	const regex = /\{\[\[(.+?)\]\]\}|\{\[(.+?)\]\}|{{(.+?)}}|{(.+?)}/g;
	// 	let match: RegExpExecArray | null;
	// 	const references: Reference[] = [];
	// 	let contentCopy = content;

	// 	const lines = contentCopy.split("\n");
	// 	const tableLines: { [index: number]: boolean } = {};
	// 	lines.forEach((line, index) => {
	// 		if (line.trim().startsWith("#")) {
	// 			tableLines[index] = true;
	// 		}
	// 	});

	// 	while ((match = regex.exec(contentCopy)) !== null) {
	// 		let sourceType: "note" | "floating" | "variable" = "variable";
	// 		let name = "";
	// 		let isExtracted = false;
	// 		let valid = true;
	// 		let resolvedVariable: Variable | undefined;
	// 		let groupId: number | null = null;

	// 		const lineIndex =
	// 			contentCopy.substring(0, match.index).split("\n").length - 1;
	// 		if (tableLines[lineIndex]) {
	// 			groupId = lineIndex;
	// 		}

	// 		if (match[1]) {
	// 			// Note reference
	// 			sourceType = "note";
	// 			name = match[1];
	// 			const note = cannoli.vault
	// 				.getMarkdownFiles()
	// 				.find((file) => file.basename === name);
	// 			if (!note) {
	// 				if (!suppressErrors) {
	// 					throw new Error(`Note ${name} not found`);
	// 				}
	// 				valid = false;
	// 			}
	// 		} else if (match[2]) {
	// 			// Floating variable reference
	// 			sourceType = "floating";
	// 			name = match[2];
	// 			const floatingNodes = Object.values(nodes).filter(
	// 				(node) => node.type === "floating"
	// 			);
	// 			const floatingNode = floatingNodes.find((node) =>
	// 				node.content.startsWith(`[${name}]`)
	// 			);
	// 			if (!floatingNode) {
	// 				if (!suppressErrors) {
	// 					throw new Error(`Floating variable ${name} not found`);
	// 				}
	// 				valid = false;
	// 			}
	// 		} else if (match[3] || match[4]) {
	// 			// Regular variable
	// 			name = match[3] || match[4];
	// 			isExtracted = !!match[3];
	// 			resolvedVariable = variables.find(
	// 				(variable) =>
	// 					variable.name === name && variable.type !== "config"
	// 			);

	// 			if (!resolvedVariable) {
	// 				if (!suppressErrors) {
	// 					throw new Error(
	// 						`Invalid Cannoli layout: Node has missing variables in incoming edges: ${name}`
	// 					);
	// 				}
	// 				valid = false;
	// 			}
	// 		}

	// 		const reference: Reference = {
	// 			name,
	// 			sourceType,
	// 			isExtracted,
	// 			valid,
	// 			position: references.length,
	// 			resolvedVariable,
	// 			groupId,
	// 		};
	// 		references.push(reference);
	// 		contentCopy = contentCopy.replace(
	// 			match[0],
	// 			`{${references.length - 1}}`
	// 		);
	// 	}

	// 	const renderFunction = async (references: Reference[]) => {
	// 		// Prepare a list of promises for each reference to be resolved
	// 		const referencePromises = references.map(async (reference) => {
	// 			let value = "{invalid reference}";

	// 			if (
	// 				reference.sourceType === "variable" &&
	// 				reference.valid &&
	// 				reference.resolvedVariable
	// 			) {
	// 				value = String(reference.resolvedVariable.value);
	// 			} else if (reference.sourceType === "note" && reference.valid) {
	// 				if (reference.isExtracted) {
	// 					const file = cannoli.vault
	// 						.getMarkdownFiles()
	// 						.find((file) => file.basename === reference.name);
	// 					if (!file) {
	// 						throw new Error(`Note ${reference.name} not found`);
	// 					}

	// 					const fileContent = await cannoli.vault.read(file);
	// 					value = fileContent;
	// 				} else {
	// 					value = `[[${reference.name}]]`;
	// 				}
	// 			} else if (
	// 				reference.sourceType === "floating" &&
	// 				reference.valid
	// 			) {
	// 				if (reference.isExtracted) {
	// 					const floatingNode = Object.values(nodes).find(
	// 						(node) =>
	// 							node.type === "floating" &&
	// 							node.content.startsWith(`[${reference.name}]`)
	// 					);

	// 					// Get everything after the first line
	// 					if (!floatingNode) {
	// 						throw new Error(
	// 							`Floating variable ${reference.name} not found`
	// 						);
	// 					}

	// 					value = floatingNode.content
	// 						.split("\n")
	// 						.slice(1)
	// 						.join("\n");
	// 				} else {
	// 					value = `[${reference.name}]`;
	// 				}
	// 			}

	// 			return value;
	// 		});

	// 		// Wait for all the promises to resolve
	// 		const resolvedReferences = await Promise.all(referencePromises);

	// 		// Now we can use replace, as we have all the values
	// 		return contentCopy.replace(/\{(\d+)\}/g, (match, index) => {
	// 			return resolvedReferences[Number(index)];
	// 		});
	// 	};

	// 	return { references, renderFunction };

	// 	return { references, renderFunction };
	// }

	// containsValidReferences(
	// 	content: string,
	// 	variables: Variable[],
	// 	cannoli: CannoliGraph
	// ): boolean {
	// 	const regex = /{{(.+?)}}|{(.+?)}|{\[\[(.+?)\]\]}|{\[(.+?)\]}/g;
	// 	let match;

	// 	while ((match = regex.exec(content)) !== null) {
	// 		console.log("Match found: ", match);

	// 		if (match[3]) {
	// 			// Note reference
	// 			const noteName = match[3];
	// 			console.log("Checking for note reference: ", noteName);
	// 			const note = cannoli.vault
	// 				.getMarkdownFiles()
	// 				.find((file) => file.basename === noteName);
	// 			if (note) {
	// 				console.log("Note found: ", note);
	// 				return true;
	// 			} else {
	// 				console.log("Note not found.");
	// 			}
	// 		} else if (match[4]) {
	// 			// Floating variable reference
	// 			const varName = match[4];
	// 			console.log("Checking for floating variable: ", varName);
	// 			const floatingNode = Object.values(cannoli.nodes).find(
	// 				(node) =>
	// 					node.type === "floating" &&
	// 					node.content.startsWith(varName)
	// 			);
	// 			if (floatingNode) {
	// 				console.log("Floating variable found: ", floatingNode);
	// 				return true;
	// 			} else {
	// 				console.log("Floating variable not found.");
	// 			}
	// 		} else if (match[1] || match[2]) {
	// 			// Regular variable
	// 			const variableName = match[1] || match[2];
	// 			console.log("Checking for regular variable: ", variableName);
	// 			const variableExists = variables.some(
	// 				(variable) =>
	// 					variable.name === variableName &&
	// 					variable.type !== "config"
	// 			);
	// 			if (variableExists) {
	// 				console.log("Variable exists: ", variableName);
	// 				return true;
	// 			} else {
	// 				console.log("Variable not found: ", variableName);
	// 			}
	// 		}
	// 	}

	// 	// If no valid references were found
	// 	console.log("No valid references were found.");
	// 	return false;
	// }
}
