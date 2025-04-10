import { Context, Hono } from 'hono';
import { nanoid } from 'nanoid';
import { McpServer } from '../types';
import { ServerCreateSchema, McpServerSchema, HttpServerSchema, StdioServerSchema } from '../schemas';
import { loadSettings, saveSettings } from '../settings';
import { AppVariables } from '../types/context';

// Create a router for MCP server endpoints
const router = new Hono<{ Variables: AppVariables }>();

// Get all MCP servers
router.get('/', async (c) => {
  const configDir = c.get('configDir');
  return getAllServers(c, configDir);
});

// Get a single MCP server by ID
router.get('/:id', async (c) => {
  const configDir = c.get('configDir');
  return getServerById(c, configDir);
});

// Add a new MCP server
router.post('/', async (c) => {
  const configDir = c.get('configDir');
  return createServer(c, configDir);
});

// Update an existing MCP server
router.put('/:id', async (c) => {
  const configDir = c.get('configDir');
  return updateServer(c, configDir);
});

// Delete an MCP server
router.delete('/:id', async (c) => {
  const configDir = c.get('configDir');
  return deleteServer(c, configDir);
});

// Set default MCP server
router.post('/:id/set-default', async (c) => {
  const configDir = c.get('configDir');
  return setDefaultServer(c, configDir);
});

// Get all MCP servers
export async function getAllServers(c: Context, configDir: string): Promise<Response> {
  try {
    const settings = await loadSettings(configDir);
    return c.json({
      status: 'ok',
      servers: settings.mcpServers,
      defaultServerId: settings.defaultMcpServerId
    });
  } catch (error: unknown) {
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

// Get a single MCP server by ID
export async function getServerById(c: Context, configDir: string): Promise<Response> {
  try {
    const serverId = c.req.param('id');
    const settings = await loadSettings(configDir);

    const server = settings.mcpServers.find(s => s.id === serverId);
    if (!server) {
      return c.json({
        status: 'error',
        message: `MCP server with ID ${serverId} not found`
      }, 404);
    }

    return c.json({
      status: 'ok',
      server,
      isDefault: settings.defaultMcpServerId === serverId
    });
  } catch (error: unknown) {
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

// Add a new MCP server
export async function createServer(c: Context, configDir: string): Promise<Response> {
  try {
    const settings = await loadSettings(configDir);
    const rawData = await c.req.json();

    // Validate server data with Zod
    const result = ServerCreateSchema.safeParse(rawData);

    if (!result.success) {
      return c.json({
        status: 'error',
        message: 'Invalid server configuration',
        errors: result.error.format()
      }, 400);
    }

    const data = result.data;

    // Generate ID if not provided
    const id = nanoid(10);

    // Check if ID already exists
    if (settings.mcpServers.some(s => s.id === id)) {
      return c.json({
        status: 'error',
        message: `Server with ID ${id} already exists`
      }, 409);
    }

    // Create new server based on type
    let newServer: McpServer;

    if (data.type === 'http') {
      newServer = {
        ...data,
        id,
        enabled: data.enabled ?? true
      };
    } else { // stdio
      newServer = {
        ...data,
        id,
        enabled: data.enabled ?? true
      };
    }

    // Add to settings
    settings.mcpServers.push(newServer);

    // Set as default if requested or if it's the first server
    if (data.setAsDefault || settings.mcpServers.length === 1) {
      settings.defaultMcpServerId = newServer.id;
    }

    await saveSettings(settings, configDir);

    return c.json({
      status: 'ok',
      server: newServer,
      isDefault: settings.defaultMcpServerId === newServer.id
    }, 201);
  } catch (error: unknown) {
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

// Update an existing MCP server
export async function updateServer(c: Context, configDir: string): Promise<Response> {
  try {
    const serverId = c.req.param('id');
    const settings = await loadSettings(configDir);
    const rawData = await c.req.json();

    // Find server index
    const serverIndex = settings.mcpServers.findIndex(s => s.id === serverId);
    if (serverIndex === -1) {
      return c.json({
        status: 'error',
        message: `MCP server with ID ${serverId} not found`
      }, 404);
    }

    const currentServer = settings.mcpServers[serverIndex];
    const setAsDefault = !!rawData.setAsDefault;

    let updatedServer: McpServer;

    if (currentServer.type === 'http') {
      // For HTTP servers, validate the update
      const partialHttpServerSchema = HttpServerSchema.partial().omit({ id: true });
      const result = partialHttpServerSchema.safeParse(rawData);

      if (!result.success) {
        return c.json({
          status: 'error',
          message: 'Invalid HTTP server configuration',
          errors: result.error.format()
        }, 400);
      }

      // If type is changing, ensure new type has all required fields
      if (rawData.type && rawData.type !== 'http') {
        if (!rawData.command) {
          return c.json({
            status: 'error',
            message: 'Command is required when changing to stdio server type'
          }, 400);
        }

        // Create a new stdio server
        updatedServer = {
          id: currentServer.id,
          name: rawData.name || currentServer.name,
          type: 'stdio' as const,
          command: rawData.command,
          args: rawData.args || [],
          cwd: rawData.cwd,
          env: rawData.env || {},
          installCommand: rawData.installCommand,
          apiKey: rawData.apiKey !== undefined ? rawData.apiKey : currentServer.apiKey,
          enabled: rawData.enabled !== undefined ? rawData.enabled : currentServer.enabled,
        };
      } else {
        // Update existing HTTP server
        updatedServer = {
          ...currentServer,
          name: rawData.name || currentServer.name,
          url: rawData.url || currentServer.url,
          headers: rawData.headers !== undefined ? rawData.headers : currentServer.headers,
          apiKey: rawData.apiKey !== undefined ? rawData.apiKey : currentServer.apiKey,
          enabled: rawData.enabled !== undefined ? rawData.enabled : currentServer.enabled,
        };
      }
    } else { // stdio
      // For stdio servers, validate the update
      const partialStdioServerSchema = StdioServerSchema.partial().omit({ id: true });
      const result = partialStdioServerSchema.safeParse(rawData);

      if (!result.success) {
        return c.json({
          status: 'error',
          message: 'Invalid stdio server configuration',
          errors: result.error.format()
        }, 400);
      }

      // If type is changing, ensure new type has all required fields
      if (rawData.type && rawData.type !== 'stdio') {
        if (!rawData.url) {
          return c.json({
            status: 'error',
            message: 'URL is required when changing to HTTP server type'
          }, 400);
        }

        // Create a new HTTP server
        updatedServer = {
          id: currentServer.id,
          name: rawData.name || currentServer.name,
          type: 'http' as const,
          url: rawData.url,
          headers: rawData.headers || {},
          apiKey: rawData.apiKey !== undefined ? rawData.apiKey : currentServer.apiKey,
          enabled: rawData.enabled !== undefined ? rawData.enabled : currentServer.enabled,
        };
      } else {
        // Update existing stdio server
        updatedServer = {
          ...currentServer,
          name: rawData.name || currentServer.name,
          command: rawData.command || currentServer.command,
          args: rawData.args !== undefined ? rawData.args : currentServer.args,
          cwd: rawData.cwd !== undefined ? rawData.cwd : currentServer.cwd,
          env: rawData.env !== undefined ? rawData.env : currentServer.env,
          installCommand: rawData.installCommand !== undefined ? rawData.installCommand : currentServer.installCommand,
          apiKey: rawData.apiKey !== undefined ? rawData.apiKey : currentServer.apiKey,
          enabled: rawData.enabled !== undefined ? rawData.enabled : currentServer.enabled,
        };
      }
    }

    // Validate the final server object with the full schema
    const validationResult = McpServerSchema.safeParse(updatedServer);
    if (!validationResult.success) {
      return c.json({
        status: 'error',
        message: 'Invalid server configuration after update',
        errors: validationResult.error.format()
      }, 400);
    }

    settings.mcpServers[serverIndex] = updatedServer;

    // Set as default if requested
    if (setAsDefault) {
      settings.defaultMcpServerId = serverId;
    }

    await saveSettings(settings, configDir);

    return c.json({
      status: 'ok',
      server: updatedServer,
      isDefault: settings.defaultMcpServerId === serverId
    });
  } catch (error: unknown) {
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

// Delete an MCP server
export async function deleteServer(c: Context, configDir: string): Promise<Response> {
  try {
    const serverId = c.req.param('id');
    const settings = await loadSettings(configDir);

    // Find server index
    const serverIndex = settings.mcpServers.findIndex(s => s.id === serverId);
    if (serverIndex === -1) {
      return c.json({
        status: 'error',
        message: `MCP server with ID ${serverId} not found`
      }, 404);
    }

    // Remove server
    settings.mcpServers.splice(serverIndex, 1);

    // Update default server if this was the default
    if (settings.defaultMcpServerId === serverId) {
      settings.defaultMcpServerId = settings.mcpServers.length > 0 ? settings.mcpServers[0].id : undefined;
    }

    await saveSettings(settings, configDir);

    return c.json({
      status: 'ok',
      message: `Server ${serverId} deleted successfully`,
      newDefaultId: settings.defaultMcpServerId
    });
  } catch (error: unknown) {
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

// Set default MCP server
export async function setDefaultServer(c: Context, configDir: string): Promise<Response> {
  try {
    const serverId = c.req.param('id');
    const settings = await loadSettings(configDir);

    // Check if server exists
    if (!settings.mcpServers.some(s => s.id === serverId)) {
      return c.json({
        status: 'error',
        message: `MCP server with ID ${serverId} not found`
      }, 404);
    }

    // Update default server
    settings.defaultMcpServerId = serverId;
    await saveSettings(settings, configDir);

    return c.json({
      status: 'ok',
      message: `Server ${serverId} set as default`
    });
  } catch (error: unknown) {
    return c.json({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

export default router; 