import { Action } from "@deablabs/cannoli-core";
import { VaultInterface } from "src/vault_interface";

export const dataviewQuery: Action = {
  name: "dataview",
  function: async ({
    query,
    limit = 10,
    extract = true,
    includeName = true,
    includeProperties = true,
    includeLink = true,
    vaultInterface,
  }: {
    query: string;
    limit?: number;
    extract?: boolean;
    includeName?: boolean;
    includeProperties?: boolean;
    includeLink?: boolean;
    vaultInterface: VaultInterface;
  }): Promise<string[] | Error> => {
    try {
      // If the content is wrapped in a code-block, with or without the "dataview" language identifier, remove it
      if (query.startsWith("```dataview\n") || query.startsWith("```\n")) {
        // Remove the first line (code block start) and the last line (code block end)
        query = query.split("\n").slice(1, -1).join("\n");
      }

      query = query.trim();

      const results = await vaultInterface.queryDataviewList(query);
      if (results instanceof Error) {
        return results;
      }

      if (results.length > limit) {
        results.length = limit;
      }

      if (!extract) {
        return results;
      }

      const noteContents = await vaultInterface.extractNoteContents(
        results,
        includeName,
        includeProperties,
        includeLink,
        false,
      );

      return noteContents;
    } catch (error) {
      return new Error(`Search failed: ${error.message}`);
    }
  },
  argInfo: {
    query: {
      category: "arg",
    },
    limit: {
      category: "arg",
      type: "number",
    },
    extract: {
      category: "arg",
      type: "boolean",
    },
    includeName: {
      category: "arg",
      type: "boolean",
    },
    includeProperties: {
      category: "arg",
      type: "boolean",
    },
    includeLink: {
      category: "arg",
      type: "boolean",
    },
    vaultInterface: {
      category: "fileManager",
    },
  },
};
