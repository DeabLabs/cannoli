import { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import {
  type JSONRPCMessage,
  JSONRPCMessageSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Context } from "hono";
import { SSEStreamingApi } from "hono/streaming";
import { nanoid } from "nanoid";
import { URL } from "url";
import { z } from "zod";

/**
 * Server transport for SSE: this will send messages over an SSE connection and receive messages from HTTP POST requests.
 *
 * This transport is only available in Node.js environments.
 */
export class SSEServerTransport implements Transport {
  private _sessionId: string;
  private stream: SSEStreamingApi | undefined;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  /**
   * Creates a new SSE server transport, which will direct the client to POST messages to the relative or absolute URL identified by `_endpoint`.
   */
  constructor(
    private _endpoint: string,
    private _stream: SSEStreamingApi,
  ) {
    this._sessionId = nanoid(32);
  }

  /**
   * Handles the initial SSE connection request.
   *
   * This should be called when a GET request is made to establish the SSE stream.
   */
  async start(): Promise<void> {
    if (this.stream) {
      throw new Error(
        "SSEServerTransport already started! If using Server class, note that connect() calls start() automatically.",
      );
    }

    this.stream = this._stream;

    // Send the endpoint event
    // Use a dummy base URL because this._endpoint is relative.
    // This allows using URL/URLSearchParams for robust parameter handling.
    const dummyBase = "http://localhost"; // Any valid base works
    const endpointUrl = new URL(this._endpoint, dummyBase);
    endpointUrl.searchParams.set("sessionId", this._sessionId);

    // Reconstruct the relative URL string (pathname + search + hash)
    const relativeUrlWithSession =
      endpointUrl.pathname + endpointUrl.search + endpointUrl.hash;

    this.stream.writeSSE({
      event: "endpoint",
      data: relativeUrlWithSession,
    });

    this.stream.onAbort(() => {
      this.onclose?.();
    });
  }

  /**
   * Handles incoming POST messages.
   *
   * This should be called when a POST request is made to send a message to the server.
   */
  async handlePostMessage(c: Context): Promise<Response> {
    if (!this.stream) {
      const message = "SSE connection not established";
      return c.text(message, 500);
    }

    let body: unknown;
    try {
      const ct = z
        .literal("application/json")
        .parse(c.req.header("content-type") ?? "");
      if (ct !== "application/json") {
        return c.text("Unsupported content-type", 400);
      }

      body = await c.req.json();
    } catch (error) {
      return c.text(String(error), 400);
    }

    try {
      await this.handleMessage(
        typeof body === "string" ? JSON.parse(body) : body,
      );
    } catch {
      return c.text(`Invalid message: ${body}`, 400);
    }

    return c.text("Accepted", 202);
  }

  /**
   * Handle a client message, regardless of how it arrived. This can be used to inform the server of messages that arrive via a means different than HTTP POST.
   */
  async handleMessage(message: unknown): Promise<void> {
    let parsedMessage: JSONRPCMessage;
    try {
      parsedMessage = JSONRPCMessageSchema.parse(message);
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }

    this.onmessage?.(parsedMessage);
  }

  async close(): Promise<void> {
    this.stream?.close();
    this.stream = undefined;
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.stream) {
      throw new Error("Not connected");
    }

    this.stream.writeSSE({
      event: "message",
      data: JSON.stringify(message),
    });
  }

  /**
   * Returns the session ID for this transport.
   *
   * This can be used to route incoming POST requests.
   */
  get sessionId(): string {
    return this._sessionId;
  }
}
