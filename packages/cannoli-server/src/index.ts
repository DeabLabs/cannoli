#!/usr/bin/env node

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import * as path from "node:path";
import { getConfigDir } from "./utils";
import { ServerInfo } from "./types";
import { AppVariables } from "./types/context";

// Import routers
import statusRouter from "./routes/status";
import mcpServersRouter from "./routes/servers";
import settingsRouter from "./routes/settings";

// Create the app
const app = new Hono<{ Variables: AppVariables }>();
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
	},
);

export default app;
