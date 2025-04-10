import { z } from "zod";

// Define response schemas for documentation
export const SuccessResponseSchema = z.object({
  status: z.literal("ok"),
});

export const ErrorResponseSchema = z.object({
  status: z.literal("error"),
  message: z.string(),
  errors: z.record(z.unknown()).optional(),
});

// Zod schemas for server configurations
export const ServerBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  apiKey: z.string().optional(),
});

export const HttpServerSchema = ServerBaseSchema.extend({
  type: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string()).optional().default({}),
});

export const StdioServerSchema = ServerBaseSchema.extend({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional().default({}),
  installCommand: z.string().optional(),
});

export const McpServerSchema = z.discriminatedUnion("type", [
  HttpServerSchema,
  StdioServerSchema,
]);

export const SettingsSchema = z
  .object({
    mcpServers: z.array(McpServerSchema).default([]),
    proxyEnabled: z.boolean().default(false),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .catchall(z.unknown());

// Server creation request schemas
export const HttpServerCreateSchema = HttpServerSchema.omit({
  id: true,
}).partial({ enabled: true });
export const StdioServerCreateSchema = StdioServerSchema.omit({
  id: true,
}).partial({ enabled: true });

// Create union for server creation requests
export const ServerCreateSchema = z.union([
  HttpServerCreateSchema,
  StdioServerCreateSchema,
]);
