import { CallNode, ContentNode, FloatingNode } from "./models/node";
import { CannoliObject, CannoliVertex } from "./models/object";
import pLimit from "p-limit";
import { CannoliArgs, CannoliGraph, CannoliObjectStatus, CannoliRunSettings } from "./models/graph";
import {
	GenericCompletionParams,
	GenericCompletionResponse,
	GenericFunctionCall,
	GenericModelConfig,
	LLMProvider,
	LLMProvider as Llm,
} from "./providers";
import invariant from "tiny-invariant";
import { CannoliFactory } from "./factory";
import { FilesystemInterface } from "./filesystem_interface";
import { Canvas, CanvasData, canvasDataSchema } from "./canvas_interface";

export interface HttpTemplate {
	id: string;
	name: string;
	url: string;
	headers: Record<string, string>;
	method: string;
	bodyTemplate?: string;
}

export type StoppageReason = "user" | "error" | "complete";

export type ResponseTextFetcher = (url: string, options: RequestInit) => Promise<string>;

interface Limit {
	(fn: () => Promise<GenericCompletionResponse | Error>): Promise<
		GenericCompletionResponse | Error
	>;
}

export interface Stoppage {
	reason: StoppageReason;
	usage: Record<string, Usage>;
	totalCost: number;
	results: { [key: string]: string };
	message?: string; // Additional information, like an error message
}

export interface Usage {
	model: Model;
	modelUsage: ModelUsage;
}

export interface Model {
	name: string;
	promptTokenPrice: number;
	completionTokenPrice: number;
}

export interface ModelUsage {
	promptTokens: number;
	completionTokens: number;
	apiCalls: number;
	totalCost: number;
}

export type ChatRole = "user" | "assistant" | "system";

enum DagCheckState {
	UNVISITED,
	VISITING,
	VISITED,
}

export function isValidKey(
	key: string,
	config: GenericModelConfig
): key is keyof GenericModelConfig {
	return key in config;
}

export function runCannoli({
	cannoliJSON,
	canvas,
	llm,
	fileSystemInterface,
	isMock,
	fetcher,
	settings,
	args
}: {
	cannoliJSON: unknown;
	llm: LLMProvider;
	settings?: CannoliRunSettings;
	args?: CannoliArgs;
	canvas?: Canvas;
	fileSystemInterface?: FilesystemInterface;
	isMock?: boolean;
	fetcher?: ResponseTextFetcher;
}): [Promise<Stoppage>, () => void] {
	let resolver: (stoppage: Stoppage) => void;
	const done = new Promise<Stoppage>((resolve) => {
		resolver = resolve;
	});

	const run = new Run({
		llm: llm,
		cannoliJSON: cannoliJSON,
		settings: settings,
		args: args,
		canvas: canvas,
		onFinish: (stoppage: Stoppage) => {
			resolver(stoppage);
		},
		fileSystemInterface: fileSystemInterface,
		isMock: isMock ?? false,
		fetcher: fetcher,
	});

	run.start();

	return [done, () => run.stop()];
}

export class Run {
	graph: Record<string, CannoliObject> = {};
	onFinish: (stoppage: Stoppage) => void;

	settings: CannoliRunSettings | null;
	args: CannoliArgs | null;

	fileSystemInterface: FilesystemInterface | null;
	fetcher: ResponseTextFetcher;
	llm: Llm;
	llmLimit: Limit;
	canvas: Canvas | null;
	isMock: boolean;
	isStopped = false;
	currentNote: string | null = null;
	selection: string | null = null;

	modelInfo: Record<string, Model> = {
		"gpt-4-1106-preview": {
			name: "gpt-4-1106-preview",
			promptTokenPrice: 0.01 / 1000, // $0.01 per 1K tokens
			completionTokenPrice: 0.03 / 1000, // $0.03 per 1K tokens
		},
		"gpt-4-1106-vision-preview": {
			name: "gpt-4-1106-vision-preview",
			promptTokenPrice: 0.01 / 1000, // $0.01 per 1K tokens
			completionTokenPrice: 0.03 / 1000, // $0.03 per 1K tokens
		},
		"gpt-4": {
			name: "gpt-4",
			promptTokenPrice: 0.03 / 1000, // $0.03 per 1K tokens
			completionTokenPrice: 0.06 / 1000, // $0.06 per 1K tokens
		},
		"gpt-4-32k": {
			name: "gpt-4-32k",
			promptTokenPrice: 0.06 / 1000, // $0.06 per 1K tokens
			completionTokenPrice: 0.12 / 1000, // $0.12 per 1K tokens
		},
		"gpt-3.5-turbo": {
			name: "gpt-3.5-turbo",
			promptTokenPrice: 0.001 / 1000, // $0.0010 per 1K tokens
			completionTokenPrice: 0.002 / 1000, // $0.0020 per 1K tokens
		},
		"gpt-3.5-turbo-1106": {
			name: "gpt-3.5-turbo-1106",
			promptTokenPrice: 0.001 / 1000, // $0.0010 per 1K tokens
			completionTokenPrice: 0.002 / 1000, // $0.0020 per 1K tokens
		},
		"gpt-3.5-turbo-instruct": {
			name: "gpt-3.5-turbo-instruct",
			promptTokenPrice: 0.0015 / 1000, // $0.0015 per 1K tokens
			completionTokenPrice: 0.002 / 1000, // $0.0020 per 1K tokens
		},
	};

	usage: Record<string, Usage>;

	constructor({
		cannoliJSON,
		isMock,
		onFinish,
		canvas,
		fileSystemInterface,
		llm,
		fetcher,
		settings,
		args

	}: {
		cannoliJSON: unknown;
		llm: Llm;
		fetcher?: ResponseTextFetcher;
		settings?: CannoliRunSettings;
		args?: CannoliArgs;
		onFinish?: (stoppage: Stoppage) => void;
		isMock?: boolean;
		canvas?: Canvas;
		fileSystemInterface?: FilesystemInterface;
	}) {
		this.onFinish = onFinish ?? ((stoppage: Stoppage) => { });
		this.isMock = isMock ?? false;
		this.canvas = canvas ?? null;
		this.usage = {};

		const defaultFetcher: ResponseTextFetcher = async (url, options) => {
			const res = await fetch(url, options);
			return await res.text();
		};

		this.fetcher = fetcher ?? defaultFetcher;

		this.llm = llm ?? null;

		this.settings = settings ?? null;
		this.args = args ?? null;

		let parsedCannoliJSON: CanvasData;

		try {
			// Parse the JSON and get the settings and args
			parsedCannoliJSON = canvasDataSchema.parse(cannoliJSON);
		} catch (error) {
			this.error(error.message);
			return;
		}

		// add the settings and args to the cannoli
		parsedCannoliJSON.settings = settings;
		parsedCannoliJSON.args = args;

		const limit = this.settings?.pLimit ?? 1000;

		// Check that the plimit is a number
		if (typeof limit == "number") {
			this.llmLimit = pLimit(limit);
		} else {
			this.llmLimit = pLimit(1000);
		}

		this.currentNote = this.args?.currentNote ?? "No current note";

		this.selection = this.args?.selection ?? "No selection";

		// Delete the current note and selection from the args
		delete this.args?.currentNote;
		delete this.args?.selection;


		// We need to replicate these when we make the args
		// 	this.currentNote = `[[${this.cannoli.app.workspace.getActiveFile()?.basename
		// 	}]]`;

		// this.selection =
		// 	this.cannoli.app.workspace.activeEditor?.editor?.getSelection()
		// 		? this.cannoli.app.workspace.activeEditor?.editor?.getSelection()
		// 		: null;

		this.fileSystemInterface = fileSystemInterface ?? null;


		const factory = new CannoliFactory(
			parsedCannoliJSON,
			this.settings ?? {},
			this.args ?? {}
		);

		const graphData = factory.getCannoliData();

		// Find all nodes of type "variable" or "input"
		const argNodes = graphData.nodes.filter((node) => node.cannoliData.type === "variable"
			|| node.cannoliData.type === "input");

		// For each arg, check if the key matches the first line of the text in the variable/input node
		for (const arg of Object.entries(this.args ?? {})) {
			const [key, value] = arg;
			const argNode = argNodes.find((node) => node.cannoliData.text.split("\n")[0] === `[${key}]`);
			if (argNode) {
				// If so, set the text of the variable/input node after the first line to the value
				argNode.cannoliData.text = argNode.cannoliData.text.split("\n")[0] + "\n" + value;
			} else {
				throw new Error(`Argument key "${key}" not found in arg nodes.`);
			}
		}


		this.graph = new CannoliGraph(
			graphData
		).graph;


		// Set this as the run for every object
		for (const object of Object.values(this.graph)) {
			object.setRun(this);
		}
	}

	async start() {
		// Log the graph
		// this.logGraph();

		// Setup listeners
		this.setupListeners();

		// Reset the graph
		this.reset();

		// Validate the graph
		this.validate();

		// If we have a canvas and its mock, remove all error nodes
		if (this.canvas && this.isMock) {
			await this.canvas.enqueueRemoveAllErrorNodes();
		}

		let executedObjectsCount = 0;

		// Call execute on all root objects
		for (const object of Object.values(this.graph)) {
			if (object.dependencies.length === 0) {
				object.execute();
				executedObjectsCount++;
			}
		}

		if (executedObjectsCount === 0) {
			this.error("No objects to execute");
		}
	}

	error(message: string) {
		this.isStopped = true;

		this.onFinish({
			reason: "error",
			usage: this.calculateAllLLMCosts(),
			totalCost: this.getTotalCost(),
			message,
			results: this.getResults(),
		});

		throw new Error(message);
	}

	stop() {
		this.isStopped = true;

		this.onFinish({
			reason: "user",
			usage: this.calculateAllLLMCosts(),
			totalCost: this.getTotalCost(),
			results: this.getResults(),
		});
	}

	reset() {
		this.isStopped = false;

		// Call reset on all objects
		for (const object of Object.values(this.graph)) {
			object.reset();
		}
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

	setupListeners() {
		for (const object of Object.values(this.graph)) {
			object.addEventListener("update", (event: CustomEvent) => {
				this.objectUpdated(
					event.detail.obj,
					event.detail.status,
					event.detail.message
				);
			});
		}
	}

	getDefaultConfig() {
		return this.llm?.getConfig() ?? {};
	}

	objectUpdated(
		object: CannoliObject,
		status: CannoliObjectStatus,
		message?: string
	) {
		switch (status) {
			case CannoliObjectStatus.Complete: {
				this.objectCompleted(object);
				break;
			}
			case CannoliObjectStatus.Rejected: {
				this.objectRejected(object);
				break;
			}
			case CannoliObjectStatus.Executing: {
				this.objectExecuting(object);
				break;
			}
			case CannoliObjectStatus.Pending: {
				this.objectPending(object);
				break;
			}
			case CannoliObjectStatus.Error: {
				this.objectError(object, message);
				break;
			}
			case CannoliObjectStatus.Warning: {
				this.objectWarning(object, message);
				break;
			}

			default: {
				throw new Error(`Unknown status: ${status}`);
			}
		}
	}

	objectCompleted(object: CannoliObject) {
		if (!this.isMock && this.canvas && object.originalObject === null) {
			if (object instanceof CallNode) {
				this.canvas.enqueueChangeNodeColor(object.id, "4");
			} else if (
				object instanceof ContentNode ||
				object instanceof FloatingNode
			) {
				this.canvas.enqueueChangeNodeText(object.id, object.text);
			}
		}

		if (this.allObjectsFinished() && !this.isStopped) {
			this.isStopped = true;
			this.onFinish({
				reason: "complete",
				usage: this.calculateAllLLMCosts(),
				totalCost: this.getTotalCost(),
				results: this.getResults(),
			});
		}
	}

	objectRejected(object: CannoliObject) {
		if (this.allObjectsFinished() && !this.isStopped) {
			this.isStopped = true;
			this.onFinish({
				reason: "complete",
				usage: this.calculateAllLLMCosts(),
				totalCost: this.getTotalCost(),
				results: this.getResults(),
			});
		}
	}

	objectExecuting(object: CannoliObject) {
		if (
			!this.isMock &&
			this.canvas &&
			object instanceof CallNode &&
			object.originalObject === null
		) {
			this.canvas.enqueueChangeNodeColor(object.id, "3");
		}
	}

	objectPending(object: CannoliObject) {
		if (this.canvas && object instanceof CallNode) {
			if (this.settings?.contentIsColorless) {
				this.canvas.enqueueChangeNodeColor(object.id, "6");
			} else {
				this.canvas.enqueueChangeNodeColor(object.id);
			}
		} else if (
			this.canvas &&
			object instanceof ContentNode &&
			object.text === ""
		) {
			this.canvas.enqueueChangeNodeText(object.id, "");
		}
	}

	objectError(object: CannoliObject, message?: string) {
		if (this.canvas && object instanceof CannoliVertex) {
			this.canvas.enqueueAddErrorNode(
				object.id,
				message ?? "Unknown error"
			);
		}

		this.error(message ?? "Unknown error");
	}

	objectWarning(object: CannoliObject, message?: string) {
		if (this.canvas && object instanceof CannoliVertex) {
			this.canvas.enqueueAddWarningNode(
				object.id,
				message ?? "Unknown warning"
			);
		}
	}

	allObjectsFinished(): boolean {
		// Check if all objects are complete or rejected
		for (const object of Object.values(this.graph)) {
			if (
				object.status !== CannoliObjectStatus.Complete &&
				object.status !== CannoliObjectStatus.Rejected
			) {
				return false;
			}
		}

		return true;
	}

	getResults(): { [key: string]: string } {
		const variableNodes = Object.values(this.graph).filter((object) => (object.type === "variable" || object.type === "output") && object.kind === "node");
		const results: { [key: string]: string } = {};
		for (const node of variableNodes) {
			// The key should be the first line without the square brackets
			const firstLine = node.text.split("\n")[0];
			const key = firstLine.substring(1, firstLine.length - 1);
			results[key] = node.text.split("\n").slice(1).join("\n");
		}
		return results;
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

	async callLLM(
		request: GenericCompletionParams,
		verbose?: boolean
	): Promise<GenericCompletionResponse | Error> {
		// console.log(`Request: ${JSON.stringify(request, null, 2)}`);

		return this.llmLimit(
			async (): Promise<GenericCompletionResponse | Error> => {
				// Only call LLM if we're not mocking
				if (this.isMock || !this.llm || !this.llm.initialized) {
					// return {
					// 	role: "assistant",
					// 	content: "Mock response",
					// };

					return this.createMockFunctionResponse(request);
				}

				// Catch any errors
				try {
					const response = await this.llm.getCompletion(request);
					const completion = response;

					if (verbose) {
						console.log(
							"Input Messages:\n" +
							JSON.stringify(request.messages, null, 2) +
							"\n\nResponse Message:\n" +
							JSON.stringify(completion, null, 2)
						);
					}

					const responseUsage =
						Llm.getCompletionResponseUsage(response);
					if (responseUsage && request.model) {
						// If the model doesn't exist in modelInfo, add it
						if (!this.modelInfo[request.model]) {
							this.modelInfo[request.model] = {
								name: request.model,
								promptTokenPrice: 0,
								completionTokenPrice: 0,
							};
						}

						const model = this.modelInfo[request.model];
						if (!this.usage[model.name]) {
							this.usage[model.name] = {
								model: model,
								modelUsage: {
									promptTokens: 0,
									completionTokens: 0,
									apiCalls: 0,
									totalCost: 0,
								},
							};
						}

						this.usage[model.name].modelUsage.promptTokens +=
							responseUsage.prompt_tokens;
						this.usage[model.name].modelUsage.completionTokens +=
							responseUsage.completion_tokens;
						this.usage[model.name].modelUsage.apiCalls += 1;
					}

					invariant(completion, "No message returned");

					return completion;
				} catch (e) {
					return e as Error;
				}
			}
		);
	}

	async callLLMStream(request: GenericCompletionParams) {
		if (this.isMock || !this.llm || !this.llm.initialized) {
			// Return mock stream
			return "Mock response";
		}

		try {
			const response = await this.llm.getCompletionStream(request);

			invariant(response, "No message returned");

			return response;
		} catch (e) {
			return e as Error;
		}
	}

	createMockFunctionResponse(
		request: GenericCompletionParams
	): GenericCompletionResponse {
		let textMessages = "";

		// For each message, convert it to a string, including the role and the content, and a function call if present
		for (const message of request.messages) {
			if ("function_call" in message && message.function_call) {
				textMessages += `${message.role}: ${message.content} ${message.function_call} `;
			} else {
				textMessages += `${message.role}: ${message.content} `;
			}
		}

		// Estimate the tokens using the rule of thumb that 4 characters is 1 token
		const promptTokens = textMessages.length / 4;

		if (
			request.model &&
			this.llm?.provider === "openai" &&
			!this.usage[request.model]
		) {
			// Find the right model from this.models

			if (!this.modelInfo[request.model]) {
				this.modelInfo[request.model] = {
					name: request.model,
					promptTokenPrice: 0,
					completionTokenPrice: 0,
				};
			}

			const model = this.modelInfo[request.model];

			this.usage[request.model] = {
				model: model,
				modelUsage: {
					promptTokens: 0,
					completionTokens: 0,
					apiCalls: 0,
					totalCost: 0,
				},
			};
		}

		if (request.model && this.usage[request.model]) {
			this.usage[request.model].modelUsage.promptTokens += promptTokens;
			this.usage[request.model].modelUsage.apiCalls += 1;
		}

		let calledFunction = "";

		if (request.functions && request.functions.length > 0) {
			calledFunction = request.functions[0].name;
		}

		if (calledFunction) {
			if (calledFunction === "choice") {
				// Find the choice function
				const choiceFunction = request.functions?.find(
					(fn) => fn.name === "choice"
				);

				if (!choiceFunction) {
					throw Error("No choice function found");
				}

				return this.createMockChoiceFunctionResponse(
					choiceFunction
				) as GenericCompletionResponse;
			} else if (calledFunction === "form") {
				// Find the answers function
				const formFunction = request.functions?.find(
					(fn) => fn.name === "form"
				);

				if (!formFunction) {
					throw Error("No form function found");
				}

				return this.createMockFormFunctionResponse(
					formFunction
				) as GenericCompletionResponse;
			} else if (calledFunction === "note_select") {
				// Find the note name function
				const noteNameFunction = request.functions?.find(
					(fn) => fn.name === "note_select"
				);

				if (!noteNameFunction) {
					throw Error("No note select function found");
				}

				return this.createMockNoteNameFunctionResponse(
					noteNameFunction
				) as GenericCompletionResponse;
			}
		}

		return {
			role: "assistant",
			content: "Mock response",
		};
	}

	createMockChoiceFunctionResponse(choiceFunction: GenericFunctionCall) {
		const parsedProperties = JSON.parse(
			JSON.stringify(choiceFunction?.parameters?.["properties"] ?? {})
		);

		// Pick one of the choices randomly
		const randomChoice =
			parsedProperties?.choice?.enum[
			Math.floor(
				Math.random() *
				(parsedProperties?.choice?.enum?.length ?? 0)
			)
			] ?? "N/A";

		return {
			role: "assistant",
			function_call: {
				name: "choice",
				arguments: `{
					"choice" : "${randomChoice}"
					}`,
			},
		};
	}

	createMockFormFunctionResponse(listFunction: GenericFunctionCall) {
		const args: { [key: string]: string }[] = [];

		// Go through the properties of the function and enter a mock string
		for (const property of Object.keys(
			(listFunction?.parameters?.["properties"] ?? {}) as Record<
				string,
				string
			>
		)) {
			args.push({
				[property]: "Mock answer",
			});
		}

		return {
			role: "assistant",
			function_call: {
				name: "form",
				arguments: JSON.stringify(args),
			},
		};
	}

	createMockNoteNameFunctionResponse(noteFunction: GenericFunctionCall) {
		const args: { [key: string]: string }[] = [];

		const parsedProperties = JSON.parse(
			JSON.stringify(noteFunction?.parameters?.["properties"] ?? {})
		);

		// Pick one of the options in note.enum randomly
		const randomNote =
			parsedProperties?.note?.enum[
			Math.random() * (parsedProperties?.note?.enum?.length ?? 0)
			] ?? "N/A";

		args.push({
			note: randomNote,
		});

		return {
			role: "assistant",
			function_call: {
				name: "note_select",
				arguments: JSON.stringify(args),
			},
		};
	}

	createChoiceFunction(choices: string[]): GenericFunctionCall {
		return {
			name: "choice",
			description: "Enter your choice using this function.",
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

	createFormFunction(
		tags: { name: string; noteNames?: string[] }[]
	): GenericFunctionCall {
		const properties: Record<string, { type: string; enum?: string[] }> =
			{};

		tags.forEach((tag) => {
			if (tag.noteNames) {
				properties[tag.name] = {
					type: "string",
					enum: tag.noteNames,
				};
				return;
			}
			properties[tag.name] = {
				type: "string",
			};
		});

		return {
			name: "form",
			description:
				"Use this function to enter the requested information for each key.",
			parameters: {
				type: "object",
				properties,
				required: tags.map((tag) => tag.name),
			},
		};
	}

	createNoteNameFunction(notes: string[]): GenericFunctionCall {
		return {
			name: "note_select",
			description: "Enter one of the provided valid note names.",
			parameters: {
				type: "object",
				properties: {
					note: {
						type: "string",
						enum: notes,
					},
				},
				required: ["note"],
			},
		};
	}

	calculateAllLLMCosts(): Record<string, Usage> {
		for (const usage of Object.values(this.usage)) {
			usage.modelUsage.totalCost = this.calculateLLMCostForModel(usage);
		}
		return this.usage;
	}

	calculateLLMCostForModel(usage: Usage): number {
		if (
			this.llm?.provider === "ollama" ||
			!usage ||
			!usage.model ||
			!usage.modelUsage
		)
			return 0;

		const promptCost =
			usage.model.promptTokenPrice * usage.modelUsage.promptTokens;
		const completionCost =
			usage.model.completionTokenPrice *
			usage.modelUsage.completionTokens;
		const totalCost = promptCost + completionCost;
		return totalCost;
	}

	getTotalCost(): number {
		let totalCost = 0;
		for (const usage of Object.values(this.usage)) {
			totalCost += this.calculateLLMCostForModel(usage);
		}
		return totalCost;
	}

	createHttpTemplate(inputString: string): HttpTemplate {
		// Split the input string by newline to separate the name from the JSON
		const lines = inputString.split("\n");
		const nameLine = lines[0];
		let jsonString = lines.slice(1).join("\n");

		// If the json string is in a text block, remove the leading and trailing quotes, as well as the language identifier
		if (jsonString.startsWith("```")) {
			jsonString = jsonString.substring(3, jsonString.length - 3);
		}

		if (jsonString.startsWith("json")) {
			jsonString = jsonString.substring(4, jsonString.length);
		}

		// Extract the name from the first line
		const name = nameLine.substring(1, nameLine.length - 1).trim();

		// Parse the JSON string
		const json = JSON.parse(jsonString);

		// Construct the httpTemplate object
		const httpTemplate: HttpTemplate = {
			id: "", // Using an empty string for the ID as specified
			name: name,
			url: json.url,
			method: json.method,
			headers: json.headers,
			bodyTemplate: JSON.stringify(json.bodyTemplate),
		};

		return httpTemplate;
	}

	async executeHttpTemplateFromFloatingNode(
		inputString: string,
		body: string | Record<string, string> | null
	): Promise<string | Error> {
		// If this is a mock, return a mock response
		if (this.isMock) {
			return "Mock response";
		}

		// Try to parse the input string into an httpTemplate object
		let template: HttpTemplate;
		try {
			template = this.createHttpTemplate(inputString);
		} catch (error) {
			return new Error(
				`Failed to create HTTP template from input string: ${error.message}`
			);
		}

		// Try to execute the parsed template
		try {
			return await executeHttpTemplate(template, body, this.fetcher);
		} catch (error) {
			return error;
		}
	}

	// parseBodyTemplate = (
	// 	template: string,
	// 	body: string | Record<string, string>
	// ): string => {
	// 	const variablesInTemplate = (template.match(/\{\{.*?\}\}/g) || []).map(
	// 		(v) => v.slice(2, -2)
	// 	);

	// 	if (variablesInTemplate.length === 1) {
	// 		let valueToReplace;
	// 		if (typeof body === "string") {
	// 			valueToReplace = body;
	// 		} else if (Object.keys(body).length === 1) {
	// 			valueToReplace = Object.values(body)[0];
	// 		} else {
	// 			throw new Error(
	// 				`Expected only one variable in the template, but found multiple values. This node expects the variable:\n  - ${variablesInTemplate[0]}\n\nWrite to this node using a single variable arrow or a write arrow.`
	// 			);
	// 		}

	// 		return template.replace(
	// 			new RegExp(`{{${variablesInTemplate[0]}}}`, "g"),
	// 			valueToReplace.replace(/\n/g, "\\n").replace(/"/g, '\\"')
	// 		);
	// 	}

	// 	let parsedTemplate = template;

	// 	if (typeof body === "object") {
	// 		for (const variable of variablesInTemplate) {
	// 			if (!(variable in body)) {
	// 				throw new Error(
	// 					`Missing value for variable "${variable}" in available arrows. This template requires the following variables:\n${variablesInTemplate
	// 						.map((v) => `  - ${v}`)
	// 						.join("\n")}`
	// 				);
	// 			}
	// 			parsedTemplate = parsedTemplate.replace(
	// 				new RegExp(`{{${variable}}}`, "g"),
	// 				body[variable].replace(/\n/g, "\\n").replace(/"/g, '\\"')
	// 			);
	// 		}

	// 		for (const key in body) {
	// 			if (!variablesInTemplate.includes(key)) {
	// 				throw new Error(
	// 					`Extra variable "${key}" in available arrows. This template requires the following variables:\n${variablesInTemplate
	// 						.map((v) => `  - ${v}`)
	// 						.join("\n")}`
	// 				);
	// 			}
	// 		}
	// 	} else {
	// 		throw new Error(
	// 			`This action node expected multiple variables, but only found one. This node expects the following variables:\n${variablesInTemplate
	// 				.map((v) => `  - ${v}`)
	// 				.join("\n")}`
	// 		);
	// 	}

	// 	return parsedTemplate;
	// };

	logGraph() {
		for (const node of Object.values(this.graph)) {
			console.log(node.logDetails());
		}
	}
}

export function executeHttpTemplate(
	template: HttpTemplate,
	body: string | Record<string, string> | null,
	fetcher: ResponseTextFetcher
): Promise<string> {
	return new Promise((resolve, reject) => {
		// Prepare body
		let requestBody: string;
		if (template.bodyTemplate) {
			requestBody = parseBodyTemplate(
				template.bodyTemplate,
				body || ""
			);
		} else {
			if (typeof body === "string") {
				requestBody = body;
			} else {
				requestBody = JSON.stringify(body);
			}
		}

		// Log the request body
		// console.log("HTTP Request Body:", requestBody);

		// Prepare fetch options
		const options = {
			method: template.method,
			headers: template.headers,
			body:
				template.method.toLowerCase() !== "get"
					? requestBody
					: undefined,
		};

		if (this.isMock) {
			resolve("mock response");
		} else {
			fetcher(template.url, options)
				.then((response) => {
					return response;
				})
				.then((text) => {
					let response;
					if (text.length > 0) {
						response = JSON.parse(text);
					} else {
						response = {};
					}

					if (response.status >= 400) {
						reject(
							new Error(
								`HTTP error ${response.status}: ${response.statusText}`
							)
						);
					} else {
						// Ensure the response is formatted nicely for markdown
						const formattedResponse = JSON.stringify(response, null, 2)
							.replace(/\\n/g, '\n') // Ensure newlines are properly formatted
							.replace(/\\t/g, '\t'); // Ensure tabs are properly formatted
						resolve(formattedResponse);
					}
				})
				.catch((error) => {
					reject(
						new Error(`Error on HTTP request: ${error.message}`)
					);
				});
		}
	});
}

export function parseBodyTemplate(
	template: string,
	body: string | Record<string, string>
): string {
	const variablesInTemplate = (template.match(/\{\{.*?\}\}/g) || []).map(
		(v) => v.slice(2, -2)
	);

	if (variablesInTemplate.length === 1) {
		let valueToReplace;
		if (typeof body === "string") {
			valueToReplace = body;
		} else if (Object.keys(body).length === 1) {
			valueToReplace = Object.values(body)[0];
		} else {
			throw new Error(
				`Expected only one variable in the template, but found multiple values. This node expects the variable:\n  - ${variablesInTemplate[0]}\n\nWrite to this node using a single variable arrow or a write arrow.`
			);
		}

		return template.replace(
			new RegExp(`{{${variablesInTemplate[0]}}}`, "g"),
			valueToReplace.replace(/\n/g, "\\n").replace(/"/g, '\\"')
		);
	}

	let parsedTemplate = template;

	if (typeof body === "object") {
		for (const variable of variablesInTemplate) {
			if (!(variable in body)) {
				throw new Error(
					`Missing value for variable "${variable}" in available arrows. This template requires the following variables:\n${variablesInTemplate
						.map((v) => `  - ${v}`)
						.join("\n")}`
				);
			}
			parsedTemplate = parsedTemplate.replace(
				new RegExp(`{{${variable}}}`, "g"),
				body[variable].replace(/\n/g, "\\n").replace(/"/g, '\\"')
			);
		}

		for (const key in body) {
			if (!variablesInTemplate.includes(key)) {
				throw new Error(
					`Extra variable "${key}" in available arrows. This template requires the following variables:\n${variablesInTemplate
						.map((v) => `  - ${v}`)
						.join("\n")}`
				);
			}
		}
	} else {
		throw new Error(
			`This action node expected multiple variables, but only found one. This node expects the following variables:\n${variablesInTemplate
				.map((v) => `  - ${v}`)
				.join("\n")}`
		);
	}

	return parsedTemplate;
}