import { OpenAI } from "openai";
import { Canvas } from "./canvas";
import { CallNode, ContentNode, FloatingNode } from "./models/node";
import { CannoliObject, CannoliVertex } from "./models/object";
import { requestUrl, resolveSubpath } from "obsidian";
import pLimit from "p-limit";
import { CannoliObjectStatus, Reference, ReferenceType } from "./models/graph";
import { HttpTemplate } from "main";
import Cannoli from "main";
import {
	ChatCompletionChunk,
	ChatCompletionCreateParams,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessage,
} from "openai/resources/chat";
import { Stream } from "openai/streaming";
import * as yaml from "js-yaml";

export type StoppageReason = "user" | "error" | "complete";

interface Limit {
	(fn: () => Promise<ChatCompletionMessage | Error>): Promise<
		ChatCompletionMessage | Error
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

export interface OpenAIConfig {
	model: string;
	role?: string;
	frequency_penalty?: number | undefined;
	presence_penalty?: number | undefined;
	stop?: string[] | undefined;
	function_call?: string | undefined;
	functions?: ChatCompletionCreateParams.Function[] | undefined;
	temperature?: number | undefined;
	top_p?: number | undefined;
}

export type ChatRole = "user" | "assistant" | "system";

enum DagCheckState {
	UNVISITED,
	VISITING,
	VISITED,
}

export function isValidKey(
	key: string,
	config: OpenAIConfig
): key is keyof OpenAIConfig {
	return key in config;
}

export class Run {
	graph: Record<string, CannoliObject> = {};
	onFinish: (stoppage: Stoppage) => void;
	cannoli: Cannoli;

	openai: OpenAI | null;
	llmLimit: Limit;
	canvas: Canvas | null;
	isMock: boolean;
	isStopped = false;
	currentNote: string | null = null;

	modelInfo: Record<string, Model> = {
		"gpt-4": {
			name: "gpt-4",
			promptTokenPrice: 0.03 / 1000, // $0.03 per 1K tokens
			completionTokenPrice: 0.06 / 1000, // $0.06 per 1K tokens
		},

		"gpt-3.5-turbo": {
			name: "gpt-3.5-turbo",
			promptTokenPrice: 0.0015 / 1000, // $0.0015 per 1K tokens
			completionTokenPrice: 0.002 / 1000, // $0.002 per 1K tokens
		},
	};

	openaiConfig: OpenAIConfig = {
		model: "gpt-3.5-turbo",
		frequency_penalty: undefined,
		presence_penalty: undefined,
		stop: undefined,
		function_call: undefined,
		functions: undefined,
		temperature: undefined,
		top_p: undefined,
		role: "user",
	};

	usage: Record<string, Usage>;

	constructor({
		graph,
		onFinish,
		isMock,
		canvas,
		openai,
		openAiConfig,
		llmLimit,
		cannoli,
	}: {
		graph: Record<string, CannoliObject>;
		cannoli: Cannoli;

		onFinish?: (stoppage: Stoppage) => void;
		isMock?: boolean;
		canvas?: Canvas;
		openai?: OpenAI;
		openAiConfig?: OpenAIConfig;
		llmLimit?: number;
	}) {
		this.graph = graph;
		this.onFinish = onFinish ?? ((stoppage: Stoppage) => {});
		this.isMock = isMock ?? false;
		this.cannoli = cannoli;
		this.canvas = canvas ?? null;
		this.openai = openai ?? null;
		this.usage = {};
		this.llmLimit = pLimit(llmLimit ?? 10);
		this.currentNote = `[[${
			this.cannoli.app.workspace.getActiveFile()?.basename
		}]]`;

		// Set the default openai config
		this.openaiConfig = openAiConfig ? openAiConfig : this.openaiConfig;

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

	getDefaultConfig(): OpenAIConfig {
		return this.openaiConfig;
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
			this.canvas.enqueueChangeNodeColor(object.id, "0");
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
		request: ChatCompletionCreateParamsNonStreaming,
		verbose?: boolean
	): Promise<ChatCompletionMessage | Error> {
		// console.log(`Request: ${JSON.stringify(request, null, 2)}`);

		return this.llmLimit(
			async (): Promise<ChatCompletionMessage | Error> => {
				// Only call LLM if we're not mocking
				if (this.isMock || !this.openai) {
					// return {
					// 	role: "assistant",
					// 	content: "Mock response",
					// };

					return this.createMockFunctionResponse(request);
				}

				// Catch any errors
				try {
					const response = await this.openai.chat.completions.create(
						request
					);

					if (verbose) {
						console.log(
							"Input Messages:\n" +
								JSON.stringify(request.messages, null, 2) +
								"\n\nResponse Message:\n" +
								JSON.stringify(
									response.choices[0].message,
									null,
									2
								)
						);
					}

					if (response.usage) {
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
							response.usage.prompt_tokens;
						this.usage[model.name].modelUsage.completionTokens +=
							response.usage.completion_tokens;
						this.usage[model.name].modelUsage.apiCalls += 1;
					}
					return response.choices[0].message
						? response.choices[0].message
						: Error("No message returned");
				} catch (e) {
					return e;
				}
			}
		);
	}

	async callLLMStream(
		request: ChatCompletionCreateParamsStreaming
	): Promise<Stream<ChatCompletionChunk> | string | Error> {
		// console.log(`Request: ${JSON.stringify(request, null, 2)}`);

		if (this.isMock || !this.openai) {
			// Return mock stream
			return "Mock response";
		}

		try {
			const response = await this.openai.chat.completions.create(request);

			return response ? response : Error("No message returned");
		} catch (e) {
			return e;
		}
	}

	createMockFunctionResponse(
		request: ChatCompletionCreateParamsNonStreaming
	): ChatCompletionMessage {
		let textMessages = "";

		// For each message, convert it to a string, including the role and the content, and a function call if present
		for (const message of request.messages) {
			if (message.function_call) {
				textMessages += `${message.role}: ${message.content} ${message.function_call} `;
			} else {
				textMessages += `${message.role}: ${message.content} `;
			}
		}

		// Estimate the tokens using the rule of thumb that 4 characters is 1 token
		const promptTokens = textMessages.length / 4;

		if (!this.usage[request.model]) {
			// Find the right model from this.models
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

		this.usage[request.model].modelUsage.promptTokens += promptTokens;
		this.usage[request.model].modelUsage.apiCalls += 1;

		let calledFunction = "";

		if (request.functions && request.functions.length > 0) {
			calledFunction = request.functions[0].name;
		}

		if (calledFunction) {
			if (calledFunction === "enter_choice") {
				// Find the choice function
				const choiceFunction = request.functions?.find(
					(fn) => fn.name === "enter_choice"
				);

				if (!choiceFunction) {
					throw Error("No choice function found");
				}

				return this.createMockChoiceFunctionResponse(
					choiceFunction
				) as ChatCompletionMessage;
			} else if (calledFunction === "enter_answers") {
				// Find the answers function
				const listFunction = request.functions?.find(
					(fn) => fn.name === "enter_answers"
				);

				if (!listFunction) {
					throw Error("No list function found");
				}

				return this.createMockListFunctionResponse(
					listFunction
				) as ChatCompletionMessage;
			} else if (calledFunction === "enter_note_name") {
				// Find the note name function
				const noteNameFunction = request.functions?.find(
					(fn) => fn.name === "enter_note_name"
				);

				if (!noteNameFunction) {
					throw Error("No note name function found");
				}

				return this.createMockNoteNameFunctionResponse(
					noteNameFunction
				) as ChatCompletionMessage;
			}
		}

		return {
			role: "assistant",
			content: "Mock response",
		};
	}

	createMockChoiceFunctionResponse(
		choiceFunction: ChatCompletionCreateParams.Function
	) {
		const parsedProperties = JSON.parse(
			JSON.stringify(choiceFunction?.parameters["properties"])
		);

		// Pick one of the choices randomly
		const randomChoice =
			parsedProperties.choice.enum[
				Math.floor(Math.random() * parsedProperties.choice.enum.length)
			];

		return {
			role: "assistant",
			function_call: {
				name: "enter_choice",
				arguments: `{
					"choice" : "${randomChoice}"
					}`,
			},
		};
	}

	createMockListFunctionResponse(
		listFunction: ChatCompletionCreateParams.Function
	) {
		const args: { [key: string]: string }[] = [];

		// Go through the properties of the function and enter a mock string
		for (const property of Object.keys(
			listFunction?.parameters["properties"] as Record<string, string>
		)) {
			args.push({
				[property]: "Mock answer",
			});
		}

		return {
			role: "assistant",
			function_call: {
				name: "enter_answers",
				arguments: JSON.stringify(args),
			},
		};
	}

	createMockNoteNameFunctionResponse(
		noteFunction: ChatCompletionCreateParams.Function
	) {
		const args: { [key: string]: string }[] = [];

		const parsedProperties = JSON.parse(
			JSON.stringify(noteFunction?.parameters["properties"])
		);

		// Pick one of the options in note.enum randomly
		const randomNote =
			parsedProperties.note.enum[
				Math.random() * parsedProperties.note.enum.length
			];

		args.push({
			note: randomNote,
		});

		return {
			role: "assistant",
			function_call: {
				name: "enter_note_names",
				arguments: JSON.stringify(args),
			},
		};
	}

	createChoiceFunction(
		choices: string[]
	): ChatCompletionCreateParams.Function {
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

	createListFunction(
		tags: { name: string; noteNames?: string[] }[]
	): ChatCompletionCreateParams.Function {
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
			name: "enter_answers",
			description:
				"Use this function to enter the requested information for each key.",
			parameters: {
				type: "object",
				properties,
				required: tags.map((tag) => tag.name),
			},
		};
	}

	createNoteNameFunction(
		notes: string[]
	): ChatCompletionCreateParams.Function {
		return {
			name: "enter_note_name",
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

		return content;
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
					frontmatter[propertyName] = newValue;

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
