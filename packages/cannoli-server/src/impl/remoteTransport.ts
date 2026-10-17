import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HttpServer } from "src/types";

/** Connect with the remote server's credentials, never Cannoli's local secret. */
export function createRemoteTransport(server: HttpServer) {
  const headers = new Headers(server.headers);
  if (server.apiKey && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${server.apiKey}`);
  }
  if (!headers.has("User-Agent")) {
    headers.set(
      "User-Agent",
      "Cannoli/1.1.0 (+https://github.com/DeabLabs/cannoli)",
    );
  }
  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers },
  });
}
