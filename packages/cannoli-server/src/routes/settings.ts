import { Context, Hono } from 'hono';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SettingsSchema } from '../schemas';
import { loadSettings, saveSettings } from '../settings';
import { AppVariables } from '../types/context';

// Create a router for settings endpoints
const router = new Hono<{ Variables: AppVariables }>();

// General settings update
router.patch('/', async (c) => {
  const configDir = c.get('configDir');
  return updateSettings(c, configDir);
});

// Get raw settings JSON file
router.get('/raw', async (c) => {
  const configDir = c.get('configDir');
  return getRawSettings(c, configDir);
});

// General settings update
export async function updateSettings(c: Context, configDir: string): Promise<Response> {
  try {
    const currentSettings = await loadSettings(configDir);
    const updates = await c.req.json();

    // Merge current settings with updates
    const updatedSettings = {
      ...currentSettings,
      ...updates
    };

    // Validate merged settings
    const validationResult = SettingsSchema.safeParse(updatedSettings);
    if (!validationResult.success) {
      return c.json({
        status: 'error',
        message: 'Invalid settings',
        errors: validationResult.error.format()
      }, 400);
    }

    await saveSettings(validationResult.data, configDir);

    return c.json({
      status: 'ok',
      settings: validationResult.data
    });
  } catch (error: unknown) {
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

// Get raw settings JSON file
export async function getRawSettings(c: Context, configDir: string): Promise<Response> {
  try {
    const settingsFile = path.join(configDir, 'settings.json');

    try {
      // Check if the file exists and read it
      const data = await fs.readFile(settingsFile, 'utf-8');

      // Parse to validate it's proper JSON and pretty print it
      const jsonData = JSON.parse(data);

      // Set content type to application/json
      c.header('Content-Type', 'application/json');
      return c.body(JSON.stringify(jsonData, null, 2));
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        // If file doesn't exist, create it with default settings
        const defaultSettings = await loadSettings(configDir);
        c.header('Content-Type', 'application/json');
        return c.body(JSON.stringify(defaultSettings, null, 2));
      }

      throw error;
    }
  } catch (error: unknown) {
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

export default router; 