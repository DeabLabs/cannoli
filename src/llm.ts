import { RequestUrlParam, requestUrl } from "obsidian";
import OpenAI from "openai";
import { APIPromise } from "openai/core";
import { CompletionUsage } from "openai/resources";
import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParams,
	ChatCompletionMessage,
} from "openai/resources/chat";
import { Stream } from "openai/streaming";
import invariant from "tiny-invariant";

// https://bugs.chromium.org/p/chromium/issues/detail?id=929585#c10
// @ts-expect-error polyfill to make streams iterable
ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
	const reader = this.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return;
			yield value;
		}
	} finally {
		reader.releaseLock();
	}
};

export type OpenAiChatMessage = ChatCompletionCreateParams["messages"][number];
export type OpenAiChatMessages = ChatCompletionCreateParams["messages"];

export type LLMProvider = "openai" | "ollama";

export type OllamaConfig = {
	baseURL: string;
	model: string;
	stream?: boolean;
	role?: "system" | "user" | "assistant";
	// options
	options?: {
		microstat?: number;
		microstat_eta?: number;
		microstat_tau?: number;
		num_ctx?: number;
		num_gqa?: number;
		num_gpu?: number;
		num_thread?: number;
		repeat_last_n?: number;
		repeat_penalty?: number;
		temperature?: number;
		seed?: number;
		stop?: string;
		tfs_z?: number;
		num_predict?: number;
		top_k?: number;
		top_p?: number;
	};
};

export type OpenAIConfig = {
	apiKey: string;
	model: string;
	stream?: boolean;
	// options
	role?: "system" | "user" | "assistant";
	frequency_penalty?: number | undefined;
	presence_penalty?: number | undefined;
	stop?: string[] | undefined;
	function_call?: string | undefined;
	functions?: ChatCompletionCreateParams.Function[] | undefined;
	temperature?: number | undefined;
	top_p?: number | undefined;
};

export type LLMConfig = OpenAIConfig & OllamaConfig;

export type OllamaChatRequest = {
	model: string;
	messages: {
		role: "system" | "user" | "assistant";
		content: string;
		images?: string[];
	}[];
	options?: OllamaConfig["options"];
	stream?: boolean;
};

export type OllamaChatResponse = {
	model: string;
	created_at: string;
	message: {
		role: "system" | "user" | "assistant";
		content: string;
		images?: string[] | null;
	};
	done: true;
	total_duration: number;
	load_duration: number;
	prompt_eval_count: number;
	prompt_eval_duration: number;
	eval_count: number;
	eval_duration: number;
};

export type OllamaStreamingChatMessageResponse = {
	model: string;
	created_at: string;
	message: {
		role: "system" | "user" | "assistant";
		content: string;
		images: string[] | null;
	};
	done: false;
};

export type OllamaStreamingChatFinalResponse = {
	model: string;
	created_at: string;
	done: true;
	total_duration: number;
	load_duration: number;
	prompt_eval_count: number;
	prompt_eval_duration: number;
	eval_count: number;
	eval_duration: number;
};

export type MixedProviderCompletionParams = ChatCompletionCreateParams & {
	options?: OllamaConfig["options"];
};

export type MixedProviderCompletionResponse =
	| OllamaChatResponse
	| ChatCompletion;

export type MixedProviderStreamingCompletionResponse =
	| OllamaStreamingChatMessageResponse
	| OllamaStreamingChatFinalResponse
	| ChatCompletionChunk;

// Sample object to validate keys against
export const makeSampleOpenAIConfig = (): OpenAIConfig => ({
	apiKey: "",
	model: "",
	frequency_penalty: undefined,
	presence_penalty: undefined,
	stop: undefined,
	function_call: undefined,
	functions: undefined,
	temperature: undefined,
	top_p: undefined,
	role: "user" || "assistant" || "system",
});
export const makeSampleOllamaConfig = (): OllamaConfig => ({
	baseURL: "",
	model: "",
	options: {
		microstat: undefined,
		microstat_eta: undefined,
		microstat_tau: undefined,
		num_ctx: undefined,
		num_gqa: undefined,
		num_gpu: undefined,
		num_thread: undefined,
		repeat_last_n: undefined,
		repeat_penalty: undefined,
		temperature: undefined,
		seed: undefined,
		stop: undefined,
		tfs_z: undefined,
		num_predict: undefined,
		top_k: undefined,
		top_p: undefined,
	},
});

export class Llm {
	provider: LLMProvider;
	openaiConfig?: OpenAIConfig;
	ollamaConfig?: OllamaConfig;
	openai: OpenAI | null;
	initialized = false;

	constructor({
		provider,
		ollamaConfig,
		openaiConfig,
	}: {
		provider: LLMProvider;
		ollamaConfig?: OllamaConfig;
		openaiConfig?: OpenAIConfig;
	}) {
		this.provider = provider;
		switch (provider) {
			case "openai": {
				if (!openaiConfig) {
					throw new Error("OpenAI config is required");
				}
				this.openaiConfig = openaiConfig;
				this.openai = new OpenAI({
					apiKey: openaiConfig.apiKey,
					dangerouslyAllowBrowser: true,
				});
				this.initialized = true;
				break;
			}
			case "ollama": {
				if (!ollamaConfig) {
					throw new Error("Ollama config is required");
				}
				this.ollamaConfig = ollamaConfig;
				this.initialized = true;
				break;
			}
			default: {
				throw new Error("Invalid LLM provider");
			}
		}
	}

	getConfig() {
		if (this.provider === "openai") {
			return this.openaiConfig;
		} else if (this.provider === "ollama") {
			return this.ollamaConfig;
		} else {
			throw new Error("Invalid LLM provider");
		}
	}

	getSampleConfig() {
		if (this.provider === "openai") {
			return makeSampleOpenAIConfig();
		} else if (this.provider === "ollama") {
			return makeSampleOllamaConfig();
		} else {
			throw new Error("Invalid LLM provider");
		}
	}

	async getCompletion({
		messages,
		model,
		options: ollamaOptions,
		...probablyOpenaiConfig
	}: MixedProviderCompletionParams): Promise<
		ChatCompletion | OllamaChatResponse
	> {
		if (this.provider === "openai") {
			if (!this.openai) {
				throw new Error("OpenAI is not initialized");
			}

			const castModel = model as ChatCompletionCreateParams["model"];

			const config = {
				...probablyOpenaiConfig,
			};

			// @ts-expect-error
			delete config.apiKey;

			return (await this.openai.chat.completions.create(
				{
					messages,
					model: castModel,
					...config,
				},
				{ stream: false }
			)) as ChatCompletion;
		} else if (this.provider === "ollama") {
			invariant(this.ollamaConfig, "Ollama config is required");
			const rawBody: OllamaChatRequest = {
				model: this.ollamaConfig.model,
				messages: messages.filter(
					(m) => m.role !== "function"
				) as OllamaChatRequest["messages"],
				options: ollamaOptions,
				stream: false,
			};
			const options: RequestUrlParam = {
				url: `${this.ollamaConfig.baseURL}/api/chat`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(rawBody),
			};

			const response = await requestUrl(options);

			return response.json as OllamaChatResponse;
		} else {
			throw new Error("Invalid LLM provider");
		}
	}

	async getCompletionStream({
		messages,
		options: ollamaOptions,
		model,
		...probablyOpenaiConfig
	}: MixedProviderCompletionParams): Promise<
		| APIPromise<Stream<ChatCompletionChunk>>
		| ReadableStream<Uint8Array>
		| Error
	> {
		if (this.provider === "openai") {
			if (!this.openai) {
				throw new Error("OpenAI is not initialized");
			}

			const castModel = model as ChatCompletionCreateParams["model"];

			const config = {
				...probablyOpenaiConfig,
			};

			// @ts-expect-error
			delete config.apiKey;

			return this.openai.chat.completions.create(
				{
					messages,
					model: castModel,
					...config,
				},
				{ stream: true }
			) as APIPromise<Stream<ChatCompletionChunk>>;
		} else if (this.provider === "ollama") {
			invariant(this.ollamaConfig, "Ollama config is required");
			const rawBody: OllamaChatRequest = {
				model: model,
				messages: messages.filter(
					(m) => m.role !== "function"
				) as OllamaChatRequest["messages"],
				options: ollamaOptions,
				stream: true,
			};
			const options: RequestUrlParam = {
				url: `${this.ollamaConfig.baseURL}/api/chat`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(rawBody),
			};

			const response = await fetch(options.url, options);

			return response.body as ReadableStream<Uint8Array>;
		}

		return new Error("Provider does not support streaming");
	}

	static getFirstCompletionMessage(
		completionResponse: MixedProviderCompletionResponse
	): ChatCompletionMessage | OllamaChatResponse["message"] {
		if ("choices" in completionResponse) {
			return completionResponse.choices[0].message;
		} else if ("message" in completionResponse) {
			return completionResponse.message;
		} else {
			throw new Error("Invalid LLM provider");
		}
	}

	static getFirstStreamingCompletionMessageDelta(
		streamingCompletionChunk: MixedProviderStreamingCompletionResponse
	): string | null | undefined {
		if ("choices" in streamingCompletionChunk) {
			return streamingCompletionChunk.choices[0].delta.content;
		} else if ("message" in streamingCompletionChunk) {
			return streamingCompletionChunk.message.content;
		} else {
			throw new Error("Invalid LLM provider");
		}
	}

	getPart(rawPart: unknown) {
		if (this.provider === "openai") {
			return rawPart as ChatCompletionChunk;
		}

		// decode raw part from bytes to json
		// it is a uint8array
		const decoder = new TextDecoder("utf-8");
		const decodedPart = decoder.decode(rawPart as Uint8Array);

		return JSON.parse(decodedPart) as OllamaStreamingChatMessageResponse;
	}

	static getStreamingCompletionFinished(
		streamingCompletionResponse: MixedProviderStreamingCompletionResponse
	): boolean {
		if ("done" in streamingCompletionResponse) {
			return streamingCompletionResponse.done;
		} else if ("choices" in streamingCompletionResponse) {
			return !!streamingCompletionResponse.choices[0].finish_reason;
		}

		return true;
	}

	static getCompletionResponseUsage(
		completionResponse: MixedProviderCompletionResponse
	): CompletionUsage | undefined {
		if ("usage" in completionResponse) {
			return completionResponse.usage;
		}

		return undefined;
	}
}
