import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SettingsSchema } from "./schemas";
import { Settings } from "./types";
import { ensureConfigDir, createDefaultSettings } from "./utils";

// Load settings from file or create default if not exists
export async function loadSettings(configDir: string): Promise<Settings> {
  const settingsFile = path.join(configDir, "settings.json");

  try {
    await ensureConfigDir(configDir);
    const data = await fs.readFile(settingsFile, "utf-8");
    const rawSettings = JSON.parse(data);

    try {
      // Parse with Zod schema
      return SettingsSchema.parse(rawSettings);
    } catch (parseError) {
      console.error("Settings validation error:", parseError);
      // If invalid, return a fresh default settings
      const defaultSettings: Settings = createDefaultSettings();
      await saveSettings(defaultSettings, configDir);
      return defaultSettings;
    }
  } catch (error: unknown) {
    // If file doesn't exist, return default settings
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      const defaultSettings: Settings = createDefaultSettings();
      await saveSettings(defaultSettings, configDir);
      return defaultSettings;
    }

    console.error("Error loading settings:", error);
    throw error;
  }
}

// Save settings to file
export async function saveSettings(
  settings: Settings,
  configDir: string,
): Promise<Settings> {
  const settingsFile = path.join(configDir, "settings.json");

  try {
    await ensureConfigDir(configDir);
    settings.updatedAt = new Date().toISOString();
    await fs.writeFile(
      settingsFile,
      JSON.stringify(settings, null, 2),
      "utf-8",
    );
    return settings;
  } catch (error) {
    console.error("Error saving settings:", error);
    throw error;
  }
}
