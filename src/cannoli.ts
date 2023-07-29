import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
// import { ErrorModal } from "main";
import { Vault, TFile } from "obsidian";
import { Canvas } from "./canvas";
import { CannoliGroup } from "./group";
import { CannoliNode } from "./node";
import { CannoliEdge } from "./edge";

import pLimit from "p-limit";
import { encoding_for_model, TiktokenModel } from "@dqbd/tiktoken";

interface Limit {
	(
		fn: () => Promise<{
			message: ChatCompletionRequestMessage;
			promptTokens: number;
			completionTokens: number;
		}>
	): Promise<{
		message: ChatCompletionRequestMessage;
		promptTokens: number;
		completionTokens: number;
	}>;
}

export class CannoliGraph {
	canvas: Canvas;
	apiKey: string;
	openai: OpenAIApi;
	limit: Limit;
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

		// Limit the number of concurrent requests to 10
		// Adjust this number as needed
		this.limit = pLimit(10);
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

	async editNote(
		noteName: string,
		newContent: string,
		verbose = false
	): Promise<boolean> {
		// Get the note
		const note = this.vault.getMarkdownFiles().find((file) => {
			return file.basename === noteName;
		});

		if (!note) {
			return false;
		}

		// Update the note's content
		await this.vault.modify(note, newContent);

		if (verbose) {
			console.log(`Note "${noteName}" updated`);
		}

		return true;
	}

	async createNoteAtExistingPath(
		noteName: string,
		path: string,
		content?: string,
		verbose = false
	): Promise<boolean> {
		// Create the path by appending the note name to the path with .md
		const fullPath = `${path}/${noteName}.md`;

		// Check if a note already exists at the path
		const note = this.vault.getMarkdownFiles().find((file) => {
			return file.path === fullPath;
		});

		if (note) {
			return false;
		}

		// Create the note
		await this.vault.create(fullPath, content ?? "");

		if (verbose) {
			console.log(`Note "${noteName}" created at path "${fullPath}"`);
		}

		return true;
	}

	async createNoteAtNewPath(
		noteName: string,
		path: string,
		content?: string,
		verbose = false
	): Promise<boolean> {
		// Create the path by appending the note name to the path with .md
		const fullPath = `${path}/${noteName}.md`;

		// Create the note
		await this.vault.create(fullPath, content ?? "");

		if (verbose) {
			console.log(`Note "${noteName}" created at path "${fullPath}"`);
		}

		return true;
	}

	async createFolder(path: string, verbose = false): Promise<boolean> {
		// Check if the path already exists
		const folder = this.vault.getAbstractFileByPath(path);

		if (folder) {
			return false;
		}

		// Create the folder
		this.vault.createFolder(path);

		if (verbose) {
			console.log(`Folder created at path "${path}"`);
		}

		return true;
	}

	async moveNote(
		noteName: string,
		oldPath: string,
		newPath: string,
		verbose = false
	): Promise<boolean> {
		// Create the paths by appending the note name to the paths with .md
		const oldFullPath = `${oldPath}/${noteName}.md`;
		const newFullPath = `${newPath}/${noteName}.md`;

		// Get the note
		const note = this.vault.getMarkdownFiles().find((file) => {
			return file.path === oldFullPath;
		});

		if (!note) {
			return false;
		}

		// Move the note
		await this.vault.rename(note, newFullPath);

		if (verbose) {
			console.log(
				`Note "${noteName}" moved from path "${oldFullPath}" to path "${newFullPath}"`
			);
		}

		return true;
	}

	async llmCall({
		messages,
		model = "gpt-3.5-turbo",
		max_tokens = 300,
		n = 1,
		temperature = 0.8,
		verbose = false,
		mock = false,
	}: {
		messages: ChatCompletionRequestMessage[];
		model?: TiktokenModel;
		max_tokens?: number;
		n?: number;
		temperature?: number;
		verbose?: boolean;
		mock?: boolean;
	}): Promise<{
		message: ChatCompletionRequestMessage;
		promptTokens: number;
		completionTokens: number;
	}> {
		if (mock) {
			const enc = encoding_for_model(model);

			let textMessages = "";

			// For each message, convert it to a string, including the role and the content, and a function call if present
			for (const message of messages) {
				if (message.function_call) {
					textMessages += `${message.role}: ${message.content} ${message.function_call} `;
				} else {
					textMessages += `${message.role}: ${message.content} `;
				}
			}

			const encoded = enc.encode(textMessages);

			const promptTokens = encoded.length;

			return {
				message: { role: "user", content: "mock" },
				promptTokens: promptTokens,
				completionTokens: 0,
			};
		} else {
			return this.limit(
				async (): Promise<{
					message: ChatCompletionRequestMessage;
					promptTokens: number;
					completionTokens: number;
				}> => {
					if (verbose) {
						console.log(
							"Input Messages:\n" +
								JSON.stringify(messages, null, 2)
						);
					}

					const chatResponse = await this.openai.createChatCompletion(
						{
							messages,
							model,
							max_tokens,
							temperature,
							n,
						}
					);

					if (verbose) {
						console.log(
							"Response Message:\n" +
								JSON.stringify(
									chatResponse.data.choices[0].message,
									null,
									2
								)
						);
					}

					if (
						!chatResponse.data.choices[0].message ||
						!chatResponse.data.usage
					) {
						throw new Error(
							"OpenAI returned an error: " +
								chatResponse.data.choices[0].message
						);
					}

					return {
						message: chatResponse.data.choices[0].message,
						promptTokens: chatResponse.data.usage?.prompt_tokens,
						completionTokens:
							chatResponse.data.usage?.completion_tokens,
					};
				}
			);
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
