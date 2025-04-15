import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  BaseChatModel,
  BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { ChatGroq } from "@langchain/groq";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatCompletionMessageParam } from "openai/resources/index";
import {
  AIMessage,
  ChatMessage,
  HumanMessage,
  MessageContentImageUrl,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import { StringOutputParser } from "@langchain/core/output_parsers";
import { choiceTool, formTool, noteSelectTool } from "./fn_calling";

const stringParser = new StringOutputParser();

export type SupportedProviders =
  | "openai"
  | "ollama"
  | "gemini"
  | "anthropic"
  | "groq"
  | "azure_openai";

import { z } from "zod";
import invariant from "tiny-invariant";
import { TracingConfig } from "src/run";
import { Runnable } from "@langchain/core/runnables";

import { loadMcpTools } from "./langchain/mcpTools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { makeCannoliServerClient } from "./serverClient";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StructuredToolInterface } from "@langchain/core/tools";

export const GenericFunctionCallSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()),
});

export type GenericFunctionCall = z.infer<typeof GenericFunctionCallSchema>;

export const GenericModelConfigSchema = z.object({
  provider: z.string().optional(),
  enableVision: z.coerce
    .string()
    .transform((val) => val === "true")
    .optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  model: z.string().optional(),
  function_call: z.object({ name: z.string() }).optional(),
  functions: z.array(GenericFunctionCallSchema).optional(),
  temperature: z.coerce.number().optional(),
  top_p: z.coerce.number().optional(),
  top_k: z.coerce.number().optional(),
  frequency_penalty: z.coerce.number().optional(),
  presence_penalty: z.coerce.number().optional(),
  stop: z.string().optional(),
  role: z.string().optional(),
  microstat: z.boolean().optional(),
  microstat_eta: z.coerce.number().optional(),
  microstat_tau: z.coerce.number().optional(),
  max_tokens: z.coerce.number().optional(),
  user: z.string().optional(),
  num_ctx: z.coerce.number().optional(),
  num_gqa: z.coerce.number().optional(),
  num_gpu: z.coerce.number().optional(),
  num_thread: z.coerce.number().optional(),
  repeat_last_n: z.coerce.number().optional(),
  repeat_penalty: z.coerce.number().optional(),
  seed: z.coerce.number().optional(),
  tfs_z: z.coerce.number().optional(),
  num_predict: z.coerce.number().optional(),
  azureOpenAIApiDeploymentName: z.string().optional(),
  azureOpenAIApiInstanceName: z.string().optional(),
  azureOpenAIApiVersion: z.string().optional(),
});

export type GenericModelConfig = z.infer<typeof GenericModelConfigSchema>;

export type LLMConfig = Omit<GenericModelConfig, "provider"> & {
  provider: SupportedProviders;
};

type ConstructorArgs = {
  configs: LLMConfig[];
  tracingConfig?: TracingConfig | null;
  valtownApiKey?: string;
  runId?: string;
  runName?: string;
  runDateEpochMs?: number;
};

export type GenericCompletionParams = {
  messages: GenericCompletionResponse[];
  imageReferences?: ImageReference[];
} & GenericModelConfig;

export type GenericCompletionResponse = {
  role?: string;
  content: string;
  function_call?: {
    name: string;
    args: Record<string, unknown> | Array<unknown> | string;
  };
  function_call_id?: string;
};

export type GetDefaultsByProvider = (
  provider: SupportedProviders,
) => GenericModelConfig | undefined;

export type LangchainMessages = ReturnType<typeof LLMProvider.convertMessages>;

export type ImageReference = {
  url: string;
  messageIndex: number;
};

const removeUndefinedKeys = <T extends Record<string, unknown>>(obj: T): T => {
  Object.keys(obj).forEach(
    (key: keyof T) => obj[key] === undefined && delete obj[key],
  );
  return obj;
};

export class LLMProvider {
  baseConfig: GenericModelConfig = {};
  provider: SupportedProviders = "openai";
  getDefaultConfigByProvider?: GetDefaultsByProvider;
  initialized = false;
  valtownApiKey?: string;
  tracingConfig?: TracingConfig | null;
  runId?: string;
  runName?: string;
  runDateEpochMs?: number;
  metadata?: {
    runId?: string;
    runName?: string;
    runDateEpochMs?: number;
  };

  constructor(initArgs: ConstructorArgs) {
    this.init(initArgs);
    this.initialized = true;
  }

  init = (initArgs: ConstructorArgs) => {
    this.provider = initArgs.configs[0].provider as SupportedProviders;
    this.baseConfig = initArgs.configs[0];
    this.valtownApiKey = initArgs.valtownApiKey;
    this.tracingConfig = initArgs.tracingConfig;
    this.runId = initArgs.runId;
    this.runDateEpochMs = initArgs.runDateEpochMs;
    this.runName = initArgs.runName;
    this.getDefaultConfigByProvider = (provider: SupportedProviders) => {
      return initArgs.configs.find((config) => config.provider === provider);
    };
    this.metadata = {
      runId: this.runId,
      runName: this.runName,
      runDateEpochMs: this.runDateEpochMs,
    };
  };

  // static getCompletionResponseUsage = (...args: unknown[]) => ({
  // 	prompt_tokens: 0,
  // 	completion_tokens: 0,
  // 	api_calls: 0,
  // 	total_cost: 0,
  // });

  getConfig = () => ({ ...this.baseConfig });

  getDefaultsByProvider = (provider: SupportedProviders) => {
    const defaults = this.getDefaultConfigByProvider?.(provider) || {};

    removeUndefinedKeys(defaults);

    return defaults;
  };

  getMergedConfig = (
    args?: Partial<{
      configOverrides: GenericModelConfig;
      provider: SupportedProviders;
    }>,
  ) => {
    let { configOverrides = {}, provider } = args || {};
    if (!provider) provider = this.provider;

    const providerConfig = this.getDefaultsByProvider(provider);

    invariant(
      providerConfig.provider,
      `No provider config found for provider ${provider}`,
    );

    configOverrides = {
      ...providerConfig,
      ...removeUndefinedKeys(configOverrides),
    };
    return { ...this.baseConfig, ...configOverrides, provider };
  };

  getChatClient = (
    args?: Partial<{
      configOverrides: GenericModelConfig;
      provider: SupportedProviders;
      hasFunctionCall: boolean;
    }>,
  ): BaseChatModel => {
    const config = this.getMergedConfig(args);
    const provider = config.provider;
    const [urlString, queryString] = config.baseURL?.split("?") || [
      undefined,
      undefined,
    ];
    const url = urlString || undefined;
    const query = queryString
      ? Object.fromEntries(new URLSearchParams(queryString).entries())
      : undefined;

    let client: BaseChatModel;
    invariant(config.model, "Model is required");
    switch (provider) {
      case "openai": {
        client = new ChatOpenAI({
          apiKey: config.apiKey,
          model: config.model,
          temperature: config.temperature,
          topP: config.top_p,
          frequencyPenalty: config.frequency_penalty,
          presencePenalty: config.presence_penalty,
          stop: config.stop?.split(","),
          maxTokens: config.max_tokens,
          user: config.user,
          // beta openai feature
          // @ts-expect-error
          seed: config.seed,
          maxRetries: 3,
          configuration: {
            baseURL: url,
            defaultQuery: query,
          },
        });
        break;
      }
      case "azure_openai": {
        client = new AzureChatOpenAI({
          temperature: config.temperature,
          model: config.model,
          apiKey: config.apiKey,
          azureOpenAIApiKey: config.apiKey,
          azureOpenAIApiDeploymentName: config.azureOpenAIApiDeploymentName,
          azureOpenAIApiInstanceName: config.azureOpenAIApiInstanceName,
          azureOpenAIApiVersion: config.azureOpenAIApiVersion,
          azureOpenAIBasePath: url,
          user: config.user,
          maxTokens: config.max_tokens,
          // beta openai feature
          // @ts-expect-error
          seed: config.seed,
          topP: config.top_p,
          frequencyPenalty: config.frequency_penalty,
          presencePenalty: config.presence_penalty,
          stop: config.stop?.split(","),
          maxRetries: 3,
          configuration: {
            baseURL: url,
            defaultQuery: query,
          },
        });
        break;
      }
      case "ollama": {
        client = new ChatOllama({
          baseUrl: url,
          model: config.model,
          temperature: config.temperature,
          topP: config.top_p,
          frequencyPenalty: config.frequency_penalty,
          presencePenalty: config.presence_penalty,
          stop: config.stop?.split(","),
        });
        break;
      }
      case "gemini": {
        client = new ChatGoogleGenerativeAI({
          maxRetries: 3,
          model: config.model,
          apiKey: config.apiKey,
          temperature: config.temperature,
          maxOutputTokens: config.max_tokens,
          topP: config.top_p,
          stopSequences: config.stop?.split(","),
        });
        break;
      }
      case "anthropic": {
        client = new ChatAnthropic({
          apiKey: config.apiKey,
          model: config.model,
          temperature: config.temperature,
          maxRetries: 0,
          anthropicApiUrl: url,
          maxTokens: config.max_tokens,
          topP: config.top_p,
          stopSequences: config.stop?.split(","),
          topK: config.top_k,
          clientOptions: {
            defaultHeaders: {
              "anthropic-dangerous-direct-browser-access": "true",
            },
          },
        });
        break;
      }
      case "groq": {
        client = new ChatGroq({
          apiKey: config.apiKey,
          model: config.model,
          temperature: config.temperature,
          stopSequences: config.stop?.split(","),
          maxRetries: 3,
        });
        break;
      }
      default:
        throw new Error("Unsupported provider");
    }

    return client;
  };

  static convertMessages = (
    messages: ChatCompletionMessageParam[] | GenericCompletionResponse[],
    imageReferences: ImageReference[] = [],
  ) => {
    return messages.map((m, i) => {
      if ("function_call" in m) {
        return new AIMessage({
          // name: m.function_call?.name ?? "",
          content: !m.function_call
            ? ""
            : "arguments" in m.function_call
              ? m.function_call.arguments
              : "args" in m.function_call
                ? JSON.stringify(m.function_call.args)
                : "",
          // @ts-expect-error
          tool_calls: m.function_call ? [m.function_call] : [],
        });
      }

      const relevantImages: MessageContentImageUrl[] = imageReferences
        .filter((img) => img.messageIndex === i)
        .map((img) => {
          return {
            type: "image_url",
            image_url: { url: img.url },
          };
        });

      return m.role === "user"
        ? new HumanMessage({
            content: relevantImages.length
              ? [{ type: "text", text: m.content }, ...relevantImages]
              : m.content,
          })
        : m.role === "assistant"
          ? new AIMessage({ content: m.content ?? "" })
          : m.role === "tool"
            ? new ToolMessage({
                // @ts-expect-error
                name: messages[i - 1]?.function_call?.name ?? "unknown",
                content: m.content ?? "",
                // @ts-expect-error
                tool_call_id: m?.function_call_id ?? "unknown",
              })
            : m.role === "system"
              ? new SystemMessage({
                  content: m.content ?? "",
                })
              : new ChatMessage(
                  !m.content
                    ? ""
                    : Array.isArray(m.content)
                      ? ""
                      : typeof m.content === "string"
                        ? m.content
                        : "",
                  "user",
                );
    });
  };

  getCompletion = async ({
    messages,
    imageReferences,
    ...configOverrides
  }: GenericCompletionParams): Promise<GenericCompletionResponse> => {
    const hasFunctionCall =
      !!configOverrides.functions && !!configOverrides.function_call;
    const client = this.getChatClient({
      configOverrides,
      // @ts-expect-error
      provider: configOverrides?.provider ?? undefined,
      hasFunctionCall,
    });

    const convertedMessages = LLMProvider.convertMessages(
      messages,
      imageReferences,
    );

    if (configOverrides.functions && configOverrides.function_call) {
      // @ts-expect-error
      return await this.fn_call({
        provider:
          (configOverrides.provider as SupportedProviders) || this.provider,
        convertedMessages,
        client,
        functions: configOverrides.functions,
        function_call: configOverrides.function_call,
      });
    } else {
      const content = await this.clientWithMetadata(client)
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
    client: _client,
    functions,
    function_call,
  }: {
    provider: SupportedProviders;
    convertedMessages: LangchainMessages;
    client: BaseChatModel;
    functions: GenericFunctionCall[];
    function_call: { name: string };
  }) => {
    const client =
      _client.bindTools?.(
        (functions
          ?.map((f) => {
            if (f.name === "choice") {
              return choiceTool(
                // @ts-expect-error
                f.parameters?.properties?.choice?.enum as [string, ...string[]],
              );
            }
            if (f.name === "note_select") {
              return noteSelectTool(
                // @ts-expect-error
                f.parameters?.properties?.note?.enum as [string, ...string[]],
              );
            }
            if (f.name === "form") {
              return formTool(Object.keys(f.parameters?.properties ?? []));
            }
            return null;
          })
          ?.filter(Boolean) ?? []) as BindToolsInput[],
        // ollama does not support tool choice, but it does support tools
        provider !== "ollama"
          ? {
              tool_choice: function_call.name,
            }
          : undefined,
      ) ?? _client;
    const response =
      await this.clientWithMetadata(client).invoke(convertedMessages);

    return {
      role: "assistant",
      content: "",
      function_call_id: response.tool_calls?.[0]?.id,
      function_call: response.tool_calls
        ? response.tool_calls[0]
        : functions.find((f) => f.name === function_call.name),
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
    const stream = await client.pipe(stringParser).stream(convertedMessages);

    return stream;
  };

  getGoalCompletion = async ({
    messages,
    ...configOverrides
  }: GenericCompletionParams) => {
    const client = this.getChatClient({
      configOverrides,
      // @ts-expect-error
      provider: configOverrides?.provider ?? undefined,
    });

    const cannoliClient = makeCannoliServerClient("http://localhost:3333");

    const serversResponse = await cannoliClient["mcp-servers"].sse.$get();

    const servers = await serversResponse.json();

    // For each server call loadMcpTools

    const disconnectCallbacks: (() => Promise<void>)[] = [];
    const mcpServers = await Promise.all(
      Object.entries(servers.servers).map(async ([name, server]) => {
        const transport = new SSEClientTransport(
          new URL(
            // @ts-expect-error
            server.url,
          ),
        );

        // @ts-expect-error
        console.log("connecting to server", name, server.url);

        const mcpClient = new Client({
          name: `cannoli`,
          version: "1.0.0",
        });

        await mcpClient.connect(transport);

        disconnectCallbacks.push(async () => {
          console.log("disconnecting from server", name);
          await mcpClient.close();
          await transport.close();
        });

        return (await loadMcpTools(
          name,
          mcpClient,
        )) as StructuredToolInterface[];
      }),
    );

    // Create the React agent
    const agent = createReactAgent({
      llm: client,
      tools: mcpServers.flat(),
    });

    // Run the agent
    try {
      const mathResponse = await agent.invoke({
        messages: LLMProvider.convertMessages(messages),
      });

      const content = JSON.stringify(
        mathResponse.messages.at(-1)?.content,
        null,
        2,
      );

      return {
        role: "assistant",
        content,
      };
    } catch (error) {
      console.error("Error during agent execution:", error);
      // // Tools throw ToolException for tool-specific errors
      // if (error.name === "ToolException") {
      //   console.error("Tool execution failed:", error.message);
      // }
    } finally {
      await Promise.all(disconnectCallbacks.map((cb) => cb()));
    }
  };

  clientWithMetadata = (client: Runnable) => {
    return client.withConfig({
      metadata: this.metadata,
    }) as unknown as BaseChatModel;
  };
}
