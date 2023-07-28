import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
// import { ErrorModal } from "main";
import { Vault, TFile } from "obsidian";
import { Canvas } from "./canvas";
import { CannoliGroup } from "./group";
import { CannoliNode } from "./node";
import { CannoliEdge } from "./edge";
export class CannoliGraph {
	canvas: Canvas;
	apiKey: string;
	openai: OpenAIApi;
	vault: Vault;
	groups: Record<string, CannoliGroup>;
	nodes: Record<string, CannoliNode>;
	edges: Record<string, CannoliEdge>;

	constructor(canvasFile: TFile, apiKey: string, vault: Vault) {
		this.canvas = new Canvas(canvasFile, this);
		this.apiKey = apiKey;
		this.vault = vault;
		this.groups = {};
		this.nodes = {};
		this.edges = {};

		const configuration = new Configuration({ apiKey: apiKey });
		delete configuration.baseOptions.headers["User-Agent"];

		// Create an instance of OpenAI
		this.openai = new OpenAIApi(configuration);
	}

	async initialize(verbose = false) {
		await this.canvas.fetchData();
		const { groups, nodes, edges } = this.canvas.parse();
		this.groups = groups;
		this.nodes = nodes;
		this.edges = edges;

		if (verbose) {
			this.logCannoliObjects();
		}

		// Validate the graph
		this.validate();
	}

	validate() {
		// Check if the graph is a DAG
		if (isDAG(this.nodes)) {
			throw new Error("Graph is not a DAG");
		}

		// NEXT: Call validator functions on groups, nodes, and edges
		for (const group of Object.values(this.groups)) {
			group.validate();
		}

		for (const node of Object.values(this.nodes)) {
			node.validate();
		}

		for (const edge of Object.values(this.edges)) {
			edge.validate();
		}
	}

	logCannoliObjects() {
		// Call logEdgeDetails() on each edge
		for (const edge of Object.values(this.edges)) {
			edge.logEdgeDetails();
		}

		// Call logNodeDetails() on each node
		for (const node of Object.values(this.nodes)) {
			node.logNodeDetails();
		}

		// Call logGroupDetails() on each group
		for (const group of Object.values(this.groups)) {
			group.logGroupDetails();
		}
	}
}

// export async function startCannoli(
// 	canvasFile: TFile,
// 	apiKey: string,
// 	vault: Vault
// ) {
// 	const configuration = new Configuration({ apiKey: apiKey });
// 	delete configuration.baseOptions.headers["User-Agent"];

// 	// Create an instance of OpenAI
// 	const openai = new OpenAIApi(configuration);

// 	// Read the content of the file
// 	const fileContent = await vault.read(canvasFile);

// 	const canvasData = JSON.parse(fileContent) as CanvasData;

// 	console.log(canvasData);

// 	let nodes: Record<string, CannoliNode>;

// 	try {
// 		nodes = await processCanvas(canvasData, vault, canvasFile, openai);

// 		// Rest of the logic goes here with the processed and validated nodes and groups
// 	} catch (error) {
// 		new ErrorModal(
// 			this.app,
// 			"Error processing canvas: " + error.message
// 		).open();
// 		return;
// 	}

// 	// Run the cannoli
// 	await runCannoli(nodes);
// }

// async function runCannoli(nodes: Record<string, CannoliNode>) {
// 	const nodeKeys = Object.keys(nodes);

// 	// Change all call nodes to color 0
// 	for (const key of nodeKeys) {
// 		if (nodes[key].type === "call") {
// 			await nodes[key].changeColor("0");
// 		}
// 	}

// 	// Create nodeCompleted callback, which will be called when a node is completed, and checks if all nodes are complete
// 	const nodeCompleted = () => {
// 		// Check if all nodes are complete
// 		if (nodeKeys.every((key) => nodes[key].status === "complete")) {
// 			console.log("All nodes complete");
// 			return;
// 		}
// 	};

// 	// Attempt to process all nodes with no incoming edges and at least one outgoing edge
// 	for (const key of nodeKeys) {
// 		if (
// 			nodes[key].incomingEdges.length === 0 &&
// 			nodes[key].outgoingEdges.length > 0
// 		) {
// 			await nodes[key].attemptProcess(nodeCompleted);
// 		}
// 	}
// }

function isDAG(nodes: Record<string, CannoliNode>): boolean {
	const visited = new Set<CannoliNode>();
	const recursionStack = new Set<CannoliNode>();

	for (const node of Object.values(nodes)) {
		// Skip the node if it is of type 'floating'
		if (node.type === "floating") {
			continue;
		}

		if (!visited.has(node)) {
			if (isDAGHelper(node, visited, recursionStack, nodes)) {
				return true;
			}
		}
	}

	return false;
}

function isDAGHelper(
	node: CannoliNode,
	visited: Set<CannoliNode>,
	recursionStack: Set<CannoliNode>,
	nodes: Record<string, CannoliNode>
): boolean {
	visited.add(node);
	recursionStack.add(node);

	for (const edge of node.outgoingEdges) {
		const adjacentNode = edge.target;
		if (!visited.has(adjacentNode)) {
			if (isDAGHelper(adjacentNode, visited, recursionStack, nodes)) {
				return true;
			}
		} else if (recursionStack.has(adjacentNode)) {
			return true;
		}
	}

	recursionStack.delete(node);
	return false;
}

// // Search the input string for the first instance of a valid page name surrounded by braces, and return it, or return null if none is found
// async function ensurePageExists(
// 	maybePageName: string,
// 	vault: Vault
// ): Promise<string | null> {
// 	// Look for instances of [[pageName]]
// 	const pageNameMatches = maybePageName.match(/\[\[.*?\]\]/g) || [];

// 	// Initialize a variable to hold the found page
// 	let foundPage = null;

// 	// Loop through each match
// 	for (const match of pageNameMatches) {
// 		// Remove [[ and ]]
// 		const pageName = match.slice(2, -2);

// 		// Look for a markdown file with a matching basename
// 		const page = vault
// 			.getMarkdownFiles()
// 			.find((file) => file.basename === pageName);

// 		// If a page was found, store its original name (with brackets) and break the loop
// 		if (page) {
// 			foundPage = match; // match still has the brackets
// 			break;
// 		}
// 	}

// 	// Return the found page's name (with brackets), or null if none was found
// 	return foundPage;
// }

export async function llmCall({
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
