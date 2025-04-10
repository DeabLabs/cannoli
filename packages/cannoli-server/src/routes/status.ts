import { Context, Hono } from "hono";
import * as path from "node:path";
import { loadSettings } from "../settings";
import { AppVariables } from "../types/context";

// Create a router for status endpoints
const router = new Hono<{ Variables: AppVariables }>();

// Get status endpoint
router.get("/", async (c) => {
	const configDir = c.get("configDir");
	try {
		const settings = await loadSettings(configDir);
		const settingsFile = path.join(configDir, "settings.json");

		return c.json({
			status: "ok",
			version: "1.0.0",
			settings,
			configPath: settingsFile,
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
});

// For backward compatibility
export async function getStatus(
	c: Context,
	configDir: string,
): Promise<Response> {
	try {
		const settings = await loadSettings(configDir);
		const settingsFile = path.join(configDir, "settings.json");

		return c.json({
			status: "ok",
			version: "1.0.0",
			settings,
			configPath: settingsFile,
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
