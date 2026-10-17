import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const results = {
    initialize: {
      protocolVersion: message.params?.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "stdio-fixture", version: "1.0.0" },
    },
    "tools/list": {
      tools: [
        { name: "echo", inputSchema: { type: "object", properties: {} } },
      ],
    },
    "tools/call": {
      content: [{ type: "text", text: process.env.CANNOLI_TEST_VALUE }],
    },
  };
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: results[message.method],
    }) + "\n",
  );
});
