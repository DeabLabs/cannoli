import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { once } from "node:events";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { bearerAuth } from "hono/bearer-auth";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadSettings, saveSettings } from "../src/settings";
import { createDefaultSettings } from "../src/utils";
import sseRouter from "../src/routes/sse";
import serversRouter from "../src/routes/servers";

const localSecret = "local-cannoli-secret";
const userAgent = "Cannoli/1.1.0 (+https://github.com/DeabLabs/cannoli)";

async function closeServer(server: HttpServer) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

// A real HTTP peer records requests on the wire and supplies deterministic MCP
// results. It never redirects the configured public Parallel URL or uses keys.
async function fixture() {
  const requests: {
    method: string;
    url: string;
    headers: Headers;
    name?: string;
  }[] = [];
  const cancellations: number[] = [];
  const pending = new Map<number, () => void>();
  const remote = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    requests.push({
      method: message.method,
      url: req.url!,
      headers: new Headers(req.headers as Record<string, string>),
      name: message.params?.name,
    });
    if (message.method === "notifications/cancelled") {
      cancellations.push(message.params.requestId);
      pending.get(message.params.requestId)?.();
    }
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result: unknown;
    if (message.method === "initialize") {
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "search-fixture", version: "1.0.0" },
      };
    } else if (message.method === "tools/list") {
      result = {
        tools: ["web_search", "web_fetch"].map((name) => ({
          name,
          description: "Deterministic search/fetch fixture",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        })),
      };
    } else if (message.method === "tools/call") {
      if (message.params.arguments.query === "wait") {
        await new Promise<void>((resolve) => pending.set(message.id, resolve));
        pending.delete(message.id);
      }
      result =
        message.params.arguments.query === "error"
          ? {
              isError: true,
              content: [{ type: "text", text: "Search unavailable" }],
            }
          : {
              content: [
                {
                  type: "text",
                  text: "Source: https://example.org/cannoli\nCannoli supports MCP search.",
                },
              ],
            };
    } else {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  remote.listen(0, "127.0.0.1");
  await once(remote, "listening");
  const remoteUrl =
    "http://127.0.0.1:" +
    (remote.address() as AddressInfo).port +
    "/mcp?fixture=search";
  const dir = await mkdtemp(join(tmpdir(), "cannoli-search-"));
  const settings = createDefaultSettings();
  settings.serverSecret = localSecret;
  const first = settings.mcpServers[0];
  assert.equal(first.type, "http");
  if (first.type !== "http") throw new Error("Expected HTTP default");
  first.url = remoteUrl;
  first.apiKey = "configured-remote-key";
  first.headers["X-Custom"] = "preserved";
  await saveSettings(settings, dir);
  const app = new Hono();
  app.use("*", bearerAuth({ token: localSecret }));
  let port = 0;
  app.use("*", async (c, next) => {
    c.set("configDir", dir);
    c.set("host", "127.0.0.1");
    c.set("port", port);
    await next();
  });
  app.route("/mcp-servers", serversRouter).route("/sse", sseRouter);
  const local = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await once(local, "listening");
  port = (local.address() as AddressInfo).port;
  const localUrl = "http://127.0.0.1:" + port;
  const clients: Client[] = [];
  return {
    dir,
    settings,
    requests,
    cancellations,
    app,
    localUrl,
    async connect() {
      const response = await fetch(localUrl + "/mcp-servers/sse", {
        headers: { Authorization: "Bearer " + localSecret },
      });
      const definitions = await response.json();
      const url = definitions.servers["Parallel Search"].url;
      const headers = { Authorization: "Bearer " + localSecret };
      const transport = new SSEClientTransport(new URL(url), {
        requestInit: { headers },
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers }),
        },
      });
      const client = new Client({ name: "cannoli-test", version: "1.0.0" });
      clients.push(client);
      await client.connect(transport);
      return client;
    },
    async close() {
      await Promise.all(clients.map((client) => client.close()));
      for (const resolve of pending.values()) resolve();
      await closeServer(local);
      await closeServer(remote);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("fresh settings enable keyless Parallel; saved choices and invalid files survive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cannoli-settings-"));
  try {
    const settings = await loadSettings(dir);
    const server = settings.mcpServers[0];
    assert.deepEqual(server, {
      id: "parallel-search",
      name: "Parallel Search",
      type: "http",
      url: "https://search.parallel.ai/mcp",
      headers: { "User-Agent": userAgent },
      enabled: true,
    });
    assert.equal(settings.proxyEnabled, false);
    settings.mcpServers = [];
    await saveSettings(settings, dir);
    assert.deepEqual((await loadSettings(dir)).mcpServers, []);
    const disabled = createDefaultSettings();
    disabled.mcpServers[0].enabled = false;
    await saveSettings(disabled, dir);
    assert.deepEqual(await loadSettings(dir), disabled);
    for (const data of [
      "{invalid",
      JSON.stringify({ mcpServers: "invalid" }),
    ]) {
      await writeFile(join(dir, "settings.json"), data);
      await assert.rejects(loadSettings(dir));
      assert.equal(await readFile(join(dir, "settings.json"), "utf8"), data);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normal resolver proxies discovery, search, fetch, credentials and errors over HTTP", async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ["web_search", "web_fetch"],
    );
    for (const name of ["web_search", "web_fetch"]) {
      const result = await client.callTool({
        name,
        arguments: { query: "Cannoli MCP" },
      });
      assert.match(JSON.stringify(result), /https:\/\/example.org\/cannoli/);
    }
    const error = await client.callTool({
      name: "web_search",
      arguments: { query: "error" },
    });
    assert.equal(error.isError, true);
    assert.match(JSON.stringify(error), /Search unavailable/);
    for (const request of f.requests) {
      assert.equal(request.url, "/mcp?fixture=search");
      assert.equal(request.headers.get("user-agent"), userAgent);
      assert.equal(
        request.headers.get("authorization"),
        "Bearer configured-remote-key",
      );
      assert.equal(request.headers.get("x-custom"), "preserved");
      assert.ok(!JSON.stringify([...request.headers]).includes(localSecret));
    }
    const server = f.settings.mcpServers[0];
    assert.equal(server.type, "http");
    if (server.type === "http")
      server.headers.authorization = "Bearer explicit-header";
    await saveSettings(f.settings, f.dir);
    const second = await f.connect();
    await second.listTools();
    assert.equal(
      f.requests.at(-1)!.headers.get("authorization"),
      "Bearer explicit-header",
    );
  } finally {
    await f.close();
  }
});

test("disabled tools and local authorization block discovery and direct connections", async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.localUrl + "/mcp-servers/sse")).status, 401);
    f.settings.mcpServers[0].enabled = false;
    await saveSettings(f.settings, f.dir);
    const headers = { Authorization: "Bearer " + localSecret };
    const list = await fetch(f.localUrl + "/mcp-servers/sse", { headers }).then(
      (r) => r.json(),
    );
    assert.deepEqual(list.servers, {});
    assert.equal(
      (await fetch(f.localUrl + "/sse/parallel-search", { headers })).status,
      403,
    );
    assert.equal(
      (
        await fetch(
          f.localUrl + "/sse/parallel-search/messages?sessionId=invalid",
          { method: "POST", headers },
        )
      ).status,
      403,
    );
    assert.deepEqual(f.requests, []);
  } finally {
    await f.close();
  }
});

test("caller cancellation and timeout reach the upstream HTTP request", async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    for (const timeout of [false, true]) {
      const controller = new AbortController();
      const before = f.cancellations.length;
      const promise = client.callTool(
        { name: "web_search", arguments: { query: "wait" } },
        CallToolResultSchema,
        timeout ? { timeout: 100 } : { signal: controller.signal },
      );
      if (!timeout) {
        const timer = setInterval(() => {
          if (f.requests.some((r) => r.method === "tools/call")) {
            clearInterval(timer);
            controller.abort();
          }
        }, 5);
      }
      await assert.rejects(promise);
      const deadline = Date.now() + 1000;
      while (f.cancellations.length === before && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(f.cancellations.length, before + 1);
    }
  } finally {
    await f.close();
  }
});

test("saved stdio servers still dispatch tools and preserve configured environment", async () => {
  const f = await fixture();
  try {
    f.settings.mcpServers = [
      {
        id: "parallel-search",
        name: "Parallel Search",
        enabled: true,
        type: "stdio",
        command: process.execPath,
        args: [new URL("./stdio-fixture.mjs", import.meta.url).pathname],
        env: { CANNOLI_TEST_VALUE: "saved-stdio-choice" },
      },
    ];
    await saveSettings(f.settings, f.dir);
    const client = await f.connect();
    assert.equal((await client.listTools()).tools[0].name, "echo");
    assert.match(
      JSON.stringify(await client.callTool({ name: "echo", arguments: {} })),
      /saved-stdio-choice/,
    );
    assert.deepEqual(f.requests, []);
  } finally {
    await f.close();
  }
});

test("explicit HTTP connection failures surface without restoring a default provider", async () => {
  const f = await fixture();
  try {
    const saved = f.settings.mcpServers[0];
    if (saved.type !== "http") throw new Error("Expected HTTP server");
    saved.url = "http://127.0.0.1:1/unavailable";
    saved.headers = { "X-Choice": "explicit" };
    await saveSettings(f.settings, f.dir);
    await assert.rejects(f.connect());
    assert.deepEqual(
      (await loadSettings(f.dir)).mcpServers,
      f.settings.mcpServers,
    );
    assert.deepEqual(f.requests, []);
  } finally {
    await f.close();
  }
});
