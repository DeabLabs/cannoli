import { Context, Hono } from "hono";
import { proxyServer } from "mcp-proxy";
import { streamSSE } from "hono/streaming";
import { getServerById } from "src/data/servers";
import { StdioClientTransport } from "src/impl/StdioClientTransport";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { bodyLimit } from "hono/body-limit";
import { SSEServerTransport } from "src/impl/SSEServerTransport";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { EventEmitter } from "events";

// 4mb in kb
const MAXIMUM_MESSAGE_SIZE = 4 * 1024 * 1024;

// Map of sessionId to SSEServerTransport
const ActiveSSEConnections = new Map<string, SSEServerTransport>();

const router = new Hono()
  .get("/ping", async (c: Context) => {
    return c.text("pong");
  })
  .get(
    "/:id",
    bodyLimit({ maxSize: MAXIMUM_MESSAGE_SIZE }),
    async (c: Context) => {
      const emitter = new EventEmitter();
      const configDir = c.get("configDir");
      const serverId = c.req.param("id");
      const server = await getServerById(configDir, serverId);

      if (!server) {
        return c.json({ error: "Server not found" }, 404);
      }

      if (server.type !== "stdio") {
        return c.json({ error: "Server is not a stdio server" }, 400);
      }

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      const serverTransport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        cwd: server.cwd,
        env: process.env as Record<string, string>,
        stderr: "pipe",
        onEvent: (event) => {
          console.log("transport event", event);
        },
      });

      const client = new Client(
        {
          name: "cannoli-mcp-proxy",
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );

      await client.connect(serverTransport);

      const serverVersion = client.getServerVersion() as {
        name: string;
        version: string;
      };

      const serverCapabilities = client.getServerCapabilities() as Record<
        string,
        unknown
      >;

      const mcpServer = new Server(serverVersion, {
        capabilities: serverCapabilities,
      });

      await proxyServer({
        server: mcpServer,
        client,
        serverCapabilities,
      });

      // these files are crucial for implementation
      // mcp proxy implementation
      // https://github.com/punkpeye/mcp-proxy/blob/main/src/bin/mcp-proxy.ts
      // https://github.com/punkpeye/mcp-proxy/blob/main/src/startSSEServer.ts
      // hono stream auto-closing issues
      // https://github.com/honojs/hono/issues/1770
      // https://github.com/honojs/hono/issues/2993
      // mcp protocol implementation
      // https://github.com/modelcontextprotocol/typescript-sdk/blob/d205ad28f389756fd02bc5349a7b6f0909716634/src/server/sse.ts

      return streamSSE(c, async (stream) => {
        // const emitter = new EventEmitter();

        const closed = false;
        const requestId = c.get("requestId");
        const sseServerTransport = new SSEServerTransport(
          `/sse/${serverId}/messages`,
          stream,
        );
        sseServerTransport.onerror = (error) => {
          console.error("SSE server transport error", error);
        };
        ActiveSSEConnections.set(
          sseServerTransport.sessionId,
          sseServerTransport,
        );

        try {
          await mcpServer.connect(sseServerTransport);

          await sseServerTransport.send({
            jsonrpc: "2.0",
            method: "sse/connection",
            params: { message: "SSE Connection established" },
          });
        } catch (error) {
          console.error("Error sending SSE connection message", error);
          if (!closed) {
            stream.writeSSE({
              event: "error",
              data: "Error sending SSE connection message",
            });
          }
        }

        // handle abort event from client side
        c.req.raw.signal.addEventListener("abort", () => {
          console.log("stream disconnected from client side");
          emitter.emit("close");
        });

        // keep the connection alive
        return new Promise((resolve) => {
          console.log("waiting for close");
          const abort = async () => {
            console.log("stream aborted");
            try {
              await mcpServer.close();
              await client.close();
              await serverTransport.close();
            } catch (error) {
              console.error("Error closing mcp server", error);
            }
            ActiveSSEConnections.delete(requestId);
            resolve(undefined);
          };
          emitter.on("close", abort);
          stream.onAbort(abort);
        });
      });
    },
  )
  .post(
    "/:id/*",
    zValidator("query", z.object({ sessionId: z.string() })),
    async (c: Context) => {
      const configDir = c.get("configDir");
      const serverId = c.req.param("id");
      const { sessionId } = c.req.query();
      const server = await getServerById(configDir, serverId);

      if (!server) {
        console.error("Server not found", serverId);
        return c.json({ error: "Server not found" }, 404);
      }

      if (server.type !== "stdio") {
        console.error("Server is not a stdio server", serverId);
        return c.text("Server is not a stdio server", 400);
      }

      const sseServerTransport = ActiveSSEConnections.get(sessionId);

      if (!sseServerTransport) {
        console.error("SSE connection not found", sessionId);
        return c.text("SSE connection not found", 404);
      }

      return await sseServerTransport.handlePostMessage(c);
    },
  );

export default router;
