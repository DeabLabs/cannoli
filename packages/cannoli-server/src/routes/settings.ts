import { Context, Hono } from "hono";
import {
  ErrorResponseSchema,
  PublicSettingsSchema,
  SettingsSchema,
  SuccessResponseSchema,
} from "../schemas";
import { loadSettings, saveSettings } from "../settings";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { zValidator } from "@hono/zod-validator";

const SettingsSuccessResponseSchema = SuccessResponseSchema.extend({
  settings: SettingsSchema,
});

// Create a router for settings endpoints
const router = new Hono()
  // General settings update
  .patch(
    "/",
    describeRoute({
      description: "Update server settings",
      tags: ["Settings"],
      responses: {
        200: {
          description: "Settings updated successfully",
          content: {
            "application/json": {
              schema: resolver(SettingsSuccessResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid settings provided",
          content: {
            "application/json": {
              schema: resolver(ErrorResponseSchema),
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
    zValidator("json", SettingsSchema.partial()),
    async (c) => {
      const configDir = c.get("configDir");
      return updateSettings(c, configDir);
    },
  )
  // Get raw settings JSON file
  .get(
    "/raw",
    describeRoute({
      description: "Get raw settings JSON file",
      tags: ["Settings"],
      responses: {
        200: {
          description: "Raw settings JSON",
          content: {
            "application/json": {
              schema: resolver(PublicSettingsSchema),
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
      const configDir = c.get("configDir");
      return getRawSettings(c, configDir);
    },
  );

// General settings update
export async function updateSettings(c: Context, configDir: string) {
  try {
    const currentSettings = await loadSettings(configDir);
    const updates = await c.req.json();

    // Merge current settings with updates
    const updatedSettings = {
      ...currentSettings,
      ...updates,
    };

    // Validate merged settings
    const validationResult = SettingsSchema.safeParse(updatedSettings);
    if (!validationResult.success) {
      return c.json(
        {
          status: "error",
          message: "Invalid settings",
          errors: validationResult.error.format(),
        },
        400,
      );
    }

    await saveSettings(validationResult.data, configDir);

    return c.json({
      status: "ok",
      settings: validationResult.data,
    });
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

// Get raw settings JSON file
export async function getRawSettings(c: Context, configDir: string) {
  try {
    const UNSAFE_settings = await loadSettings(configDir);
    const settings = PublicSettingsSchema.parse(UNSAFE_settings);
    return c.json(settings);
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
