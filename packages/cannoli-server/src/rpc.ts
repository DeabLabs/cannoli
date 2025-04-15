import { hc } from "hono/client";

import type { AppType } from "./server";

// this is a trick to calculate the type when compiling
const client = hc<AppType>("");
export type Client = typeof client;

export const makeCannoliServerClient = (
  ...args: Parameters<typeof hc>
): Client => hc<AppType>(...args);
