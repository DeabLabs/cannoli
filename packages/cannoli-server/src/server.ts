import { Hono } from "hono";
import { serve, type HttpBindings } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
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
import { argumentsConfig, optionsDefinition } from "src/arguments";
import { getLogger, Logger } from "src/logger";
import { intro, outro } from "@clack/prompts";
import colors from "picocolors";

declare module "hono" {
  interface ContextVariableMap {
    configDir: string;
    requestId: string;
    host: string;
    port: number;
    logger: Logger;
  }
}

intro(`${colors.bgBlueBright(colors.black(` Cannoli Server `))}`);

const logger = getLogger();

if (argumentsConfig.help) {
  // generate help message from options config
  const helpMessage = Object.entries(optionsDefinition)
    .map(([key, value]) => `${key}: ${value.type}`)
    .join("\n");
  logger.log(`
Usage: cannoli-server [options]

Options:
${helpMessage}
`);
  process.exit(0);
}

type Bindings = HttpBindings;

// Create the app
const app = new Hono<{ Bindings: Bindings }>();
app.use(requestId());
app.use(honoLogger(logger.debug));

// Configuration
const HOST = argumentsConfig.host || process.env.HOST || "localhost";
const PORT = argumentsConfig.port || process.env.PORT || 3333;
const CONFIG_DIR = argumentsConfig["config-dir"] || getConfigDir();
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");
const SERVER_SECRET = await loadSettings(CONFIG_DIR).then(
  (settings) => settings.serverSecret,
);

app.use(
  "*",
  cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"] }),
);

app.use(async (...args) => {
  const [c, next] = args;
  const path = c.req.path;
  if (path.startsWith("/docs") || path.startsWith("/openapi")) {
    return await next();
  }
  return bearerAuth({ token: SERVER_SECRET })(...args);
});

// Middleware to add configDir to context
app.use("*", (c, next) => {
  c.set("configDir", CONFIG_DIR);
  c.set("host", HOST);
  c.set("port", Number(PORT));
  return next();
});

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

// catch ctrl-c and exit gracefully
process.on("SIGINT", () => {
  outro(
    `${colors.bgRedBright(colors.white(` Shutting down Cannoli server... Bye! `))}`,
  );
  process.exit(0);
});

// Start server
serve(
  {
    fetch: app.fetch,
    port: Number(PORT),
    hostname: HOST,
  },
  (info: ServerInfo) => {
    logger.log("Logger level      :", logger.getLevel());
    logger.log(`Using config file : ${SETTINGS_FILE}`);
    logger.log(`API documentation : http://${HOST}:${info.port}/docs`);
    logger.success(`Listening on      : http://${HOST}:${info.port}`);
  },
);

export default app;
