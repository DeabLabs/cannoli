import { tool } from "@langchain/core/tools";
import { safeKeyName } from "src/utility";
import { z } from "zod";

export const choiceTool = <T extends string>(choices: [T, ...T[]]) => {
  return tool(
    ({ choice }) => {
      return choice;
    },
    {
      name: "choice",
      description: "Choose one of the following options",
      schema: z.object({ choice: z.enum(choices) }),
    },
  );
};

export const noteSelectTool = <T extends string>(notes: [T, ...T[]]) => {
  return tool(
    ({ note }) => {
      return note;
    },
    {
      name: "note_select",
      description: "Select one of the following notes",
      schema: z.object({ note: z.enum(notes) }),
    },
  );
};

export const formTool = (fields: string[]) => {
  return tool(
    ({ fields }) => {
      return fields;
    },
    {
      name: "form",
      description: "Generate a value for each field",
      schema: z.object({
        ...Object.fromEntries(
          fields.map((field) => [safeKeyName(field), z.string()]),
        ),
      }),
    },
  );
};
