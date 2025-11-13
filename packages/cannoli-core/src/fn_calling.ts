import { tool } from "ai";
import { safeKeyName } from "src/utility";
import { z } from "zod";

export const choiceTool = (choices: [string, ...string[]]) => {
  return tool({
    description: "Choose one of the following options",
    inputSchema: z.object({ choice: z.enum(choices) }),
    execute: async ({ choice }) => {
      return choice;
    },
  });
};

export const noteSelectTool = (notes: [string, ...string[]]) => {
  return tool({
    description: "Select one of the following notes",
    inputSchema: z.object({ note: z.enum(notes) }),
    execute: async ({ note }) => {
      return note;
    },
  });
};

export const formTool = (fields: string[]) => {
  const params = Object.fromEntries(
    fields.map((field) => [safeKeyName(field), z.string()]),
  );
  return tool({
    description: "Generate a value for each field",
    inputSchema: z.object(params),
    execute: async (args) => {
      return args;
    },
  });
};
