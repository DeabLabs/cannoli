import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Settings } from './types';

// Get platform-specific config directory
export function getConfigDir(): string {
  const configDirName = '@deablabs/cannoli-server';

  if (process.env.CONFIG_DIR) {
    return process.env.CONFIG_DIR;
  }

  // Windows: %APPDATA%\@deablabs\cannoli-server
  // MacOS, Linux: ~/.config/@deablabs/cannoli-server
  const platform = process.platform;
  const homeDir = os.homedir();

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, configDirName);
  } else {
    // Linux, FreeBSD, etc.
    return path.join(homeDir, '.config', configDirName);
  }
}

// Ensure config directory exists
export async function ensureConfigDir(configDir: string): Promise<void> {
  try {
    await fs.mkdir(configDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create config directory:', error);
  }
}

// Create default settings
export function createDefaultSettings(): Settings {
  return {
    mcpServers: [],
    proxyEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
} 