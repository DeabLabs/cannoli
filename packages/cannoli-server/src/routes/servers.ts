import { Context, Hono } from "hono";
import {
  ServerCreateSchema,
  McpServerSchema,
  SuccessResponseSchema,
  ErrorResponseSchema,
  McpProxyServerSchema,
} from "../schemas";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  createServer,
  deleteServer,
  getAllServers,
  getServerById,
  updateServer,
} from "src/data/servers";
import { McpProxyServer } from "src/types";

// Define input schemas
const ServerIdParamSchema = z.object({ id: z.string() });

// Define response schemas
const ServersListResponseSchema = SuccessResponseSchema.extend({
  servers: z.array(McpServerSchema),
});

const ServerDetailResponseSchema = SuccessResponseSchema.extend({
  server: McpServerSchema,
});

const ServerDeleteResponseSchema = SuccessResponseSchema.extend({
  message: z.string(),
});

// Create a router for MCP server endpoints
const router = new Hono()
  // Get all MCP servers
  .get(
    "/",
    describeRoute({
      description: "Get all MCP servers",
      tags: ["Servers"],
      responses: {
        200: {
          description: "List of all MCP servers",
          content: {
            "application/json": {
              schema: resolver(ServersListResponseSchema),
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
      return getAllServersResponse(c);
    },
  )
  .get(
    "/sse",
    describeRoute({
      description: "Get all MCP servers as SSE proxy definitions",
      tags: ["Servers"],
      responses: {
        200: {
          description: "List of all MCP servers as SSE proxy definitions",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  status: z.string(),
                  servers: McpProxyServerSchema,
                }),
              ),
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
      const servers = await getAllServers(c.get("configDir"));
      const host = c.get("host");
      const port = c.get("port");
      return c.json({
        status: "ok",
        servers: servers.reduce((acc, server) => {
          const proxyServer: McpProxyServer = {
            [server.name]: {
              url: `http://${host}:${port}/sse/${server.id}`,
              transport: "sse",
              headers: {},
            },
          };
          return { ...acc, ...proxyServer };
        }, {} as McpProxyServer),
      });
    },
  )
  // Get a single MCP server by ID
  .get(
    "/:id",
    describeRoute({
      description: "Get a single MCP server by ID",
      tags: ["Servers"],
      responses: {
        200: {
          description: "Server details",
          content: {
            "application/json": {
              schema: resolver(ServerDetailResponseSchema),
            },
          },
        },
        404: {
          description: "Server not found",
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
    zValidator("param", ServerIdParamSchema),
    async (c) => {
      return getServerByIdResponse(c);
    },
  )
  // Add a new MCP server
  .post(
    "/",
    describeRoute({
      description: "Add a new MCP server",
      tags: ["Servers"],
      responses: {
        201: {
          description: "Server created successfully",
          content: {
            "application/json": {
              schema: resolver(ServerDetailResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid server configuration",
          content: {
            "application/json": {
              schema: resolver(ErrorResponseSchema),
            },
          },
        },
        409: {
          description: "Server ID already exists",
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
    zValidator("json", ServerCreateSchema),
    async (c) => {
      return createServerResponse(c);
    },
  )
  // Update an existing MCP server
  .put(
    "/:id",
    describeRoute({
      description: "Update an existing MCP server",
      tags: ["Servers"],
      responses: {
        200: {
          description: "Server updated successfully",
          content: {
            "application/json": {
              schema: resolver(ServerDetailResponseSchema),
            },
          },
        },
        400: {
          description: "Invalid server configuration",
          content: {
            "application/json": {
              schema: resolver(ErrorResponseSchema),
            },
          },
        },
        404: {
          description: "Server not found",
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
    zValidator("param", ServerIdParamSchema),
    zValidator("json", ServerCreateSchema),
    async (c) => {
      return updateServerResponse(c);
    },
  )
  // Delete an MCP server
  .delete(
    "/:id",
    describeRoute({
      description: "Delete an MCP server",
      tags: ["Servers"],
      responses: {
        200: {
          description: "Server deleted successfully",
          content: {
            "application/json": {
              schema: resolver(ServerDeleteResponseSchema),
            },
          },
        },
        404: {
          description: "Server not found",
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
    zValidator("param", ServerIdParamSchema),
    async (c) => {
      return deleteServerResponse(c);
    },
  );

// Get all MCP servers
export async function getAllServersResponse(c: Context): Promise<Response> {
  try {
    const configDir = c.get("configDir");
    const servers = await getAllServers(configDir);
    return c.json({
      status: "ok",
      servers,
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

// Get a single MCP server by ID
export async function getServerByIdResponse(c: Context): Promise<Response> {
  try {
    const configDir = c.get("configDir");
    const serverId = c.req.param("id");
    const server = await getServerById(configDir, serverId);
    if (!server) {
      return c.json(
        {
          status: "error",
          message: `MCP server with ID ${serverId} not found`,
        },
        404,
      );
    }

    return c.json({
      status: "ok",
      server,
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

// Add a new MCP server
export async function createServerResponse(c: Context): Promise<Response> {
  try {
    const configDir = c.get("configDir");
    const rawData = await c.req.json();

    const newServer = await createServer(configDir, rawData);

    return c.json(
      {
        status: "ok",
        server: newServer,
      },
      201,
    );
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

// Update an existing MCP server
export async function updateServerResponse(c: Context): Promise<Response> {
  try {
    const configDir = c.get("configDir");
    const serverId = c.req.param("id");
    const rawData = await c.req.json();

    const updatedServer = await updateServer(configDir, serverId, rawData);

    return c.json({
      status: "ok",
      server: updatedServer,
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

// Delete an MCP server
export async function deleteServerResponse(c: Context): Promise<Response> {
  try {
    const configDir = c.get("configDir");
    const serverId = c.req.param("id");
    await deleteServer(configDir, serverId);

    return c.json({
      status: "ok",
      message: `Server ${serverId} deleted successfully`,
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

export default router;
