import { SearchConfig, SearchSource } from "@deablabs/cannoli-core";

import { VaultInterface } from "./vault_interface";

export class DataviewSearchSource implements SearchSource {
    name = "dataview";
    vaultInterface: VaultInterface;

    constructor(vaultInterface: VaultInterface) {
        this.vaultInterface = vaultInterface;
    }

    async search(content: string, config: SearchConfig): Promise<string[] | Error> {
        try {
            // If the content is wrapped in a code-block, with or without the "dataview" language identifier, remove it
            if (content.startsWith("```dataview\n") || content.startsWith("```\n")) {
                // Remove the first line (code block start) and the last line (code block end)
                content = content.split('\n').slice(1, -1).join('\n');
            }

            content = content.trim();

            const limit = config.limit ?? 50;
            const extract = config.extract !== undefined ? config.extract === 'true' : true;
            const includeName = config.includeName !== undefined ? config.includeName === 'true' : true;
            const includeProperties = config.includeProperties !== undefined ? config.includeProperties === 'true' : true;
            const includeLink = config.includeLink !== undefined ? config.includeLink === 'true' : true;

            const results = await this.vaultInterface.queryDataviewList(content);
            if (results instanceof Error) {
                return results;
            }

            if (results.length > limit) {
                results.length = limit;
            }

            if (!extract) {
                return results;
            }

            const noteContents = await this.vaultInterface.extractNoteContents(
                results,
                includeName,
                includeProperties,
                includeLink,
                false
            );

            return noteContents;
        } catch (error) {
            return new Error(`Search failed: ${error.message}`);
        }
    }
}
