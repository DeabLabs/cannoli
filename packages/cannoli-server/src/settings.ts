import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SettingsSchema } from "./schemas";
import { Settings } from "./types";
import { ensureConfigDir, createDefaultSettings } from "./utils";
import { getLogger } from "src/logger";

const logger = getLogger();

// Load settings from file or create default if not exists
export async function loadSettings(configDir: string): Promise<Settings> {
  try {
    const settingsFile = path.join(configDir, "settings.json");

    const data = await fs.readFile(settingsFile, "utf-8");
    const rawSettings = JSON.parse(data);
    // Parse with Zod schema
    return SettingsSchema.parse(rawSettings);
  } catch (parseError) {
    await ensureConfigDir(configDir);

    logger.warn(
      "Creating default settings. Any previous invalid settings will be saved to the `oldSettings` key in the settings file.",
    );
    // If invalid, return a fresh default settings
    const defaultSettings: Settings = createDefaultSettings();
    logger.warn(
      "Your secret is:\n" +
        defaultSettings.serverSecret +
        "\nEnter it within Cannoli settings to access your server.",
    );
    await saveSettings(defaultSettings, configDir);
    return defaultSettings;
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
    logger.error("Error saving settings:", String(error));
    throw error;
  }
}
