import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { ErrorModal } from "main";
import { Vault, TFile } from "obsidian";
import { CanvasData } from "obsidian/canvas.d";
import { EventEmitter } from "events";

export async function startCannoli(
	canvasFile: TFile,
	apiKey: string,
	vault: Vault
) {
	console.log(`File Path: ${canvasFile.path}`);
	console.log(`API Key: ${apiKey}`);

	// Create an instance of OpenAI
	const openai = new OpenAIApi(new Configuration({ apiKey: "Your-API-Key" }));

	// Read the content of the file
	const fileContent = await vault.read(canvasFile);

	const canvasData = JSON.parse(fileContent) as CanvasData;

	console.log(canvasData);

	let nodes: Record<string, CannoliNode>;

	try {
		nodes = await processCanvas(canvasData, vault, canvasFile, openai);

		// Rest of the logic goes here with the processed and validated nodes and groups
	} catch (error) {
		new ErrorModal(
			this.app,
			"Error processing canvas: " + error.message
		).open();
		return;
	}

	// Run the cannoli
	await runCannoli(nodes);
}

async function runCannoli(nodes: Record<string, CannoliNode>) {
	const nodeEmitter = new EventEmitter();
	const nodeKeys = Object.keys(nodes);

	// Register listeners for all nodes
	for (const key of nodeKeys) {
		nodes[key].on("done", (node) => {
			console.log(`Node ${node.id} has finished processing.`);
			// React to the node having finished processing, such as by updating a UI or writing to a log
			// Signal the central EventEmitter that a node has finished processing
			nodeEmitter.emit("nodeDone", node);
		});
	}

	// Start all nodes processing (excluding 'globalVar' nodes)
	for (const node of Object.values(nodes)) {
		if (node.type !== "globalVar") {
			node.waitForDependencies(nodes);
		}
	}

	// Listener for the central EventEmitter
	nodeEmitter.on("nodeDone", (node) => {
		// Check if all nodes are done (excluding 'globalVar' nodes)
		if (
			nodeKeys.every(
				(key) =>
					nodes[key].type === "globalVar" ||
					nodes[key].status === "executed" ||
					nodes[key].status === "rejected"
			)
		) {
			console.log("All nodes have finished processing.");
			// Do something after all nodes have finished, if necessary
		}
	});
}

// Top-level function to process and validate the canvas data
async function processCanvas(
	canvasData: CanvasData,
	vault: Vault,
	canvasFile: TFile,
	openai: OpenAIApi
): Promise<Record<string, CannoliNode>> {
	// Process edges
	const edges = processEdges(canvasData);
	// Log out the edges with their properties, formatted nicely. Only using one log statement per edge to avoid cluttering the console
	console.log("Edges:");
	for (const edge of Object.values(edges)) {
		console.log(`
        Edge ${edge.id}
        Source: ${edge.sourceId}
        Target: ${edge.targetId}
        Content: ${edge.content}
        Type: ${edge.type}
        `);
	}

	// Process nodes
	const nodes = await processNodes(
		canvasData,
		edges,
		vault,
		canvasFile,
		openai
	);
	// Log out the properties of the nodes, formatted nicely
	console.log("Nodes:");
	for (const node of Object.values(nodes)) {
		console.log(`
        Node ${node.id}
        Content: ${node.content}
        Status: ${node.status}
        X: ${node.x}
        Y: ${node.y}
        Width: ${node.width}
        Height: ${node.height}
        Type: ${node.type}
        Outgoing Edges: ${node.outgoingEdges.map((edge) => edge.id)}
        Incoming Edges: ${node.incomingEdges.map((edge) => edge.id)}
        `);
	}

	// Process groups
	console.log("Processing groups");
	const groups = processGroups(canvasData, nodes);

	// Validation of structures
	for (const node of Object.values(nodes)) {
		// Check if the graph starting from each node is a DAG
		if (isDAG(node, new Set(), new Set(), nodes)) {
			throw new Error(
				`The call nodes form a cycle, starting from node with id ${node.id}`
			);
		}
	}

	for (const group of Object.values(groups)) {
		// Check if the nodes in the group form a tree structure
		const root = group.nodes.find(
			(node) => node.incomingEdges.length === 0
		);

		if (
			group.nodes.some(
				(node) => node !== root && node.incomingEdges.length !== 1
			)
		) {
			throw new Error(
				`The group with id ${group.id} is not a tree structure`
			);
		}
	}

	return nodes;
}

// Processing function for nodes
async function processNodes(
	canvasData: CanvasData,
	edges: Record<string, CannoliEdge>,
	vault: Vault,
	canvasFile: TFile,
	openai: OpenAIApi
): Promise<Record<string, CannoliNode>> {
	const nodes: Record<string, CannoliNode> = {};

	for (const nodeData of canvasData.nodes) {
		let content = "";
		let type: NodeType = "call"; // Default to "call" type

		if (nodeData.type === "group") {
			continue;
		}

		if ("file" in nodeData) {
			const nodeFile = vault.getAbstractFileByPath(nodeData.file);
			if (nodeFile instanceof TFile) {
				content = await vault.read(nodeFile);
			}
		} else if ("text" in nodeData) {
			content = nodeData.text;
		} else if ("url" in nodeData) {
			content = nodeData.url;
		}

		// Find the outgoing and incoming edge ids of the node in the canvas data
		const outgoingEdgeIds = canvasData.edges
			.filter((edge) => edge.fromNode === nodeData.id)
			.map((edge) => edge.id);
		const incomingEdgeIds = canvasData.edges
			.filter((edge) => edge.toNode === nodeData.id)
			.map((edge) => edge.id);

		// Find the outgoing and incoming edges in the edges object
		const outgoingEdges = Object.values(edges).filter((edge) =>
			outgoingEdgeIds.includes(edge.id)
		);

		const incomingEdges = Object.values(edges).filter((edge) =>
			incomingEdgeIds.includes(edge.id)
		);

		// Check if any outgoing edge is of type "input"
		if (outgoingEdges.some((edge) => edge.type === "input")) {
			// All outgoing edges should be of type "input"
			if (outgoingEdges.every((edge) => edge.type === "input")) {
				type = "input";
			} else {
				console.error(
					"Error: If one outgoing edge is 'input', all must be 'input'"
				);
			}
		}

		// Check if any incoming edge is of type "output" or "debug"
		if (
			incomingEdges.some(
				(edge) => edge.type === "output" || edge.type === "debug"
			)
		) {
			// Should only be one incoming edge
			if (incomingEdges.length === 1) {
				// If the incoming edge is of type "output", the node is of type "output", and same for "debug"
				if (incomingEdges[0].type === "output") {
					type = "output";
				} else if (incomingEdges[0].type === "debug") {
					type = "debug";
				}
			} else {
				console.error(
					"Error: If one incoming edge is 'output' or 'debug', it must be the only incoming edge"
				);
			}
		}

		// Check if the node is a global variable node
		if (outgoingEdges.length === 0 && incomingEdges.length === 0) {
			const firstLine = content.split("\n")[0];
			if (firstLine.startsWith("{") && firstLine.endsWith("}")) {
				type = "globalVar";
			} else {
				console.log("Floating node that is not a global variable");
				continue;
			}
		}

		const node = new CannoliNode(
			nodeData.id,
			content,
			nodeData.x,
			nodeData.y,
			nodeData.width,
			nodeData.height,
			type,
			outgoingEdges,
			incomingEdges,
			vault,
			canvasFile,
			openai
		);
		nodes[node.id] = node;
	}

	return nodes;
}

// Function to process edges
function processEdges(canvasData: CanvasData): Record<string, CannoliEdge> {
	const edges: Record<string, CannoliEdge> = {};

	for (const edgeData of canvasData.edges) {
		let edgeType: EdgeType = "simple";
		if (
			edgeData.color &&
			colorToEdgeTypeMapping.hasOwnProperty(edgeData.color)
		) {
			edgeType = colorToEdgeTypeMapping[edgeData.color];
		}

		const edge = new CannoliEdge(
			edgeData.id,
			edgeData.fromNode,
			edgeData.toNode,
			edgeType,
			edgeData.label ?? null
		);

		edges[edge.id] = edge;
	}

	return edges;
}

function processGroups(
	canvasData: CanvasData,
	nodes: Record<string, CannoliNode>
): Record<string, CannoliGroup> {
	const groups: Record<string, CannoliGroup> = {};

	for (const nodeData of canvasData.nodes) {
		if (nodeData.type === "group") {
			const group = new CannoliGroup(nodeData.id);
			groups[nodeData.id] = group;
			for (const nodeId in nodes) {
				const node = nodes[nodeId];
				// Check if the node is within the group using the geometric properties
				if (
					nodeData.x <= node.x &&
					node.x <= nodeData.x + nodeData.width &&
					nodeData.y <= node.y &&
					node.y <= nodeData.y + nodeData.height
				) {
					group.addNode(node);
					node.groupId = group.id;
				}
			}
		}
	}

	return groups;
}

// Node Types
type NodeType = "call" | "input" | "output" | "debug" | "globalVar";

class CannoliNode extends EventEmitter {
	id: string;
	content: string;
	status: "incomplete" | "executing" | "executed" | "rejected";
	x: number;
	y: number;
	width: number;
	height: number;
	type: NodeType;
	outgoingEdges: CannoliEdge[];
	incomingEdges: CannoliEdge[];
	groupId: string | null;
	vault: Vault;
	canvasFile: TFile;
	openai: OpenAIApi;

	constructor(
		id: string,
		content: string,
		x: number,
		y: number,
		width: number,
		height: number,
		type: NodeType,
		outgoingEdges: CannoliEdge[],
		incomingEdges: CannoliEdge[],
		vault: Vault,
		canvasFile: TFile,
		openai: OpenAIApi
	) {
		super();
		this.id = id;
		this.content = content;
		this.status = "incomplete";
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
		this.type = type;
		this.outgoingEdges = outgoingEdges || [];
		this.incomingEdges = incomingEdges || [];
		this.vault = vault;
		this.canvasFile = canvasFile;
		this.openai = openai;
	}

	async waitForDependencies(nodes: Record<string, CannoliNode>) {
		const readyEdges = this.incomingEdges.filter(
			(edge) => edge.status === "ready"
		);
		if (readyEdges.length === this.incomingEdges.length) {
			// All dependencies are ready, proceed with processing
			await this.process(nodes);
		} else {
			// Not all dependencies are ready, register a callback on each edge's source node to re-check dependencies when it's done
			this.incomingEdges.forEach((edge) => {
				const sourceNode = edge.getSource(nodes);
				if (!sourceNode) {
					console.log(
						`Source node for edge ${edge.id} not found in nodes`
					);
				} else if (!sourceNode.once) {
					console.log(
						`Node ${sourceNode.id} does not have a 'once' method`
					);
				} else {
					sourceNode.once("done", () => {
						this.waitForDependencies(nodes);
					});
				}
			});
		}
	}

	async process(nodes: Record<string, CannoliNode>) {
		if (this.type === "input") {
			// Node is an input node, send its content on the outgoing variable edge
			// Assuming there is only one outgoing edge for input nodes
			this.outgoingEdges[0].setPayload(this.content);
			this.changeColor("4");
			this.status = "executed";
			this.emit("done", this);
		} else if (this.type === "output" || this.type === "debug") {
			// Node is an output or debug node, take the content from its single incoming edge
			this.content = this.incomingEdges[0].getPayload() as string;
			this.changeContent(this.content);
			this.changeColor("4");
			this.status = "executed";
			this.emit("done", this);
		} else if (this.type === "call") {
			// Change the color of the node to yellow
			await this.changeColor("3");
			this.status = "executing";

			// Node is a call node, build its message
			let messageContent = this.content;

			// For all incoming variable type edges, replace the variable name with the content of the edge
			for (const edge of this.incomingEdges.filter(
				(edge) => edge.type === "variable"
			)) {
				const varName = edge.content;
				const varValue = edge.getPayload() as string;

				if (!varValue) {
					throw new Error(`Variable ${varName} has not been set`);
				}

				// Replace the variable name with the content of the edge
				if (messageContent.includes(`{${varName}}`)) {
					messageContent = messageContent.replace(
						`{${varName}}`,
						varValue
					);
				}

				// Replace the variable name with the content of the page
				if (messageContent.includes(`{[${varName}]}`)) {
					// If the value has [[double brackets]], remove them
					const pageName =
						varValue.startsWith("[[") && varValue.endsWith("]]")
							? varValue.slice(2, -2)
							: varValue;

					const page = this.vault
						.getMarkdownFiles()
						.find((file) => file.name === pageName);
					if (page) {
						const pageContent = await this.vault.read(page);
						messageContent = messageContent.replace(
							`{${varName}}`,
							pageContent
						);
					} else {
						messageContent = messageContent.replace(
							`{${varName}}`,
							`The page: "${pageName}" doesn't exist`
						);
					}
				} else {
					throw new Error(
						`Content does not include an instance of variable ${varName}`
					);
				}
			}

			// Search nodes for nodes of type "globalVar". The content will look like this: "{variable name}\nvalue"
			const globalVars: Record<string, string> = {};
			for (const node of Object.values(nodes)) {
				if (node.type === "globalVar") {
					// Split the content into the variable name and value, removing brackets from the name
					const [varName, varValue] = node.content.split("\n");
					globalVars[varName.slice(1, -1)] = varValue;
				}
			}

			for (const [varName, varValue] of Object.entries(globalVars)) {
				messageContent = messageContent.replace(
					`{${varName}}`,
					varValue
				);
			}

			// Replace all instances of {[[page name]]} with the content of the page
			const pageNameMatches =
				messageContent.match(/{\[\[(.*?)\]\]}/g) || [];
			for (const match of pageNameMatches) {
				const pageName = match.slice(2, -2); // Remove {[[ and ]]}

				const page = this.vault
					.getMarkdownFiles()
					.find((file) => file.name === pageName);
				if (page) {
					const pageContent = await this.vault.read(page);
					messageContent = messageContent.replace(match, pageContent);
				} else {
					messageContent = messageContent.replace(
						match,
						`The page: "${pageName}" doesn't exist`
					);
				}
			}

			let messages: ChatCompletionRequestMessage[];

			// If there is an incoming simple type edge from a node within the same group, it's payload is an array of messages. Append the current message to them and make that the messages array
			const simpleEdge = this.incomingEdges.find(
				(edge) =>
					edge.type === "simple" &&
					edge.getSource(nodes).type === "call"
			);
			if (simpleEdge) {
				messages =
					simpleEdge.getPayload() as ChatCompletionRequestMessage[];
				messages.push({ role: "user", content: messageContent });
			} else {
				messages = [{ role: "user", content: messageContent }];

				// Send a request to OpenAI
				const chatResponse = await llmCall({
					messages,
					openai: this.openai,
					verbose: true,
				});

				if (!chatResponse) {
					throw new Error("Chat response is undefined");
				}

				// For all outgoing variable and output type edges, set the payload to the content of the response message
				for (const edge of this.outgoingEdges.filter(
					(edge) => edge.type === "variable" || edge.type === "output"
				)) {
					const varName = edge.content;
					const varValue = chatResponse.content;

					if (!varValue) {
						throw new Error(`Variable ${varName} has not been set`);
					}
					edge.setPayload(varValue);
					edge.status = "ready";
				}

				// For all outgoing simple type edges, set the payload to the array of prompt messages with the response message appended
				for (const edge of this.outgoingEdges.filter(
					(edge) => edge.type === "simple"
				)) {
					if (chatResponse) {
						messages.push(chatResponse);
					}
					edge.setPayload(messages);
					edge.status = "ready";
				}

				// For all outgoing debug type edges, set the payload to a markdown string containing the prompt messages and the response message formatted nicely
				for (const edge of this.outgoingEdges.filter(
					(edge) => edge.type === "debug"
				)) {
					let debugContent = "";
					for (const message of messages) {
						debugContent += `**${message.role}**: ${message.content}\n`;
					}
					debugContent += `**AI**: ${chatResponse.content}`;
					edge.setPayload(debugContent);
					edge.status = "ready";
				}
			}

			// Change the color of the node to green
			await this.changeColor("4");
			this.status = "executed";
			this.emit("done", this);
		}
	}

	allIncomingEdgesReady(): boolean {
		// Check if all incoming edges have status "ready"
		return this.incomingEdges.every((edge) => edge.status === "ready");
	}

	// Change the color of the node
	async changeColor(color: string) {
		const canvasData = JSON.parse(
			await this.vault.read(this.canvasFile)
		) as CanvasData;

		const node = canvasData.nodes.find((node) => node.id === this.id);
		if (node !== undefined) {
			node.color = color;
		} else {
			throw new Error(`Node with id ${this.id} not found`);
		}

		await this.vault.modify(this.canvasFile, JSON.stringify(canvasData));
	}

	// Change the content of the node
	async changeContent(content: string) {
		const canvasData = JSON.parse(
			await this.vault.read(this.canvasFile)
		) as CanvasData;

		const node = canvasData.nodes.find((node) => node.id === this.id);
		if (node !== undefined) {
			node.text = content;
		} else {
			throw new Error(`Node with id ${this.id} not found`);
		}

		await this.vault.modify(this.canvasFile, JSON.stringify(canvasData));
	}
}

// Edge Types
type EdgeType = "input" | "output" | "choice" | "debug" | "simple" | "variable";

const colorToEdgeTypeMapping: Record<string, EdgeType> = {
	"1": "output",
	"2": "choice",
	"3": "choice",
	"4": "input",
	"5": "debug",
	"6": "debug",
};

class CannoliEdge {
	id: string;
	sourceId: string;
	targetId: string;
	content: string | null;
	type: EdgeType;
	payload: ChatCompletionRequestMessage[] | string | null;
	status: "ready" | "not-ready" | "rejected";

	constructor(
		id: string,
		sourceId: string,
		targetId: string,
		type: EdgeType,
		content: string | null
	) {
		this.id = id;
		this.sourceId = sourceId;
		this.targetId = targetId;
		this.type = type;
		this.payload = null;
		this.content = content;
		this.status = "not-ready";
	}

	getSource(nodes: Record<string, CannoliNode>): CannoliNode {
		console.log(nodes);
		return nodes[this.sourceId];
	}

	getTarget(nodes: Record<string, CannoliNode>): CannoliNode {
		return nodes[this.targetId];
	}

	setPayload(payload: ChatCompletionRequestMessage[] | string) {
		this.payload = payload;
	}

	getPayload(): ChatCompletionRequestMessage[] | string | null {
		return this.payload;
	}
}

class CannoliGroup {
	id: string;
	nodes: CannoliNode[];
	edges: CannoliEdge[];

	constructor(id: string) {
		this.id = id;
		this.nodes = [];
		this.edges = [];
	}

	addNode(node: CannoliNode): void {
		this.nodes.push(node);
	}

	hasNode(node: CannoliNode): boolean {
		return this.nodes.includes(node);
	}
}

function isDAG(
	node: CannoliNode,
	visited: Set<CannoliNode>,
	recursionStack: Set<CannoliNode>,
	nodes: Record<string, CannoliNode>
): boolean {
	visited.add(node);
	recursionStack.add(node);

	for (const edge of node.outgoingEdges) {
		const adjacentNode = edge.getTarget(nodes);
		if (!visited.has(adjacentNode)) {
			if (isDAG(adjacentNode, visited, recursionStack, nodes))
				return true;
		} else if (recursionStack.has(adjacentNode)) {
			return true;
		}
	}

	recursionStack.delete(node);
	return false;
}

async function llmCall({
	messages,
	openai,
	model = "gpt-3.5-turbo",
	max_tokens = 300,
	n = 1,
	temperature = 0.8,
	verbose = false,
}: {
	messages: ChatCompletionRequestMessage[];
	openai: OpenAIApi;
	model?: string;
	max_tokens?: number;
	n?: number;
	temperature?: number;
	verbose?: boolean;
}) {
	if (verbose) {
		// Log out input chat messages, formatted nicely
		console.log("Input messages:");
		for (const message of messages) {
			console.log(`${message.role}: ${message.content}`);
		}
	}

	const chatResponse = await openai.createChatCompletion({
		messages,
		model,
		max_tokens,
		temperature,
		n,
	});

	if (verbose) {
		// Log out the response message, formatted nicely
		console.log("Response message:");
		console.log(`AI: ${chatResponse.data.choices[0].message?.content}`);
	}

	return chatResponse.data.choices[0].message;
}
