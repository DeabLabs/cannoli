import { Action } from "@deablabs/cannoli-core";
import { VaultInterface } from "src/vault_interface";

export const smartConnectionsQuery: Action = {
    name: "smart-connections",
    function: async ({
        query,
        limit = 10,
        extract = true,
        includeName = true,
        includeProperties = true,
        includeLink = true,
        vaultInterface
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
            // If the content is wrapped in a code-block, with or without the "smart-connections" language identifier, remove it
            if (query.startsWith("```smart-connections\n") || query.startsWith("```\n")) {
                // Remove the first line (code block start) and the last line (code block end)
                query = query.split('\n').slice(1, -1).join('\n');
            }

            query = query.trim();

            const noteLinks = await vaultInterface.querySmartConnections(query, limit);
            if (noteLinks instanceof Error) {
                return noteLinks;
            }

            if (!extract) {
                return noteLinks;
            }

            const noteContents = await vaultInterface.extractNoteContents(
                noteLinks,
                includeName,
                includeProperties,
                includeLink,
                false,
                false
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
        }
    }
}

