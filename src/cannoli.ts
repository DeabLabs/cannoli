import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
// import { ErrorModal } from "main";
import { Vault, TFile } from "obsidian";
import { Canvas } from "./canvas";

import pLimit from "p-limit";
import { encoding_for_model, TiktokenModel } from "@dqbd/tiktoken";
import { CannoliObject } from "./models/object";
import { CannoliFactory } from "./factory";

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
	factory: CannoliFactory;
	apiKey: string;
	openai: OpenAIApi;
	limit: Limit;
	vault: Vault;
	graph: Record<string, CannoliObject>;

	// Create an empty promise to use as a lock.
	nodeCompletedLock: Promise<void>;

	constructor(canvasFile: TFile, apiKey: string, vault: Vault) {
		this.canvas = new Canvas(canvasFile, this);
		this.factory = new CannoliFactory(vault);
		this.apiKey = apiKey;
		this.vault = vault;
		this.graph = {};

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

		this.graph = this.factory.parse(this.canvas.getCanvasData());

		if (verbose) {
			this.logGraph();
		}

		// Validate the graph
		// this.validate();
	}

	async nodeCompleted() {}

	async mockRun() {}

	async realRun() {}

	async run() {
		await this.mockRun();
		await this.realRun();
	}

	async reset() {}

	validate() {}

	logGraph() {
		for (const node of Object.values(this.graph)) {
			console.log(node.logDetails());
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
		model?: string;
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
			const enc = encoding_for_model(model as TiktokenModel);

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

	// isDAG(nodes: Record<string, CannoliNode>): boolean {
	// 	const visited = new Set<CannoliNode>();
	// 	const recursionStack = new Set<CannoliNode>();

	// 	for (const node of Object.values(nodes)) {
	// 		// Skip the node if it is of type 'floating'
	// 		if (node.type === "floating") {
	// 			continue;
	// 		}

	// 		if (!visited.has(node)) {
	// 			if (this.isDAGHelper(node, visited, recursionStack, nodes)) {
	// 				return true;
	// 			}
	// 		}
	// 	}

	// 	return false;
	// }

	// isDAGHelper(
	// 	node: CannoliNode,
	// 	visited: Set<CannoliNode>,
	// 	recursionStack: Set<CannoliNode>,
	// 	nodes: Record<string, CannoliNode>
	// ): boolean {
	// 	visited.add(node);
	// 	recursionStack.add(node);

	// 	for (const edge of node.outgoingEdges) {
	// 		const adjacentNode = edge.target;
	// 		if (!visited.has(adjacentNode)) {
	// 			if (
	// 				this.isDAGHelper(
	// 					adjacentNode,
	// 					visited,
	// 					recursionStack,
	// 					nodes
	// 				)
	// 			) {
	// 				return true;
	// 			}
	// 		} else if (recursionStack.has(adjacentNode)) {
	// 			return true;
	// 		}
	// 	}

	// 	recursionStack.delete(node);
	// 	return false;
	// }
}
