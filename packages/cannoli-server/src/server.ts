import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import * as path from "node:path";
import { getConfigDir } from "./utils";
import { ServerInfo } from "./types";
import { openAPISpecs } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { requestId } from "hono/request-id";
import { bearerAuth } from "hono/bearer-auth";

// Import routers
import statusRouter from "./routes/status";
import mcpServersRouter from "./routes/servers";
import settingsRouter from "./routes/settings";
import sseRouter from "./routes/sse";
import { loadSettings } from "src/settings";

declare module "hono" {
  interface ContextVariableMap {
    configDir: string;
    requestId: string;
    host: string;
    port: number;
  }
}

// Create the app
const app = new Hono();
app.use("*", logger());
app.use("*", cors());

// Configuration
const HOST = process.env.HOST || "localhost";
const PORT = process.env.PORT || 3333;
const CONFIG_DIR = getConfigDir();
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");
const SERVER_SECRET = await loadSettings(CONFIG_DIR).then(
  (settings) => settings.serverSecret,
);

app.use(async (c, next) => {
  const path = c.req.path;
  if (path.startsWith("/docs") || path.startsWith("/openapi")) {
    return next();
  }
  return bearerAuth({ token: SERVER_SECRET })(c, next);
});

// Middleware to add configDir to context
app.use(
  "*",
  (c, next) => {
    c.set("configDir", CONFIG_DIR);
    c.set("host", HOST);
    c.set("port", Number(PORT));
    return next();
  },
  requestId(),
);

// Mount the routers
const routerApp = app
  .route("/status", statusRouter)
  .route("/mcp-servers", mcpServersRouter)
  .route("/settings", settingsRouter)
  .route("/sse", sseRouter);

export type AppType = typeof routerApp;

// Add OpenAPI documentation
app.get(
  "/openapi",
  openAPISpecs(app, {
    documentation: {
      info: {
        title: "Cannoli Server API",
        version: "1.0.0",
        description:
          "API for Cannoli Server providing MCP and other AI features",
      },
      servers: [
        {
          url: `http://${HOST}:${PORT}`,
          description: "Cannoli Server",
        },
      ],
    },
  }),
);

// Add API reference UI
app.get(
  "/docs",
  Scalar({
    theme: "saturn",
    spec: { url: "/openapi" },
  }),
);

// Start server
serve(
  {
    fetch: app.fetch,
    port: Number(PORT),
    hostname: HOST,
  },
  (info: ServerInfo) => {
    console.log(`Cannoli server listening on http://${HOST}:${info.port}`);
    console.log(`Using config file: ${SETTINGS_FILE}`);
    console.log(
      `API documentation available at http://${HOST}:${info.port}/docs`,
    );
  },
);

export default app;
