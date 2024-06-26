import { Canvas } from "./canvas";
import { CallNode, ContentNode, FloatingNode } from "./models/node";
import { CannoliObject, CannoliVertex } from "./models/object";
import { requestUrl, resolveSubpath } from "obsidian";
import pLimit from "p-limit";
import { CannoliObjectStatus, Reference, ReferenceType } from "./models/graph";
import { HttpTemplate } from "main";
import Cannoli from "main";
import * as yaml from "js-yaml";
import {
	GenericCompletionParams,
	GenericCompletionResponse,
	GenericFunctionCall,
	GenericModelConfig,
	LLMProvider as Llm,
} from "src/providers";
import invariant from "tiny-invariant";
import { getAPI } from "obsidian-dataview";

export type StoppageReason = "user" | "error" | "complete";

interface Limit {
	(fn: () => Promise<GenericCompletionResponse | Error>): Promise<
		GenericCompletionResponse | Error
	>;
}

export interface Stoppage {
	reason: StoppageReason;
	usage: Record<string, Usage>;
	totalCost: number;
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

export class Run {
	graph: Record<string, CannoliObject> = {};
	onFinish: (stoppage: Stoppage) => void;
	cannoli: Cannoli;

	llm: Llm | null;
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
		graph,
		onFinish,
		isMock,
		canvas,
		llm,
		cannoli,
	}: {
		graph: Record<string, CannoliObject>;
		cannoli: Cannoli;
		onFinish?: (stoppage: Stoppage) => void;
		isMock?: boolean;
		canvas?: Canvas;
		llm?: Llm;
	}) {
		this.graph = graph;
		this.onFinish = onFinish ?? ((stoppage: Stoppage) => { });
		this.isMock = isMock ?? false;
		this.cannoli = cannoli;
		this.canvas = canvas ?? null;
		this.llm = llm ?? null;
		this.usage = {};
		this.llmLimit = pLimit(this.cannoli.settings.pLimit);
		this.currentNote = `[[${this.cannoli.app.workspace.getActiveFile()?.basename
			}]]`;

		this.selection =
			this.cannoli.app.workspace.activeEditor?.editor?.getSelection()
				? this.cannoli.app.workspace.activeEditor?.editor?.getSelection()
				: null;

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

		// Call execute on all root objects
		for (const object of Object.values(this.graph)) {
			if (object.dependencies.length === 0) {
				object.execute();
			}
		}
	}

	error(message: string) {
		this.isStopped = true;

		this.onFinish({
			reason: "error",
			usage: this.calculateAllLLMCosts(),
			totalCost: this.getTotalCost(),
			message,
		});

		throw new Error(message);
	}

	stop() {
		this.isStopped = true;

		this.onFinish({
			reason: "user",
			usage: this.calculateAllLLMCosts(),
			totalCost: this.getTotalCost(),
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
			if (this.cannoli.settings.contentIsColorless) {
				this.canvas.enqueueChangeNodeColor(object.id, "6");
			} else {
				this.canvas.enqueueChangeNodeColor(object.id, "0");
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
			return await this.executeHttpTemplate(template, body);
		} catch (error) {
			return error;
		}
	}

	async executeHttpTemplateByName(
		name: string,
		body: string | Record<string, string> | null
	): Promise<string | Error> {
		// REMOVE WHEN I FIGURE OUT MOCKING
		if (this.isMock) {
			return "Mock response";
		}

		// If we don't have an httpTemplates array, we can't execute commands
		if (!this.cannoli.settings.httpTemplates) {
			return new Error(
				"No HTTP templates available. You can add them in Cannoli Plugin settings."
			);
		}

		// Find the template by name
		const template = this.cannoli.settings.httpTemplates.find(
			(template) => template.name === name
		);

		if (!template) {
			return new Error(`HTTP template with name "${name}" not found.`);
		}

		try {
			return await this.executeHttpTemplate(template, body);
		} catch (error) {
			return error;
		}
	}

	parseBodyTemplate = (
		template: string,
		body: string | Record<string, string>
	): string => {
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
	};

	executeHttpTemplate(
		template: HttpTemplate,
		body: string | Record<string, string> | null
	): Promise<string> {
		return new Promise((resolve, reject) => {
			// Prepare body
			let requestBody: string;

			if (template.bodyTemplate) {
				requestBody = this.parseBodyTemplate(
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
			}
			{
				requestUrl({ ...options, url: template.url })
					.then((response) => {
						return response.text;
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
							resolve(JSON.stringify(response, null, 2));
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

	async editNote(
		reference: Reference,
		newContent: string,
		append?: boolean
	): Promise<void | null> {
		// Only edit the file if we're not mocking
		if (this.isMock) {
			return;
		}

		// Get the file
		const filename = reference.name.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		if (append) {
			await this.cannoli.app.vault.process(file, (content) => {
				return content + newContent;
			});
			// If the active file is the file we just edited, update the editor
			if (
				this.cannoli.app.workspace.activeEditor?.file?.basename ===
				file.basename
			) {
				// If the content is a user template, wait a bit and then move the cursor to the end of the file
				const userTemplate =
					"\n\n" +
					this.cannoli.settings.chatFormatString
						?.replace("{{role}}", "User")
						.replace("{{content}}", "");

				if (newContent === userTemplate) {
					await new Promise((resolve) => setTimeout(resolve, 40));
				}

				// If the setting is enabled, scroll to the end of the file
				if (this.cannoli.settings.autoScrollWithTokenStream) {
					// Set the cursor to the end of the file
					this.cannoli.app.workspace.activeEditor?.editor?.setCursor(
						this.cannoli.app.workspace.activeEditor?.editor?.lineCount() ||
						0,
						0
					);
				}
			}
		} else {
			if (reference.includeProperties) {
				await this.cannoli.app.vault.modify(file, newContent);
			} else {
				await this.cannoli.app.vault.process(file, (content) => {
					// If includeProperties is false, the edit shouldn't change the yaml frontmatter
					const yamlFrontmatter = content.match(
						/^---\n[\s\S]*?\n---\n/
					)?.[0];

					if (yamlFrontmatter) {
						return yamlFrontmatter + newContent;
					} else {
						return newContent;
					}
				});
			}
		}

		return;
	}

	async getNote(
		reference: Reference,
		recursionCount = 0
	): Promise<string | null> {
		// If we're mocking, return a mock response
		if (this.isMock) {
			return `# ${reference.name}\nMock note content`;
		}

		// If the note is formatted with the path, get rid of the path and just use the note name
		if (reference.name.includes("|")) {
			reference.name = reference.name.split("|")[1];
		}

		// Get the file
		const filename = reference.name.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		// Read the file
		let content = await this.cannoli.app.vault.read(file);

		if (reference.subpath) {
			const metadata = this.cannoli.app.metadataCache.getCache(file.path);

			if (!metadata) return null;

			const subpath = resolveSubpath(metadata, reference.subpath);

			if (!subpath) return null;

			const startLine = subpath.start.line;
			const endLine: number | null = subpath.end?.line ?? null;

			const lines = content.split("\n");

			if (endLine) {
				if (startLine === endLine) {
					return lines[startLine].trim();
				} else {
					content = lines.slice(startLine, endLine).join("\n");
				}
			} else {
				content = lines.slice(startLine).join("\n");
			}

			// If includeLink is true, add the markdown link
			if (reference.includeLink) {
				const link = `[[${file.path}#${reference.subpath}]]`;
				content = link + "\n" + content;
			}

			content = content.trim();

			if (content === "") {
				return null;
			}
		} else {
			// If includeProperties is false, check for yaml frontmatter and remove it
			if (
				reference.includeProperties ??
				this.cannoli.settings.includePropertiesInExtractedNotes
			) {
				// Empty
			} else {
				const yamlFrontmatter = content.match(
					/^---\n[\s\S]*?\n---\n/
				)?.[0];

				if (yamlFrontmatter) {
					content = content.replace(yamlFrontmatter, "");
				}
			}

			// If includeFilenameAsHeader is true, add the filename as a header
			if (
				reference.includeName ??
				this.cannoli.settings.includeFilenameAsHeader
			) {
				const header = `# ${file.basename}\n`;
				content = header + content;
			}

			// If includeLink is true, add the markdown link
			if (reference.includeLink) {
				const link = `[[${file.path}]]`;
				content = link + "\n" + content;
			}
		}

		const embeddedNotes = content.match(/!\[\[[\s\S]*?\]\]/g);

		if (embeddedNotes) {
			for (const embeddedNote of embeddedNotes) {
				let noteName = embeddedNote
					.replace("![[", "")
					.replace("]]", "");

				let subpath;

				// If there's a pipe, split and use the first part as the note name
				if (noteName.includes("|")) {
					noteName = noteName.split("|")[0];
				}

				// If there's a "#", split and use the first part as the note name, and the second part as the heading
				if (noteName.includes("#")) {
					const split = noteName.split("#");
					noteName = split[0];
					subpath = split[1];
				}

				// Check for recursive embedded notes
				if (noteName === reference.name) {
					continue;
				}

				// Check for recursion limit (hardcoded to 10 for now)
				if (recursionCount > 10) {
					console.error(
						`Recursion limit reached while extracting note "${noteName}".`
					);
					continue;
				}

				const noteContent = await this.getNote(
					{
						name: noteName,
						type: ReferenceType.Note,
						shouldExtract: true,
						includeName: true,
						subpath: subpath,
					},
					recursionCount + 1
				);

				if (noteContent) {
					const blockquotedNoteContent =
						"> " + noteContent.replace(/\n/g, "\n> ");
					content = content.replace(
						embeddedNote,
						blockquotedNoteContent
					);
				}
			}
		}

		// Render dataview queries
		content = await this.replaceDataviewQueries(content);

		// Render smart connections
		content = await this.replaceSmartConnections(content);

		return content;
	}

	async replaceDataviewQueries(content: string): Promise<string> {
		const nonEmbedRegex = /```dataview\n([\s\S]*?)\n```/g;
		const embedRegex = /{{\n```dataview\n([\s\S]*?)\n```\n([^\n]*)}}/g;
		const anyDataviewRegex = /```dataview\n([\s\S]*?)\n```/;

		if (!anyDataviewRegex.test(content)) {
			return content;
		}


		const dvApi = getAPI(this.cannoli.app);
		if (!dvApi) {
			return content;
		}


		// Handle embedded dataview queries

		let embedMatch;
		const embedMatches = [];
		// Extract all matches first
		while ((embedMatch = embedRegex.exec(content)) !== null) {
			embedMatches.push({
				fullMatch: embedMatch[0],
				query: embedMatch[1],
				modifiers: embedMatch[2],
				index: embedMatch.index
			});
		}

		// Reverse the matches array to process from last to first
		embedMatches.reverse();

		// Process each match asynchronously
		for (const match of embedMatches) {
			let includeName = false;
			let includeProperties = false;
			let includeLink = false;

			if (match.modifiers.includes('!#')) {
				includeName = false;
			} else if (match.modifiers.includes('#')) {
				includeName = true;
			} else {
				includeName = this.cannoli.settings.includeFilenameAsHeader;
			}

			if (match.modifiers.includes('!^')) {
				includeProperties = false;
			} else if (match.modifiers.includes('^')) {
				includeProperties = true;
			} else {
				includeProperties = this.cannoli.settings.includePropertiesInExtractedNotes;
			}

			if (match.modifiers.includes('!@')) {
				includeLink = false;
			} else if (match.modifiers.includes('@')) {
				includeLink = true;
			} else {
				includeLink = this.cannoli.settings.includeLinkInExtractedNotes;
			}

			const dvApi = getAPI(this.cannoli.app);
			if (!dvApi) {
				continue;
			}

			const queryResult = await dvApi.queryMarkdown(match.query);
			const result = queryResult.successful ? queryResult.value : "Invalid dataview query";

			const resultLinksReplaced = await this.replaceLinks(result, includeName, includeProperties, includeLink);

			// Replace the original text with the result
			content = content.substring(0, match.index) + resultLinksReplaced + content.substring(match.index + match.fullMatch.length);
		}

		// Handle normal dataview queries
		let nonEmbedMatch;
		const nonEmbedMatches = [];

		while ((nonEmbedMatch = nonEmbedRegex.exec(content)) !== null) {
			nonEmbedMatches.push({
				fullMatch: nonEmbedMatch[0],
				query: nonEmbedMatch[1],
				index: nonEmbedMatch.index
			});
		}

		// Reverse the matches array to process from last to first
		nonEmbedMatches.reverse();

		// Process each match asynchronously
		for (const match of nonEmbedMatches) {
			const queryResult = await dvApi.queryMarkdown(match.query);
			let result = queryResult.successful ? queryResult.value : "Invalid Dataview query";

			// Check if the result is a single line list, and if so, remove the bullet point
			if (result.startsWith("- ") && result.split("\n").length === 2) {
				result = result.substring(2);
			}

			// Replace the original text with the result
			content = content.substring(0, match.index) + result + content.substring(match.index + match.fullMatch.length);
		}

		return content;
	}

	async replaceLinks(resultContent: string, includeName: boolean, includeProperties: boolean, includeLink: boolean): Promise<string> {
		const linkRegex = /\[\[([^\]]+)\]\]/g;
		let processedContent = "";
		let lastIndex = 0;
		let match;
		while ((match = linkRegex.exec(resultContent)) !== null) {
			processedContent += resultContent.substring(lastIndex, match.index);

			const reference = {
				name: match[1],
				type: ReferenceType.Note,
				shouldExtract: true,
				includeName: includeName,
				includeProperties: includeProperties,
				includeLink: includeLink
			};

			const noteContent = await this.getNote(reference);

			// If the processed content ends with "- ", remove it
			if (processedContent.endsWith("- ")) {
				processedContent = processedContent.substring(0, processedContent.length - 2);
			}

			processedContent += noteContent;
			lastIndex = match.index + match[0].length;
		}
		processedContent += resultContent.substring(lastIndex);

		return processedContent;
	}

	async replaceSmartConnections(content: string): Promise<string> {
		const nonEmbedRegex = /```smart-connections\n([\s\S]*?)\n```/g;
		const embedRegex = /{{([^\n]*)\n```smart-connections\n([\s\S]*?)\n```\n([^\n]*)}}/g;
		const anySCRegex = /```smart-connections\n([\s\S]*?)\n```/;

		if (!anySCRegex.test(content)) {
			return content;
		}

		// This is what we're trying to access: !this.cannoli.app.plugins.plugins["smart-connections"].api
		// We need to try to access it in a way that doesn't throw an error if the plugin isn't found
		try {
			// @ts-ignore - This is a private API
			if (!this.cannoli.app.plugins.plugins["smart-connections"].api) {
				console.error("Smart Connections plugin not found");
				return content;
			}
		} catch (error) {
			return content;
		}

		// Handle embedded dataview queries

		let embedMatch;
		const embedMatches = [];
		// Extract all matches first
		while ((embedMatch = embedRegex.exec(content)) !== null) {
			embedMatches.push({
				fullMatch: embedMatch[0],
				limit: embedMatch[1],
				query: embedMatch[2],
				modifiers: embedMatch[3],
				index: embedMatch.index
			});
		}

		// Reverse the matches array to process from last to first
		embedMatches.reverse();

		// Process each match asynchronously
		for (const match of embedMatches) {
			let includeName = false;
			let includeProperties = false;
			let includeLink = false;

			if (match.modifiers.includes('!#')) {
				includeName = false;
			} else if (match.modifiers.includes('#')) {
				includeName = true;
			} else {
				includeName = this.cannoli.settings.includeFilenameAsHeader;
			}

			if (match.modifiers.includes('!^')) {
				includeProperties = false;
			} else if (match.modifiers.includes('^')) {
				includeProperties = true;
			} else {
				includeProperties = this.cannoli.settings.includePropertiesInExtractedNotes;
			}

			if (match.modifiers.includes('!@')) {
				includeLink = false;
			} else if (match.modifiers.includes('@')) {
				includeLink = true;
			} else {
				includeLink = this.cannoli.settings.includeLinkInExtractedNotes;
			}

			// @ts-ignore - This is a private API
			let result = await this.cannoli.app.plugins.plugins["smart-connections"].api.search(match.query);

			// If there's no limit defined, use the default limit of 5. If the limit is defined, parse it as an integer and truncate the results array
			const limit = match.limit ? parseInt(match.limit) : 5;

			if (result.length > limit) {
				result = result.slice(0, limit);
			}

			// Build the replacement string by retrieving the note content for each result and concatenating them with a newline
			let resultLinksReplaced = "";
			for (const r of result) {
				let noteName = r.path;
				let subpath;

				// If there's a "#" in the path, split and use the first part as the note name, and the second part as the heading
				if (noteName.includes("#")) {
					const split = noteName.split("#");
					noteName = split[0];
					subpath = split[1];
				}

				const reference = {
					name: noteName,
					type: ReferenceType.Note,
					shouldExtract: true,
					includeName: includeName,
					includeProperties: includeProperties,
					includeLink: includeLink,
					subpath: subpath ?? undefined
				};

				const noteContent = await this.getNote(reference);

				resultLinksReplaced += noteContent + "\n";
			}

			// Replace the original text with the result
			content = content.substring(0, match.index) + resultLinksReplaced + content.substring(match.index + match.fullMatch.length);
		}

		// Handle normal dataview queries
		let nonEmbedMatch;
		const nonEmbedMatches = [];

		while ((nonEmbedMatch = nonEmbedRegex.exec(content)) !== null) {
			nonEmbedMatches.push({
				fullMatch: nonEmbedMatch[0],
				query: nonEmbedMatch[1],
				index: nonEmbedMatch.index
			});
		}

		// Reverse the matches array to process from last to first
		nonEmbedMatches.reverse();

		// Process each match asynchronously
		for (const match of nonEmbedMatches) {
			// @ts-ignore - This is a private API
			const results = await this.cannoli.app.plugins.plugins["smart-connections"].api.search(match.query);

			// Build a markdown table of with the columns "Similarity" (results[0].sim) and "Link" (results[i].path)
			let result = "| Similarity | Link |\n| --- | --- |\n";

			// @ts-ignore - This is a private API
			results.forEach((r) => {
				if (typeof r === "object" && r.sim && r.path) {
					result += `| ${r.sim.toFixed(2)} | [[${r.path}]] |\n`;
				}
			});

			// const result = queryResult.successful ? queryResult.value : "Invalid Dataview query";

			// Replace the original text with the result
			content = content.substring(0, match.index) + result + content.substring(match.index + match.fullMatch.length);
		}

		return content;

	}

	// Attempting to replace dataviewjs queries
	// const dataviewsjs = newContent.match(
	// 	/```dataviewjs\n([\s\S]*?)\n```/g
	// );
	// if (dvApi && dataviewsjs && dataviewsjs.length) {
	// 	for (const dataview of dataviewsjs) {
	// 		const sanitizedQuery = dataview.replace("```dataviewjs", "").replace("```", "").trim()

	// 		console.log(sanitizedQuery)

	// 		// Make an empty HTML element to render the dataview output
	// 		const dvOutput = createEl("div");

	// 		// Make an empty/fake component to render the dataview output
	// 		const dvComponent = new Component();

	// 		dvComponent.onload = () => {
	// 			// Do nothing
	// 		}

	// 		const dvContent = await dvApi.executeJs(sanitizedQuery, dvOutput, dvComponent, "")

	// 		newContent = newContent.replace(dataview, dvOutput.innerHTML)

	// 		console.log(dvOutput.innerHTML)
	// 	}
	// }

	editSelection(newContent: string) {
		if (this.isMock) {
			return;
		}

		if (!this.cannoli.app.workspace.activeEditor) {
			return;
		}

		this.cannoli.app.workspace.activeEditor?.editor?.replaceSelection(
			newContent
		);
	}

	async getPropertyOfNote(
		noteName: string,
		propertyName: string,
		yamlFormat = false
	): Promise<string | null> {
		// Get the file
		const filename = noteName.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		try {
			// Read the file to get the frontmatter
			let frontmatter: Record<string, unknown> = {};
			await this.cannoli.app.fileManager.processFrontMatter(
				file,
				(content) => {
					frontmatter = content;
					return content;
				}
			);

			// If frontmatter is null or undefined, return null
			if (!frontmatter) {
				return null;
			}

			const property = frontmatter[propertyName];

			if (typeof property !== "string") {
				if (yamlFormat) {
					return yaml.dump(property);
				} else {
					return JSON.stringify(frontmatter[propertyName], null, 2);
				}
			} else {
				return property;
			}
		} catch (error) {
			console.error(
				"An error occurred while fetching frontmatter:",
				error
			);
			return null;
		}
	}

	async getAllPropertiesOfNote(
		noteName: string,
		yamlFormat = false
	): Promise<string | null> {
		// Get the file
		const filename = noteName.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		try {
			// Read the file to get the frontmatter
			let frontmatter: Record<string, unknown> = {};
			await this.cannoli.app.fileManager.processFrontMatter(
				file,
				(content) => {
					frontmatter = content;
					return content;
				}
			);

			// If frontmatter is null or undefined, return null
			if (!frontmatter) {
				return null;
			}

			if (!yamlFormat) {
				return JSON.stringify(frontmatter, null, 2);
			} else {
				return yaml.dump(frontmatter);
			}
		} catch (error) {
			console.error(
				"An error occurred while fetching frontmatter:",
				error
			);
			return null;
		}
	}

	async editPropertyOfNote(
		noteName: string,
		propertyName: string,
		newValue: string
	): Promise<void> {
		// Get the file
		const filename = noteName.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return;
		}

		let parsedNewValue: string[] | string | number | boolean | null =
			newValue;

		// If the new value is a yaml list (starts with "- "), parse it into an array and remove any empty items
		if (newValue.startsWith("- ")) {
			parsedNewValue = newValue
				.split("\n")
				.map((item) => item.replace("- ", "").trim())
				.filter((item) => item !== "");
		}

		try {
			await this.cannoli.app.fileManager.processFrontMatter(
				file,
				(content) => {
					// Parse the frontmatter
					let frontmatter: Record<string, unknown> = {};

					if (content) {
						frontmatter = content;
					}

					// Set the property
					frontmatter[propertyName] = parsedNewValue;

					// Write the frontmatter
					return frontmatter;
				}
			);
			return;
		} catch (error) {
			console.error(
				"An error occurred while editing frontmatter:",
				error
			);
			return;
		}
	}

	async createNoteAtExistingPath(
		noteName: string,
		path?: string,
		content?: string,
		verbose = false
	): Promise<string | null> {
		// If there are double brackets, remove them
		noteName = noteName.replace("[[", "").replace("]]", "");

		// Attempt to create the note, adding or incrementing a number at the end of the note name if it already exists
		let i = 1;

		while (
			this.cannoli.app.metadataCache.getFirstLinkpathDest(noteName, "")
		) {
			// If the note name ends with " n", remove the " n" and increment n
			if (noteName.match(/ \d+$/)) {
				noteName = noteName.replace(/ \d+$/, ` ${i.toString()}`);
			} else {
				noteName = `${noteName} ${i.toString()}`;
			}
			i++;
		}

		// Create the path by appending the note name to the path with .md
		const fullPath = `${path ?? ""}/${noteName}.md`;

		// Create the note
		await this.cannoli.app.vault.create(fullPath, content ?? "");

		if (verbose) {
			console.log(`Note "${noteName}" created at path "${fullPath}"`);
		}

		return noteName;
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
		await this.cannoli.app.vault.create(fullPath, content ?? "");

		if (verbose) {
			console.log(`Note "${noteName}" created at path "${fullPath}"`);
		}

		return true;
	}

	async getNotePath(noteName: string): Promise<string | null> {
		const filename = noteName.replace("[[", "").replace("]]", "");
		const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		if (!file) {
			return null;
		}

		return file.path;
	}

	async createFolder(path: string, verbose = false): Promise<boolean> {
		// Check if the path already exists
		const folder = this.cannoli.app.vault.getAbstractFileByPath(path);

		if (folder) {
			return false;
		}

		// Create the folder
		this.cannoli.app.vault.createFolder(path);

		if (verbose) {
			console.log(`Folder created at path "${path}"`);
		}

		return true;
	}

	async moveNote(
		noteName: string,
		newPath: string,
		verbose = false
	): Promise<boolean> {
		// Create the path by appending the note name to the paths with .md
		const newFullPath = `${newPath}/${noteName}.md`;

		const filename = noteName.replace("[[", "").replace("]]", "");
		const note = this.cannoli.app.metadataCache.getFirstLinkpathDest(
			filename,
			""
		);

		// Get the old path
		const oldFullPath = note?.path;

		if (!note) {
			return false;
		}

		// Move the note
		await this.cannoli.app.vault.rename(note, newFullPath);

		if (verbose) {
			console.log(
				`Note "${noteName}" moved from path "${oldFullPath}" to path "${newFullPath}"`
			);
		}

		return true;
	}

	logGraph() {
		for (const node of Object.values(this.graph)) {
			console.log(node.logDetails());
		}
	}
}
