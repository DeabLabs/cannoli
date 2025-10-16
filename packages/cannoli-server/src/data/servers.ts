import { nanoid } from "nanoid";
import {
  HttpServerSchema,
  StdioServerSchema,
  ServerCreateSchema,
} from "src/schemas";
import { loadSettings, saveSettings } from "src/settings";
import { McpServer } from "src/types";
import { z } from "zod";

// Get all MCP servers
export async function getAllServers(configDir: string): Promise<McpServer[]> {
  const settings = await loadSettings(configDir);
  return settings.mcpServers;
}

// Get a single MCP server by ID
export async function getServerById(
  configDir: string,
  serverId: string,
): Promise<McpServer | undefined> {
  const settings = await loadSettings(configDir);
  return settings.mcpServers.find((s) => s.id === serverId);
}

// Add a new MCP server
export async function createServer(
  configDir: string,
  serverData: unknown,
): Promise<McpServer> {
  const settings = await loadSettings(configDir);

  // Validate server data with Zod
  const result = ServerCreateSchema.safeParse(serverData);
  if (!result.success) {
    throw new Error(
      `Invalid server configuration: ${JSON.stringify(result.error.format())}`,
    );
  }

  const data = result.data;
  const id = nanoid(10);

  // Check if ID already exists
  if (settings.mcpServers.some((s) => s.id === id)) {
    throw new Error(`Server with ID ${id} already exists`);
  }

  // Create new server with defaults
  const newServer: McpServer = {
    ...data,
    id,
    enabled: data.enabled ?? true,
  };

  // Add to settings
  settings.mcpServers.push(newServer);
  await saveSettings(settings, configDir);

  return newServer;
}

// Update an existing MCP server
export async function updateServer(
  configDir: string,
  serverId: string,
  updates: unknown,
): Promise<McpServer> {
  const settings = await loadSettings(configDir);

  // Find server index
  const serverIndex = settings.mcpServers.findIndex((s) => s.id === serverId);
  if (serverIndex === -1) {
    throw new Error(`MCP server with ID ${serverId} not found`);
  }

  const currentServer = settings.mcpServers[serverIndex];
  let updatedServer: McpServer;

  // Check if this is a type change by looking at the updates object
  const updateObj = z
    .union([HttpServerSchema.partial(), StdioServerSchema.partial()])
    .parse(updates);

  if (updateObj.type && updateObj.type !== currentServer.type) {
    // This is a type change - validate entire new server config
    if (updateObj.type === "http") {
      const result = HttpServerSchema.safeParse({
        ...updateObj,
        id: currentServer.id,
        type: "http" as const,
      });

      if (!result.success) {
        throw new Error(
          `Invalid HTTP server configuration: ${JSON.stringify(
            result.error.format(),
          )}`,
        );
      }

      updatedServer = result.data;
    } else {
      const result = StdioServerSchema.safeParse({
        ...updateObj,
        id: currentServer.id,
        type: "stdio" as const,
      });

      if (!result.success) {
        throw new Error(
          `Invalid stdio server configuration: ${JSON.stringify(
            result.error.format(),
          )}`,
        );
      }

      updatedServer = result.data;
    }
  } else {
    // This is a partial update - validate against current type's schema
    if (currentServer.type === "http") {
      const schema = HttpServerSchema.partial().required({
        type: true,
        id: true,
        name: true,
        enabled: true,
        url: true,
        headers: true,
      });

      const result = schema.safeParse({
        ...currentServer,
        ...updateObj,
        id: currentServer.id,
        type: "http" as const,
      });

      if (!result.success) {
        throw new Error(
          `Invalid HTTP server update: ${JSON.stringify(
            result.error.format(),
          )}`,
        );
      }

      updatedServer = result.data;
    } else {
      const schema = StdioServerSchema.partial().required({
        type: true,
        id: true,
        name: true,
        enabled: true,
        command: true,
        args: true,
        env: true,
      });

      const result = schema.safeParse({
        ...currentServer,
        ...updateObj,
        id: currentServer.id,
        type: "stdio" as const,
      });

      if (!result.success) {
        throw new Error(
          `Invalid stdio server update: ${JSON.stringify(
            result.error.format(),
          )}`,
        );
      }

      updatedServer = result.data;
    }
  }

  settings.mcpServers[serverIndex] = updatedServer;
  await saveSettings(settings, configDir);

  return updatedServer;
}

// Delete an MCP server
export async function deleteServer(
  configDir: string,
  serverId: string,
): Promise<void> {
  const settings = await loadSettings(configDir);

  // Find server index
  const serverIndex = settings.mcpServers.findIndex((s) => s.id === serverId);
  if (serverIndex === -1) {
    throw new Error(`MCP server with ID ${serverId} not found`);
  }

  // Remove server
  settings.mcpServers.splice(serverIndex, 1);
  await saveSettings(settings, configDir);
}
