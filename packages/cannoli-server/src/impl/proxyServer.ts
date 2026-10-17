import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  LoggingMessageNotificationSchema,
  ReadResourceRequestSchema,
  ResourceUpdatedNotificationSchema,
  ServerCapabilities,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/** Relay only advertised capabilities, preserving the caller's cancellation. */
export function proxyServer({
  server,
  client,
  serverCapabilities: capabilities,
}: {
  server: Server;
  client: Client;
  serverCapabilities: ServerCapabilities;
}) {
  if (capabilities.logging) {
    client.setNotificationHandler(LoggingMessageNotificationSchema, (message) =>
      server.notification(message),
    );
  }
  if (capabilities.prompts) {
    server.setRequestHandler(GetPromptRequestSchema, (request, extra) =>
      client.getPrompt(request.params, { signal: extra.signal }),
    );
    server.setRequestHandler(ListPromptsRequestSchema, (request, extra) =>
      client.listPrompts(request.params, { signal: extra.signal }),
    );
  }
  if (capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
      client.listResources(request.params, { signal: extra.signal }),
    );
    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      (request, extra) =>
        client.listResourceTemplates(request.params, { signal: extra.signal }),
    );
    server.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
      client.readResource(request.params, { signal: extra.signal }),
    );
    if (capabilities.resources.subscribe) {
      client.setNotificationHandler(
        ResourceUpdatedNotificationSchema,
        (message) => server.notification(message),
      );
      server.setRequestHandler(SubscribeRequestSchema, (request, extra) =>
        client.subscribeResource(request.params, { signal: extra.signal }),
      );
      server.setRequestHandler(UnsubscribeRequestSchema, (request, extra) =>
        client.unsubscribeResource(request.params, { signal: extra.signal }),
      );
    }
  }
  if (capabilities.tools) {
    server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
      client.callTool(request.params, CallToolResultSchema, {
        signal: extra.signal,
      }),
    );
    server.setRequestHandler(ListToolsRequestSchema, (request, extra) =>
      client.listTools(request.params, { signal: extra.signal }),
    );
  }
  if (capabilities.completions) {
    server.setRequestHandler(CompleteRequestSchema, (request, extra) =>
      client.complete(request.params, { signal: extra.signal }),
    );
  }
}
