import { ChatOpenAI, AzureChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/community/chat_models/ollama";
import { OllamaFunctions } from "@langchain/community/experimental/chat_models/ollama_functions";
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
import { messagesWithFnCallPrompts } from "src/fn_calling";

const stringParser = new StringOutputParser();

export type SupportedProviders = "openai" | "ollama" | "gemini" | "anthropic" | "groq" | "azure_openai";

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

	azureOpenAIApiDeploymentName?: string,
	azureOpenAIApiInstanceName?: string,
	azureOpenAIApiVersion?: string,
};

type ConstructorArgs = {
	provider: SupportedProviders;
	baseConfig: GenericModelConfig;
	getDefaultConfigByProvider: GetDefaultsByProvider;
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
	baseURL: undefined,
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

export type GetDefaultsByProvider = (provider: SupportedProviders) => GenericModelConfig;

export type LangchainMessages = ReturnType<typeof LLMProvider.convertMessages>;

const SUPPORTED_FN_PROVIDERS = ["openai", "ollama", "azure_openai"];

const removeUndefinedKeys = <T extends Record<string, unknown>>(obj: T): T => {
	Object.keys(obj).forEach((key: keyof T) => obj[key] === undefined && delete obj[key]);
	return obj;
}

export class LLMProvider {
	baseConfig: GenericModelConfig;
	provider: SupportedProviders;
	getDefaultConfigByProvider: GetDefaultsByProvider;
	initialized = false;

	constructor(initArgs: ConstructorArgs) {
		this.init(initArgs);
		this.initialized = true;
	}

	init = (initArgs: ConstructorArgs) => {
		this.provider = initArgs.provider;
		this.baseConfig = initArgs.baseConfig;
		this.getDefaultConfigByProvider = initArgs.getDefaultConfigByProvider;
	};

	static getCompletionResponseUsage = (...args: unknown[]) => ({
		prompt_tokens: 0,
		completion_tokens: 0,
		api_calls: 0,
		total_cost: 0,
	});

	getConfig = () => ({ ...this.baseConfig });

	getDefaultsByProvider = (provider: SupportedProviders) => {
		const defaults = this.getDefaultConfigByProvider(provider);

		removeUndefinedKeys(defaults);

		return defaults;
	}

	getSampleConfig() {
		return makeSampleConfig();
	}

	getMergedConfig = (args?: Partial<{
		configOverrides: GenericModelConfig;
		provider: SupportedProviders;
	}>) => {
		let { configOverrides = {}, provider } = args || {};
		if (!provider) provider = this.provider;
		configOverrides = { ...this.getDefaultsByProvider(provider), ...removeUndefinedKeys(configOverrides), }
		return { ...this.baseConfig, ...configOverrides, provider };

	}

	getChatClient = (
		args?: Partial<{
			configOverrides: GenericModelConfig;
			provider: SupportedProviders;
			hasFunctionCall: boolean;
		}>
	): BaseChatModel => {
		const config = this.getMergedConfig(args);
		const provider = config.provider;
		const [urlString, queryString] = config.baseURL?.split("?") || [undefined, undefined];
		const url = urlString || undefined;
		const query = queryString ? Object.fromEntries(new URLSearchParams(queryString).entries()) : undefined
		switch (provider) {
			case "openai":
				return new ChatOpenAI({
					apiKey: config.apiKey,
					model: config.model,
					temperature: config.temperature,
					configuration: {
						baseURL: url,
						defaultQuery: query
					}
				});
			case "azure_openai":
				return new AzureChatOpenAI({
					temperature: config.temperature,
					model: config.model,
					apiKey: config.apiKey,
					azureOpenAIApiKey: config.apiKey,
					azureOpenAIApiDeploymentName: config.azureOpenAIApiDeploymentName,
					azureOpenAIApiInstanceName: config.azureOpenAIApiInstanceName,
					azureOpenAIApiVersion: config.azureOpenAIApiVersion,
					azureOpenAIBasePath: url,
					maxRetries: 3,
					configuration: {
						baseURL: url,
						defaultQuery: query,
					}
				});
			case "ollama":
				if (args?.hasFunctionCall) {
					return new OllamaFunctions({
						baseUrl: config.baseURL,
						model: config.model,
						temperature: config.temperature,
					});
				}

				return new ChatOllama({
					baseUrl: config.baseURL,
					model: config.model,
					temperature: config.temperature,
				});
			case "gemini":
				return new ChatGoogleGenerativeAI({
					maxRetries: 3,
					model: config.model,
					apiKey: config.apiKey,
					temperature: config.temperature,
				});
			case "anthropic":
				return new ChatAnthropic({
					apiKey: config.apiKey,
					model: config.model,
					temperature: config.temperature,
					maxRetries: 3,
				});
			case "groq":
				return new ChatGroq({
					apiKey: config.apiKey,
					model: config.model,
					temperature: config.temperature,
					maxRetries: 3,
				});
			default:
				throw new Error("Unsupported provider");
		}
	};

	static convertMessages = (
		messages: ChatCompletionMessageParam[] | GenericCompletionResponse[]
	) => {
		return messages.map((m) => {
			if ("function_call" in m) {
				return new AIMessage({
					// name: m.function_call?.name ?? "",
					content: m.function_call?.arguments ?? "",
				})
			}

			return m.role === "user"
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
		}
		);
	}

	getCompletion = async ({
		messages,
		...configOverrides
	}: GenericCompletionParams): Promise<GenericCompletionResponse> => {
		const hasFunctionCall = !!configOverrides.functions && !!configOverrides.function_call;
		const client = this.getChatClient({
			configOverrides,
			// @ts-expect-error
			provider: configOverrides?.provider ?? undefined,
			hasFunctionCall,
		});

		const convertedMessages = LLMProvider.convertMessages(messages);

		if (configOverrides.functions && configOverrides.function_call) {
			return await this.fn_call({
				provider: configOverrides.provider as SupportedProviders || this.provider,
				convertedMessages,
				client,
				functions: configOverrides.functions,
				function_call: configOverrides.function_call,
			});
		} else {
			const content = await client
				.pipe(stringParser)
				.invoke(convertedMessages);

			return {
				role: "assistant", // optional when functions included
				content,
			};
		}
	};

	private fn_call = async ({
		provider,
		convertedMessages,
		client,
		functions,
		function_call,
	}:
		{
			provider: SupportedProviders,
			convertedMessages: LangchainMessages,
			client: BaseChatModel,
			functions: GenericFunctionCall[],
			function_call: { name: string }
		}
	) => {
		if (SUPPORTED_FN_PROVIDERS.includes(provider)) {
			const response = await client.invoke(
				convertedMessages,
				{
					// @ts-expect-error
					function_call,
					functions: functions,
				});

			return {
				role: "assistant",
				content: "",
				function_call: response.additional_kwargs.tool_calls ? response.additional_kwargs.tool_calls[0]?.function : response.additional_kwargs.function_call
			}
		} else {
			const fn = functions[0];
			const fnMessages = messagesWithFnCallPrompts({
				convertedMessages,
				fn,
				function_call,
			})
			const response = await client.pipe(stringParser).invoke(fnMessages);

			// parse response string and extract the first json object wrapped in {}
			const json = response;

			// TODO add a while loop to keep calling this until json parses as valid json

			return {
				role: "assistant",
				content: "",
				function_call: {
					arguments: json,
					name: function_call.name
				}
			}
		}
	}

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
