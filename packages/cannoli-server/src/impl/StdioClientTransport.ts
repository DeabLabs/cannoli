/**
 * Forked from https://github.com/punkpeye/mcp-proxy/blob/171ae9e73ba5d1109402af19f2675dbc40ddd4f6/src/StdioClientTransport.ts
 */

import {
  ReadBuffer,
  serializeMessage,
} from "@modelcontextprotocol/sdk/shared/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { ChildProcess, IOType, spawn } from "node:child_process";
import { Stream } from "node:stream";

type TransportEvent =
  | {
      type: "close";
    }
  | {
      type: "error";
      error: Error;
    }
  | {
      type: "data";
      chunk: string;
    }
  | {
      type: "message";
      message: JSONRPCMessage;
    };

export type StdioServerParameters = {
  /**
   * The executable to run to start the server.
   */
  command: string;

  /**
   * Command line arguments to pass to the executable.
   */
  args?: string[];

  /**
   * The environment to use when spawning the process.
   *
   * If not specified, the result of getDefaultEnvironment() will be used.
   */
  env: Record<string, string>;

  /**
   * How to handle stderr of the child process. This matches the semantics of Node's `child_process.spawn`.
   *
   * The default is "inherit", meaning messages to stderr will be printed to the parent process's stderr.
   */
  stderr?: IOType | Stream | number;

  /**
   * The working directory to use when spawning the process.
   *
   * If not specified, the current working directory will be inherited.
   */
  cwd?: string;

  /**
   * A function to call when an event occurs.
   */
  onEvent?: (event: TransportEvent) => void;
};

/**
 * Client transport for stdio: this will connect to a server by spawning a process and communicating with it over stdin/stdout.
 *
 * This transport is only available in Node.js environments.
 */
export class StdioClientTransport implements Transport {
  private process?: ChildProcess;
  private abortController: AbortController = new AbortController();
  private readBuffer: ReadBuffer = new ReadBuffer();
  private serverParams: StdioServerParameters;
  private onEvent?: (event: TransportEvent) => void;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(server: StdioServerParameters) {
    this.serverParams = server;
    this.onEvent = server.onEvent;
  }

  /**
   * Starts the server process and prepares to communicate with it.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(
        "StdioClientTransport already started! If using Client class, note that connect() calls start() automatically.",
      );
    }

    return new Promise((resolve, reject) => {
      this.process = spawn(
        this.serverParams.command,
        this.serverParams.args ?? [],
        {
          env: this.serverParams.env,
          stdio: ["pipe", "pipe", this.serverParams.stderr ?? "inherit"],
          shell: false,
          signal: this.abortController.signal,
          cwd: this.serverParams.cwd,
        },
      );

      this.process.on("error", (error) => {
        if (error.name === "AbortError") {
          // Expected when close() is called.
          this.onclose?.();
          return;
        }

        reject(error);
        this.onerror?.(error);
      });

      this.process.on("spawn", () => {
        resolve();
      });

      this.process.on("close", (_code) => {
        this.onEvent?.({
          type: "close",
        });

        this.process = undefined;
        this.onclose?.();
      });

      this.process.stdin?.on("error", (error) => {
        this.onEvent?.({
          type: "error",
          error,
        });

        this.onerror?.(error);
      });

      this.process.stdout?.on("data", (chunk) => {
        this.onEvent?.({
          type: "data",
          chunk: chunk.toString(),
        });

        this.readBuffer.append(chunk);
        this.processReadBuffer();
      });

      this.process.stdout?.on("error", (error) => {
        this.onEvent?.({
          type: "error",
          error,
        });

        this.onerror?.(error);
      });
    });
  }

  /**
   * The stderr stream of the child process, if `StdioServerParameters.stderr` was set to "pipe" or "overlapped".
   *
   * This is only available after the process has been started.
   */
  get stderr(): Stream | null {
    return this.process?.stderr ?? null;
  }

  private processReadBuffer() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const message = this.readBuffer.readMessage();

        if (message === null) {
          break;
        }

        this.onEvent?.({
          type: "message",
          message,
        });

        this.onmessage?.(message);
      } catch (error) {
        this.onEvent?.({
          type: "error",
          error: error as Error,
        });

        this.onerror?.(error as Error);
      }
    }
  }

  async close(): Promise<void> {
    this.onEvent?.({
      type: "close",
    });

    this.abortController.abort();
    this.process = undefined;
    this.readBuffer.clear();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process?.stdin) {
        throw new Error("Not connected");
      }

      const json = serializeMessage(message);
      if (this.process.stdin.write(json)) {
        resolve();
      } else {
        this.process.stdin.once("drain", resolve);
      }
    });
  }
}
