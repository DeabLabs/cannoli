import { z } from "zod";
import { parseArgs, ParseArgsConfig } from "node:util";
import { getConfigDir } from "src/utils";

export const optionsDefinition = {
  verbose: {
    type: "boolean",
    short: "v",
    default: false,
  },
  port: {
    type: "string",
    short: "p",
    default: "3333",
  },
  host: {
    type: "string",
    default: "localhost",
  },
  "config-dir": {
    type: "string",
    short: "c",
    default: getConfigDir(),
  },
  help: {
    type: "boolean",
    short: "h",
    default: false,
  },
} satisfies ParseArgsConfig["options"];

const { values } = parseArgs({ options: optionsDefinition });

const optionsSchema = z.object({
  verbose: z.boolean(),
  port: z.string(),
  host: z.string(),
  "config-dir": z.string(),
  help: z.boolean(),
});

export type ArgumentsConfig = z.infer<typeof optionsSchema>;

export const argumentsConfig = optionsSchema.parse(values);
