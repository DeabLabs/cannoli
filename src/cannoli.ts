import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { ErrorModal } from "main";
import { Vault, TFile } from "obsidian";
import { CanvasData } from "obsidian/canvas.d";

export async function startCannoli(
	canvasFile: TFile,
	apiKey: string,
	vault: Vault
) {
	const configuration = new Configuration({ apiKey: apiKey });
	delete configuration.baseOptions.headers["User-Agent"];

	// Create an instance of OpenAI
	const openai = new OpenAIApi(configuration);

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
	const nodeKeys = Object.keys(nodes);

	// Change all non-globalVar type nodes to "0"
	for (const key of nodeKeys) {
		if (nodes[key].type !== "globalVar") {
			await nodes[key].changeColor("0");
		}
	}

	// Create nodeCompleted callback, which will be called when a node is completed, and checks if all nodes are complete
	const nodeCompleted = () => {
		// Check if all nodes are complete
		if (nodeKeys.every((key) => nodes[key].status === "complete")) {
			console.log("All nodes complete");
			return;
		}
	};

	// Attempt to process all nodes with no incoming edges and at least one outgoing edge
	for (const key of nodeKeys) {
		if (
			nodes[key].incomingEdges.length === 0 &&
			nodes[key].outgoingEdges.length > 0
		) {
			await nodes[key].attemptProcess(nodeCompleted);
		}
	}
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
			(node) =>
				node.incomingEdges.filter((edge) =>
					group.nodes.includes(edge.getSource(nodes))
				).length === 0
		);

		if (
			group.nodes.some(
				(node) =>
					node !== root &&
					node.incomingEdges.filter(
						(edge) =>
							group.nodes.includes(edge.getSource(nodes)) &&
							edge.type !== "variable"
					).length !== 1
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
			openai,
			nodes
		);
		nodes[node.id] = node;
	}

	return nodes;
}

// Function to process edges
function processEdges(canvasData: CanvasData): Record<string, CannoliEdge> {
	const edges: Record<string, CannoliEdge> = {};
	const edgeTypes: EdgeType[] = [
		"input",
		"output",
		"choice",
		"debug",
		"simple",
		"variable",
	];

	for (const edgeData of canvasData.edges) {
		let edgeType: EdgeType = "simple";
		let content: string | null = null;

		// Initialize variables for the label and the parsed lines
		let label = "";
		let labelLines: string[] = [];

		// If a label is given, parse it for a /type tag
		if (edgeData.label) {
			label = edgeData.label;
			labelLines = label.split("\n");
			const potentialTypeTag =
				labelLines[0].startsWith("/") && labelLines[0].slice(1);

			// Check if the type tag exists and is valid
			if (
				potentialTypeTag &&
				edgeTypes.includes(potentialTypeTag as EdgeType)
			) {
				edgeType = potentialTypeTag as EdgeType;
				labelLines.shift(); // Remove the type tag line
			}
		}

		// If there's no valid type tag, check for color mapping
		if (
			edgeType === "simple" &&
			edgeData.color &&
			colorToEdgeTypeMapping.hasOwnProperty(edgeData.color)
		) {
			edgeType = colorToEdgeTypeMapping[edgeData.color];
		}
		// If there's no type tag and no color, but there's a label, it's a variable type
		else if (edgeType === "simple" && label) {
			edgeType = "variable";
		}

		// Check for content in the label
		if (
			edgeType !== "simple" &&
			edgeType !== "input" &&
			edgeType !== "output" &&
			edgeType !== "debug"
		) {
			content = labelLines.join("\n").trim() || null;
			if (!content) {
				throw new Error(
					`No content found for variable edge ${edgeData.id}`
				);
			}
		} else if (
			(edgeType === "simple" ||
				edgeType === "input" ||
				edgeType === "output" ||
				edgeType === "debug") &&
			labelLines.length > 0
		) {
			throw new Error(
				`Invalid content found for ${edgeType} edge ${edgeData.id}`
			);
		}

		const edge = new CannoliEdge(
			edgeData.id,
			edgeData.fromNode,
			edgeData.toNode,
			edgeType,
			content
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

class CannoliNode {
	id: string;
	content: string;
	status: "pending" | "processing" | "complete" | "rejected";
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
	nodes: Record<string, CannoliNode>;

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
		openai: OpenAIApi,
		nodes: Record<string, CannoliNode>
	) {
		this.id = id;
		this.content = content;
		this.status = "pending";
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
		this.nodes = nodes;
	}

	async process(nodeCompleted: () => void) {
		if (this.type === "input") {
			// Node is an input node, send its content on the outgoing variable edge
			// Assuming there is only one outgoing edge for input nodes
			this.outgoingEdges[0].setPayload(this.content);
		} else if (this.type === "output" || this.type === "debug") {
			// Node is an output or debug node, take the content from its single incoming edge
			this.content = this.incomingEdges[0].getPayload() as string;
			this.changeContent(this.content);
		} else if (this.type === "call") {
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

				// Use regular expressions to check for variable names within braces
				const varPattern = new RegExp(`{${varName}}`, "g");
				const isVarNamePresent = varPattern.test(messageContent);

				if (isVarNamePresent) {
					messageContent = messageContent.replace(
						varPattern,
						varValue
					);
				}

				// Use regular expressions to check for variable names within double braces
				const varDoubleBracePattern = new RegExp(
					`{\\[${varName}\\]}`,
					"g"
				);
				const isDoubleBraceVarNamePresent =
					varDoubleBracePattern.test(messageContent);

				if (isDoubleBraceVarNamePresent) {
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
							varDoubleBracePattern,
							pageContent
						);
					} else {
						messageContent = messageContent.replace(
							varDoubleBracePattern,
							`The page: "${pageName}" doesn't exist`
						);
					}
				} else if (!isVarNamePresent) {
					throw new Error(
						`Content does not include an instance of variable ${varName}`
					);
				}
			}

			// Search nodes for nodes of type "globalVar". The content will look like this: "{variable name}\nvalue"
			const globalVars: Record<string, string> = {};
			for (const node of Object.values(this.nodes)) {
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
				const pageName = match.slice(3, -3); // Remove {[[ and ]]}

				const page = this.vault
					.getMarkdownFiles()
					.find((file) => file.basename === pageName);
				if (page) {
					const pageContent = await this.vault.read(page);
					const renderedPage = "# " + pageName + "\n" + pageContent;
					messageContent = messageContent.replace(
						match,
						renderedPage
					);
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
					edge.getSource(this.nodes).type === "call"
			);
			if (simpleEdge && simpleEdge.getPayload()) {
				messages =
					simpleEdge.getPayload() as ChatCompletionRequestMessage[];
				messages.push({ role: "user", content: messageContent });
			} else {
				messages = [{ role: "user", content: messageContent }];
			}

			// Send a request to OpenAI
			const chatResponse = await llmCall({
				messages,
				openai: this.openai,
				verbose: true,
			});

			if (!chatResponse) {
				throw new Error("Chat response is undefined");
			}

			// Load outgoing edges

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
			}

			// For all outgoing simple type edges, set the payload to the array of prompt messages with the response message appended
			if (chatResponse) {
				messages.push(chatResponse);
			}

			for (const edge of this.outgoingEdges.filter(
				(edge) => edge.type === "simple"
			)) {
				const payloadMessages = messages.slice();
				edge.setPayload(payloadMessages);
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
			}
		}

		await this.showCompleted();
		nodeCompleted();

		for (const edge of this.outgoingEdges) {
			await edge.getTarget(this.nodes).attemptProcess(nodeCompleted);
		}
	}

	// Process the node if all its dependencies are complete
	async attemptProcess(nodeCompleted: () => void) {
		if (this.allDependenciesComplete()) {
			await this.showProcessing();
			this.process(nodeCompleted);
		}
	}

	// Check if the node has all its dependencies complete
	allDependenciesComplete(): boolean {
		// Check if sources of all incoming edges have status "complete"
		return this.incomingEdges.every(
			(edge) => edge.getSource(this.nodes).status === "complete"
		);
	}

	// Set the status of the node to complete, change its color to green, and call attemptProcess on target nodes of all outgoing edges
	async showCompleted() {
		this.status = "complete";
		await this.changeColor("4");
	}

	// Set the status of the node to rejected, change its color to "0", and call reject on target nodes of all outgoing edges
	async rejected() {
		this.status = "rejected";
		await this.changeColor("0");
		for (const edge of this.outgoingEdges) {
			await edge.getTarget(this.nodes).rejected();
		}
	}

	// Set the status of the node to processing, change its color to yellow
	async showProcessing() {
		this.status = "processing";
		await this.changeColor("3");
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
	}

	getSource(nodes: Record<string, CannoliNode>): CannoliNode {
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
		// Log out input chat messages raw, with good indentation
		console.log("Input Messages:\n" + JSON.stringify(messages, null, 2));
	}

	const chatResponse = await openai.createChatCompletion({
		messages,
		model,
		max_tokens,
		temperature,
		n,
	});

	if (verbose) {
		// Log out the response message raw, with good indentation
		console.log(
			"Response Message:\n" +
				JSON.stringify(chatResponse.data.choices[0].message, null, 2)
		);
	}

	return chatResponse.data.choices[0].message;
}
