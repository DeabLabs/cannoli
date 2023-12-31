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
import { z } from "zod";

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

const OllamaConfigSchema = z.object({
	model: z.string(),
	role: z.enum(["system", "user", "assistant"]).optional(),
	options: z
		.object({
			microstat: z.number().optional().nullable(),
			microstat_eta: z.number().optional().nullable(),
			microstat_tau: z.number().optional().nullable(),
			num_ctx: z.number().optional().nullable(),
			num_gqa: z.number().optional().nullable(),
			num_gpu: z.number().optional().nullable(),
			num_thread: z.number().optional().nullable(),
			repeat_last_n: z.number().optional().nullable(),
			repeat_penalty: z.number().optional().nullable(),
			temperature: z.number().optional().nullable(),
			seed: z.number().optional().nullable(),
			stop: z.union([
				z.array(z.string()),
				z.string().optional().nullable(),
			]),
			tfs_z: z.number().optional().nullable(),
			num_predict: z.number().optional().nullable(),
			top_k: z.number().optional().nullable(),
			top_p: z.number().optional().nullable(),
		})
		.optional(),
});

export type OllamaConfig = z.infer<typeof OllamaConfigSchema>;

const FlattenedOllamaConfigSchema = OllamaConfigSchema.transform(
	({ options, ...s }) => ({
		...s,
		...options,
	})
);

export type FlattenedOllamaConfig = z.infer<typeof FlattenedOllamaConfigSchema>;

export const OpenAIConfigSchema = z.object({
	model: z.string(),
	role: z.enum(["system", "user", "assistant"]).optional(),
	frequency_penalty: z.number().optional().nullable(),
	presence_penalty: z.number().optional().nullable(),
	stop: z
		.union([z.array(z.string()), z.string(), z.null(), z.undefined()])
		.optional()
		.nullable(),
	function_call: z
		.union([
			z.literal("none"),
			z.literal("auto"),
			z.object({ name: z.string() }),
		])
		.optional(),
	functions: z
		.array(
			z.object({
				name: z.string(),
				description: z.string().optional(),
				parameters: z.record(z.unknown()).optional(),
			})
		)
		.optional(),
	temperature: z.number().optional().nullable(),
	top_p: z.number().optional().nullable(),
});

export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;

// a combination of both configs that can be transformed into either
const LLMConfigSchema = z.intersection(
	OpenAIConfigSchema,
	FlattenedOllamaConfigSchema
);

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

const transformLLMConfigIntoOpenAIConfig = (llmConfig: LLMConfig) => {
	return OpenAIConfigSchema.parse(llmConfig);
};

const transformLLMConfigIntoOllamaConfig = (llmConfig: LLMConfig) => {
	return OllamaConfigSchema.parse(
		LLMConfigSchema.transform((c) => {
			// we need to move the options back into an options object
			return {
				...c,
				options: {
					microstat: c.microstat,
					microstat_eta: c.microstat_eta,
					microstat_tau: c.microstat_tau,
					num_ctx: c.num_ctx,
					num_gqa: c.num_gqa,
					num_gpu: c.num_gpu,
					num_thread: c.num_thread,
					repeat_last_n: c.repeat_last_n,
					repeat_penalty: c.repeat_penalty,
					temperature: c.temperature,
					seed: c.seed,
					stop: c.stop,
					tfs_z: c.tfs_z,
					num_predict: c.num_predict,
					top_k: c.top_k,
					top_p: c.top_p,
				},
			};
		}).parse(llmConfig)
	);
};

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

export type MixedProviderCompletionParams = LLMConfig & {
	stream?: boolean | null;
	messages: OpenAiChatMessages | OllamaChatRequest["messages"];
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
export const makeSampleOllamaConfig = (): FlattenedOllamaConfig => ({
	model: "",
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
});

export class Llm {
	provider: LLMProvider;
	openaiConfig?: OpenAIConfig;
	ollamaConfig?: OllamaConfig;
	ollamaBaseURL?: string;
	openai: OpenAI | null;
	initialized = false;

	constructor({
		provider,
		ollamaConfig,
		openaiConfig,
	}: {
		provider: LLMProvider;
		ollamaConfig?: OllamaConfig & { baseURL: string };
		openaiConfig?: OpenAIConfig & { apiKey: string };
	}) {
		this.provider = provider;
		switch (provider) {
			case "openai": {
				if (!openaiConfig) {
					throw new Error("OpenAI config is required");
				}
				const { apiKey, ...restConfig } = openaiConfig;
				this.openaiConfig = restConfig;
				this.openai = new OpenAI({
					apiKey,
					dangerouslyAllowBrowser: true,
				});
				this.initialized = true;
				break;
			}
			case "ollama": {
				if (!ollamaConfig) {
					throw new Error("Ollama config is required");
				}
				const { baseURL, ...restConfig } = ollamaConfig;
				this.ollamaBaseURL = baseURL;
				this.ollamaConfig = restConfig;
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
		...llmConfig
	}: MixedProviderCompletionParams): Promise<
		ChatCompletion | OllamaChatResponse
	> {
		if (this.provider === "openai") {
			if (!this.openai) {
				throw new Error("OpenAI is not initialized");
			}

			const openaiConfig = transformLLMConfigIntoOpenAIConfig(llmConfig);

			console.log(openaiConfig);
			return (await this.openai.chat.completions.create(
				{
					messages,
					...openaiConfig,
				},
				{ stream: false }
			)) as ChatCompletion;
		} else if (this.provider === "ollama") {
			invariant(this.ollamaBaseURL, "Ollama base URL is required");
			const ollamaConfig = transformLLMConfigIntoOllamaConfig(llmConfig);
			const rawBody: OllamaChatRequest = {
				messages: messages.filter(
					(m) => m.role !== "function"
				) as OllamaChatRequest["messages"],
				...ollamaConfig,
				stream: false,
			};
			console.log(rawBody);
			const options: RequestUrlParam = {
				url: `${this.ollamaBaseURL}/api/chat`,
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
		...llmConfig
	}: MixedProviderCompletionParams): Promise<
		| APIPromise<Stream<ChatCompletionChunk>>
		| ReadableStream<Uint8Array>
		| Error
	> {
		if (this.provider === "openai") {
			if (!this.openai) {
				throw new Error("OpenAI is not initialized");
			}

			const openaiConfig = transformLLMConfigIntoOpenAIConfig(llmConfig);

			return this.openai.chat.completions.create({
				messages,
				...openaiConfig,
				stream: true,
			});
		} else if (this.provider === "ollama") {
			invariant(this.ollamaBaseURL, "Ollama baseUrl is required");
			const ollamaConfig = transformLLMConfigIntoOllamaConfig(llmConfig);
			const rawBody: OllamaChatRequest = {
				messages: messages.filter(
					(m) => m.role !== "function"
				) as OllamaChatRequest["messages"],
				...ollamaConfig,
				stream: true,
			};
			const options: RequestUrlParam = {
				url: `${this.ollamaBaseURL}/api/chat`,
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
