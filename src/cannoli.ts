import {
	ChatCompletionFunctions,
	ChatCompletionRequestMessage,
	Configuration,
	OpenAIApi,
} from "openai";
// import { ErrorModal } from "main";
import { Vault, TFile } from "obsidian";
import { Canvas } from "./canvas";

import pLimit from "p-limit";
import { encoding_for_model, TiktokenModel } from "@dqbd/tiktoken";
import {
	CannoliObject,
	CannoliObjectStatus,
	CannoliVertex,
} from "./models/object";
import { CannoliFactory } from "./factory";
import { Run } from "./run";

enum DagCheckState {
	UNVISITED,
	VISITING,
	VISITED,
}

// Parameter type for individual parameters
interface Parameter {
	type: string;
	description?: string;
	enum?: string[];
}

// Parameters type for the function
interface FunctionParameters {
	type: string;
	properties: Record<string, Parameter>;
	required?: string[];
}

// Function type to define a complete function

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

	runCompletedPromise: Promise<void>;
	resolveRunCompleted: () => void;

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

		await this.canvas.enqueueRemoveAllErrorNodes();

		this.graph = this.factory.parse(this.canvas.getCanvasData());

		if (verbose) {
			this.logGraph();
		}

		this.canvas.setListeners(this.graph);

		this.validate();

		this.setCompleteListeners();

		// Set the promise for the first run
		this.createRunPromise();
	}

	setCompleteListeners() {
		for (const object of Object.values(this.graph)) {
			object.on("update", (object, status, run) => {
				if (status === CannoliObjectStatus.Complete) {
					this.nodeCompleted();
				}
			});
		}
	}

	nodeCompleted() {
		// Check if all objects are complete or rejected
		for (const object of Object.values(this.graph)) {
			if (
				object.status !== CannoliObjectStatus.Complete &&
				object.status !== CannoliObjectStatus.Rejected
			) {
				return;
			}
		}

		// If all objects are complete or rejected, call runCompleted
		this.runCompleted();
	}

	runCompleted() {
		this.resolveRunCompleted();
	}

	async mockRun() {
		const mockRun = new Run(true, this);
		this.executeRootObjects(mockRun);
		await this.runCompletedPromise; // Wait for the run to complete
	}

	async liveRun() {
		const liveRun = new Run(false, this);
		this.executeRootObjects(liveRun);
		await this.runCompletedPromise; // Wait for the run to complete
	}

	async run() {
		await this.mockRun();

		console.log("Mock run completed");

		await this.reset();

		await this.liveRun();

		console.log("Live run completed");
	}

	executeRootObjects(run: Run) {
		for (const object of Object.values(this.graph)) {
			if (object.dependencies.length === 0) {
				object.execute(run);
			}
		}
	}

	async reset() {
		// Create a run
		const run = new Run(false);

		// Reset the promise for this run
		this.createRunPromise();

		// Reset the status of all objects
		for (const object of Object.values(this.graph)) {
			object.reset(run);
		}
	}

	createRunPromise() {
		this.runCompletedPromise = new Promise((resolve) => {
			this.resolveRunCompleted = resolve;
		});
	}

	validate() {
		// Call validate on each object
		for (const object of Object.values(this.graph)) {
			object.validate();
		}

		// Check if the graph is a DAG
		if (!this.isDAG(this.graph)) {
			// Find a node and call error on it
			for (const object of Object.values(this.graph)) {
				if (object instanceof CannoliVertex)
					object.error(
						"Cycle detected in graph. Please make sure the graph is a DAG.\n(exception: edges between groups and their members)"
					);
			}
		}
	}

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
		functions,
		functionSetting,
	}: {
		messages: ChatCompletionRequestMessage[];
		model?: string;
		max_tokens?: number;
		n?: number;
		temperature?: number;
		verbose?: boolean;
		mock?: boolean;
		functions?: ChatCompletionFunctions[];
		functionSetting?: string;
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

					let chatResponse;

					if (!functions) {
						chatResponse = await this.openai.createChatCompletion({
							messages,
							model,
							max_tokens,
							temperature,
							n,
						});
					} else {
						let functionCall: string | { name: string };
						if (!functionSetting || functionSetting === "auto") {
							functionCall = "auto";
						} else if (functionSetting === "none") {
							functionCall = "none";
						} else {
							functionCall = { name: functionSetting };
						}

						chatResponse = await this.openai.createChatCompletion({
							messages,
							model,
							max_tokens,
							temperature,
							n,
							functions,
							function_call: functionCall,
						});
					}

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

	defineFunction(
		name: string,
		description: string,
		parameters: FunctionParameters
	): ChatCompletionFunctions {
		return {
			name,
			description,
			parameters,
		};
	}

	createChoiceFunction(choices: string[]): ChatCompletionFunctions {
		return {
			name: "enter_choice",
			description:
				"Enter your answer to the question above using this function.",
			parameters: {
				type: "object",
				properties: {
					choice: {
						type: "string",
						enum: choices,
					},
				},
				required: ["choice"],
			},
		};
	}

	createListFunction(tags: string[]): ChatCompletionFunctions {
		const properties: Record<string, { type: string }> = {};

		tags.forEach((tag) => {
			properties[tag] = {
				type: "string",
			};
		});

		return {
			name: "enter_answers",
			description:
				"Use this function to enter the requested information for each key.",
			parameters: {
				type: "object",
				properties,
				required: tags,
			},
		};
	}

	isDAG(objects: Record<string, CannoliObject>): boolean {
		const states = new Map<CannoliObject, DagCheckState>();

		function visit(obj: CannoliObject): boolean {
			if (states.get(obj) === DagCheckState.VISITING) {
				return false; // Cycle detected
			}

			if (states.get(obj) === DagCheckState.VISITED) {
				return true; // Already visited
			}

			states.set(obj, DagCheckState.VISITING);

			for (const dependency of obj.getAllDependencies()) {
				if (!visit(dependency)) {
					return false; // Cycle detected in one of the dependencies
				}
			}

			states.set(obj, DagCheckState.VISITED);
			return true;
		}

		for (const obj of Object.values(objects)) {
			if (states.get(obj) !== DagCheckState.VISITED) {
				if (!visit(obj)) {
					return false; // Cycle detected
				}
			}
		}

		return true;
	}
}
