import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { z } from "zod";
import invariant from "tiny-invariant";
import { TracingConfig } from "src/run";
import { choiceTool, formTool, noteSelectTool } from "./fn_calling";
import { loadMcpTools } from "./langchain/mcpTools";
import { makeCannoliServerClient } from "./serverClient";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ChatCompletionMessageParam } from "openai/resources/index";

export type SupportedProviders =
  | "openai"
  | "ollama"
  | "gemini"
  | "anthropic"
  | "groq"
  | "azure_openai";

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
  cannoliServerUrl?: string;
  cannoliServerSecret?: string;
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
    args: unknown;
  };
  function_call_id?: string;
};

export type GetDefaultsByProvider = (
  provider: SupportedProviders,
) => GenericModelConfig | undefined;

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
  cannoliServerUrl?: string;
  cannoliServerSecret?: string;
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
    this.cannoliServerUrl = initArgs.cannoliServerUrl;
    this.cannoliServerSecret = initArgs.cannoliServerSecret;
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

  // Convert messages to AI SDK format
  static convertToAIMessages = (
    messages: GenericCompletionResponse[],
    imageReferences: ImageReference[] = [],
  ): ModelMessage[] => {
    return messages
      .map((m, i) => {
        // Skip messages with function_call - these are handled externally by the cannoli system
        // If we converted them to tool call messages, AI SDK would expect tool response messages
        if (m.function_call) {
          // Just return an empty assistant message to maintain sequence
          return {
            role: "assistant" as const,
            content: "",
          };
        }

        // Handle image references for user messages
        const relevantImages = imageReferences.filter(
          (img) => img.messageIndex === i,
        );
        const imageContent = relevantImages.map((img) => ({
          type: "image" as const,
          image: img.url,
        }));

        if (m.role === "user") {
          return {
            role: "user" as const,
            content: imageContent.length
              ? [{ type: "text" as const, text: m.content }, ...imageContent]
              : m.content,
          };
        } else if (m.role === "assistant") {
          return {
            role: "assistant" as const,
            content: m.content,
          };
        } else if (m.role === "tool") {
          // Skip tool messages - they reference tool calls that we're not tracking in AI SDK
          // Just return an empty assistant message to maintain sequence
          return {
            role: "assistant" as const,
            content: "",
          };
        } else {
          return {
            role: "system" as const,
            content: m.content,
          };
        }
      })
      .filter((m) => m.content !== "");
  };

  // Legacy method for backwards compatibility
  static convertMessages = (
    messages: ChatCompletionMessageParam[] | GenericCompletionResponse[],
    imageReferences: ImageReference[] = [],
  ) => {
    return LLMProvider.convertToAIMessages(
      messages as GenericCompletionResponse[],
      imageReferences,
    );
  };

  // Get AI SDK model instance based on provider
  getModel = (
    args?: Partial<{
      configOverrides: GenericModelConfig;
      provider: SupportedProviders;
    }>,
  ): LanguageModel => {
    const config = this.getMergedConfig(args);
    const provider = config.provider;
    invariant(config.model, "Model is required");

    switch (provider) {
      case "openai": {
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
        })(config.model);
      }
      case "azure_openai": {
        // if (
        //   config.azureOpenAIApiInstanceName &&
        //   config.azureOpenAIApiDeploymentName &&
        //   config.azureOpenAIApiVersion
        // ) {
        //   const azureClient = createAzure({
        //     baseURL: config.azureOpenAIApiInstanceName,
        //     deploymentId: config.azureOpenAIApiDeploymentName,
        //     apiVersion: config.azureOpenAIApiVersion,
        //     apiKey: config.apiKey,
        //     useDeploymentBasedUrls: true,
        //   });
        //   return azureClient(config.model);
        // }
        throw new Error(
          "Azure OpenAI API is broken right now. Contact us in the discord.",
        );
      }
      case "ollama": {
        // Use OpenAI-compatible endpoint with Ollama's base URL
        const ollamaClient = createOpenAI({
          apiKey: "ollama", // Ollama doesn't require a real API key
          baseURL: config.baseURL || "http://localhost:11434/v1",
        });
        return ollamaClient(config.model);
      }
      case "anthropic": {
        return createAnthropic({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          headers: {
            "anthropic-dangerous-direct-browser-access": "true",
          },
        })(config.model);
      }
      case "groq": {
        return createGroq({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
        })(config.model);
      }
      case "gemini": {
        return createGoogleGenerativeAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
        })(config.model);
      }
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  };

  // Legacy method - returns the model instance
  getChatClient = (
    args?: Partial<{
      configOverrides: GenericModelConfig;
      provider: SupportedProviders;
    }>,
  ) => {
    return this.getModel(args);
  };

  getCompletion = async ({
    messages,
    imageReferences,
    ...configOverrides
  }: GenericCompletionParams): Promise<GenericCompletionResponse> => {
    const model = this.getModel({ configOverrides });
    const aiMessages = LLMProvider.convertToAIMessages(
      messages,
      imageReferences,
    );

    // Handle function calling
    if (configOverrides.functions && configOverrides.function_call) {
      return await this.handleFunctionCall({
        model,
        aiMessages,
        functions: configOverrides.functions,
        function_call: configOverrides.function_call,
        configOverrides: configOverrides,
      });
    }

    // Regular completion
    const result = await generateText({
      ...configOverrides,
      model,
      messages: aiMessages,
    });

    return {
      role: "assistant",
      content: result.text,
    };
  };

  private handleFunctionCall = async ({
    model,
    aiMessages,
    functions,
    function_call,
    configOverrides,
  }: {
    model: LanguageModel;
    aiMessages: ModelMessage[];
    functions: GenericFunctionCall[];
    function_call: { name: string };
    configOverrides: GenericModelConfig;
  }) => {
    // Convert GenericFunctionCall to AI SDK tool format
    const tools: Record<
      string,
      | ReturnType<typeof choiceTool>
      | ReturnType<typeof noteSelectTool>
      | ReturnType<typeof formTool>
    > = {};

    for (const func of functions) {
      if (func.name === "choice") {
        tools.choice = choiceTool(
          // @ts-expect-error - TODO: fix this
          func.parameters?.properties?.choice?.enum as [string, ...string[]],
        );
      } else if (func.name === "note_select") {
        tools.note_select = noteSelectTool(
          // @ts-expect-error - TODO: fix this
          func.parameters?.properties?.note?.enum as [string, ...string[]],
        );
      } else if (func.name === "form") {
        tools.form = formTool(Object.keys(func.parameters?.properties ?? {}));
      }
    }

    // Generate text with tools
    // Force tool choice when function_call is specified
    const result = await generateText({
      ...configOverrides,
      model,
      messages: aiMessages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      toolChoice: { type: "tool", toolName: function_call.name }, // Force specific tool
    });

    // Handle tool calls in response
    if (result.toolCalls && result.toolCalls.length > 0) {
      const toolCall = result.toolCalls[0];

      // AI SDK uses 'input' not 'args' for tool call arguments
      const args = "input" in toolCall ? toolCall.input : {};

      return {
        role: "assistant",
        content: "",
        function_call_id: toolCall.toolCallId,
        function_call: {
          name: toolCall.toolName,
          args,
        },
      };
    }

    // Fallback if no tool calls
    // Return undefined to signal that the tool call was not made
    // The cannoli system should handle this case
    return {
      role: "assistant",
      content: "",
      function_call: undefined,
    };
  };

  getCompletionStream = async ({
    messages,
    imageReferences,
    ...configOverrides
  }: GenericCompletionParams) => {
    const model = this.getModel({ configOverrides });
    const aiMessages = LLMProvider.convertToAIMessages(
      messages,
      imageReferences,
    );

    const stream = streamText({
      ...configOverrides,
      model,
      messages: aiMessages,
    });

    // Convert AI SDK stream to async iterable of strings
    return (async function* () {
      for await (const chunk of stream.textStream) {
        yield chunk;
      }
    })();
  };

  getGoalCompletion = async ({
    messages,
    imageReferences,
    onReasoningMessagesUpdated,
    ...configOverrides
  }: GenericCompletionParams & {
    onReasoningMessagesUpdated?: (
      messages: GenericCompletionResponse[],
    ) => void;
  }) => {
    const cannoliServerUrl = this.cannoliServerUrl;
    const cannoliServerSecret = this.cannoliServerSecret;
    invariant(
      cannoliServerUrl,
      "Cannoli server URL is not set. Cannoli-server is required to use goal completion nodes.",
    );
    invariant(
      cannoliServerSecret,
      "Cannoli server secret is not set. Cannoli-server is required to use goal completion nodes.",
    );

    const cannoliClient = makeCannoliServerClient(
      cannoliServerSecret,
      cannoliServerUrl,
    );

    const serversResponse = await cannoliClient["mcp-servers"].sse.$get();
    const servers = await serversResponse.json();

    const disconnectCallbacks: (() => Promise<void>)[] = [];
    const mcpServers = await Promise.all(
      Object.entries(servers.servers).map(async ([name, server]) => {
        const transport = new SSEClientTransport(new URL(server.url), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${cannoliServerSecret}`,
            },
          },
          eventSourceInit: {
            fetch: (url, options) => {
              return fetch(url, {
                ...options,
                headers: {
                  ...options?.headers,
                  Authorization: `Bearer ${cannoliServerSecret}`,
                },
              });
            },
          },
        });

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

        return await loadMcpTools(name, mcpClient);
      }),
    );

    if (mcpServers.length === 0) {
      throw new Error(
        "No MCP servers found in cannoli-server. Cannoli-server is required to use goal completion nodes.",
      );
    }

    // Convert LangChain tools to AI SDK tools (simplified for now)
    // TODO: Implement proper conversion of MCP tools to AI SDK format

    // For now, we'll use a custom agent loop with AI SDK
    // This is a simplified implementation - you may need to enhance it
    try {
      const model = this.getModel({ configOverrides });
      const aiMessages = LLMProvider.convertToAIMessages(
        messages,
        imageReferences,
      );

      // Custom agent loop
      const currentMessages = [...aiMessages];
      let iterations = 0;
      const maxIterations = 10;

      while (iterations < maxIterations) {
        onReasoningMessagesUpdated?.(
          currentMessages.map((m) => {
            return {
              role:
                m.role === "user"
                  ? "user"
                  : m.role === "assistant"
                    ? "assistant"
                    : m.role === "tool"
                      ? "tool"
                      : "system",
              content:
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
            };
          }),
        );

        const result = await generateText({
          model,
          messages: currentMessages,
        });

        // Add assistant message
        currentMessages.push({
          role: "assistant",
          content: result.text,
        });

        // If no tool calls, we're done
        if (!result.toolCalls || result.toolCalls.length === 0) {
          return {
            role: "assistant",
            content: result.text,
          };
        }

        iterations++;
      }

      return {
        role: "assistant",
        content: JSON.stringify(currentMessages.at(-1)?.content, null, 2),
      };
    } catch (error) {
      console.error("Error during agent execution:", error);
      throw error;
    } finally {
      await Promise.all(disconnectCallbacks.map((cb) => cb()));
    }
  };
}
