#!/usr/bin/env node

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import * as path from "node:path";
import { getConfigDir } from "./utils";
import { AppContext, ServerInfo } from "./types";
import { openAPISpecs } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";

// Import routers
import statusRouter from "./routes/status";
import mcpServersRouter from "./routes/servers";
import settingsRouter from "./routes/settings";

declare module "hono" {
	interface ContextVariableMap {
		configDir: string;
	}
}

// Create the app
const app = new Hono();
app.use("*", logger());
app.use("*", cors());

// Configuration
const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT || 3333;
const CONFIG_DIR = getConfigDir();
const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");

// Middleware to add configDir to context
app.use("*", (c, next) => {
	c.set("configDir", CONFIG_DIR);
	return next();
});

// Mount the routers
app.route("/status", statusRouter);
app.route("/mcp-servers", mcpServersRouter);
app.route("/settings", settingsRouter);

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
