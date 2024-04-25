import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/community/chat_models/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGroq } from "@langchain/groq";
import { ChatAnthropic } from "@langchain/anthropic";
import {
	ChatCompletionAssistantMessageParam,
	ChatCompletionMessageParam,
} from "openai/resources";
import { AIMessage, ChatMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

import { StringOutputParser } from "@langchain/core/output_parsers";

const stringParser = new StringOutputParser();

export type SupportedProviders = "openai" | "ollama" | "gemini" | "anthropic" | "groq";

export type GenericFunctionCall = {
	name: string;
	description?: string;
	parameters: Record<string, unknown>;
};

export type GenericModelConfig = {
	provider?: string;
	apiKey?: string;
	baseURL?: string;

	model?: string;

	function_call?: { name: string };
	functions?: GenericFunctionCall[];

	temperature?: number;
	top_p?: number;
	top_k?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	stop?: string;
	role?: string;
	microstat?: boolean;
	microstat_eta?: number;
	microstat_tau?: number;
	num_ctx?: number;
	num_gqa?: number;
	num_gpu?: number;
	num_thread?: number;
	repeat_last_n?: number;
	repeat_penalty?: number;
	seed?: number;
	tfs_z?: number;
	num_predict?: number;
};

type ConstructorArgs = {
	provider: SupportedProviders;
	baseConfig: GenericModelConfig;
};

export type GenericCompletionParams = {
	messages: GenericCompletionResponse[];
} & GenericModelConfig;

export type GenericCompletionResponse = {
	role?: string;
	content: string;
	function_call?: ChatCompletionAssistantMessageParam.FunctionCall;
};

// @deprecated
export const makeSampleConfig = (): GenericModelConfig => ({
	apiKey: undefined,
	model: "",
	frequency_penalty: undefined,
	presence_penalty: undefined,
	stop: undefined,
	function_call: undefined,
	functions: undefined,
	temperature: undefined,
	top_p: undefined,
	role: "user" || "assistant" || "system",
	provider: undefined,
	microstat: undefined,
	microstat_eta: undefined,
	microstat_tau: undefined,
	num_ctx: undefined,
	num_gqa: undefined,
	num_gpu: undefined,
	num_thread: undefined,
	repeat_last_n: undefined,
	repeat_penalty: undefined,
	seed: undefined,
	tfs_z: undefined,
	num_predict: undefined,
	top_k: undefined,
});

export class LLMProvider {
	baseConfig: GenericModelConfig;
	provider: SupportedProviders;
	initialized = false;

	constructor(initArgs: ConstructorArgs) {
		this.init(initArgs);
		this.initialized = true;
	}

	init = (initArgs: ConstructorArgs) => {
		this.provider = initArgs.provider;
		this.baseConfig = initArgs.baseConfig;
	};

	static getCompletionResponseUsage = (...args: unknown[]) => ({
		prompt_tokens: 0,
		completion_tokens: 0,
		api_calls: 0,
		total_cost: 0,
	});

	getConfig = () => ({ ...this.baseConfig });

	getSampleConfig() {
		return makeSampleConfig();
	}
	getChatClient = (
		args?: Partial<{
			configOverrides: GenericModelConfig;
			provider: SupportedProviders;
		}>
	): BaseChatModel => {
		const { configOverrides = {}, provider = this.provider } = args || {};
		const config = { ...this.baseConfig, ...configOverrides };
		switch (provider) {
			case "openai":
				return new ChatOpenAI({
					apiKey: config.apiKey,
					azureOpenAIBasePath: config.baseURL,
					model: config.model,
				});
			case "ollama":
				return new ChatOllama({
					baseUrl: config.baseURL,
					model: config.model,
				});
			case "gemini":
				return new ChatGoogleGenerativeAI({
					model: config.model,
					apiKey: config.apiKey,
				});
			case "anthropic":
				return new ChatAnthropic({
					apiKey: config.apiKey,
					model: config.model,
				});
			case "groq":
				return new ChatGroq({
					apiKey: config.apiKey,
					model: config.model,
				});
			default:
				throw new Error("Unsupported provider");
		}
	};

	static convertMessages = (
		messages: ChatCompletionMessageParam[] | GenericCompletionResponse[]
	) =>
		messages.map((m) =>
			m.role === "user"
				? new HumanMessage({ content: m.content })
				: m.role === "assistant"
					? new AIMessage({ content: m.content ?? "" })
					: m.role === "system" ? new SystemMessage({
						content: m.content ?? "",
					}) : new ChatMessage(
						!m.content
							? ""
							: Array.isArray(m.content)
								? ""
								: typeof m.content === "string"
									? m.content
									: "",
						"user"
					)
		);

	fn_call = () => { };

	getCompletion = async ({
		messages,
		...configOverrides
	}: GenericCompletionParams): Promise<GenericCompletionResponse> => {
		const client = this.getChatClient({
			configOverrides,
			// @ts-expect-error
			provider: configOverrides?.provider ?? undefined,
		});

		const convertedMessages = LLMProvider.convertMessages(messages);
		console.log(convertedMessages)
		const content = await client
			.pipe(stringParser)
			.invoke(convertedMessages);

		return {
			role: "assistant", // optional when functions included
			content,
		};
	};

	getCompletionStream = async ({
		messages,
		...configOverrides
	}: GenericCompletionParams) => {
		const client = this.getChatClient({
			configOverrides,
			// @ts-expect-error
			provider: configOverrides?.provider ?? undefined,
		});

		const convertedMessages = LLMProvider.convertMessages(messages);
		const stream = await client
			.pipe(stringParser)
			.stream(convertedMessages);

		return stream;
	};
}
