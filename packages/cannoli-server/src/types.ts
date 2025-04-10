import { z } from 'zod';
import {
  McpServerSchema,
  SettingsSchema,
  HttpServerSchema,
  StdioServerSchema
} from './schemas';

// Infer types from schemas
export type McpServer = z.infer<typeof McpServerSchema>;
export type HttpServer = z.infer<typeof HttpServerSchema>;
export type StdioServer = z.infer<typeof StdioServerSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

// Server info for the HTTP server
export interface ServerInfo {
  port: number | string;
} 