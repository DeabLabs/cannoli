import { Context, Hono } from "hono";
import * as path from "node:path";
import { loadSettings } from "../settings";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  ErrorResponseSchema,
  SettingsSchema,
  SuccessResponseSchema,
} from "src/schemas";
import { resolver } from "hono-openapi/zod";

// Define schemas for the status endpoint
const StatusResponseSuccessSchema = SuccessResponseSchema.extend({
  version: z.string(),
  settings: SettingsSchema,
  configPath: z.string().optional(),
});

// Create a router for status endpoints
const router = new Hono()
  // Get status endpoint
  .get(
    "/",
    describeRoute({
      description: "Get server status and configuration information",
      tags: ["Status"],
      responses: {
        200: {
          description: "Successful response with server status",
          content: {
            "application/json": {
              schema: resolver(StatusResponseSuccessSchema),
            },
          },
        },
        500: {
          description: "Server error",
          content: {
            "application/json": {
              schema: resolver(ErrorResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      return getStatus(c);
    },
  );

// For backward compatibility
export async function getStatus(c: Context) {
  try {
    const configDir = c.get("configDir");
    const settings = await loadSettings(configDir);
    const settingsFile = path.join(configDir, "settings.json");
    const response = StatusResponseSuccessSchema.parse({
      status: "ok",
      version: "1.0.0",
      settings,
      configPath: settingsFile,
    });

    return c.json(response);
  } catch (error: unknown) {
    return c.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}

export default router;
