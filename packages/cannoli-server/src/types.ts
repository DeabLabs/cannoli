import { z } from "zod";
import {
	McpServerSchema,
	SettingsSchema,
	HttpServerSchema,
	StdioServerSchema,
} from "./schemas";
import { Context } from "hono";

// Define the application context variables
export type AppVariables = {
	configDir: string;
};

export type AppContext = Context<{ Variables: AppVariables }>;

// Infer types from schemas
export type McpServer = z.infer<typeof McpServerSchema>;
export type HttpServer = z.infer<typeof HttpServerSchema>;
export type StdioServer = z.infer<typeof StdioServerSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

// Server info for the HTTP server
export interface ServerInfo {
	port: number | string;
}
