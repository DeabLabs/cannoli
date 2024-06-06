import { SearchConfig, SearchSource } from "@deablabs/cannoli-core";

import { VaultInterface } from "./vault_interface";

export class SmartConnectionsSearchSource implements SearchSource {
    name = "smart-connections";
    vaultInterface: VaultInterface;

    constructor(vaultInterface: VaultInterface) {
        this.vaultInterface = vaultInterface;
    }

    async search(content: string, config: SearchConfig): Promise<string[] | Error> {
        try {
            // If the content is wrapped in a code-block, with or without the "smart-connections" language identifier, remove it
            if (content.startsWith("```smart-connections\n") || content.startsWith("```\n")) {
                // Remove the first line (code block start) and the last line (code block end)
                content = content.split('\n').slice(1, -1).join('\n');
            }

            const limit = config.limit ?? 10;
            const extract = config.extract !== undefined ? config.extract === 'true' : true;
            const includeName = config.includeName !== undefined ? config.includeName === 'true' : true;
            const includeProperties = config.includeProperties !== undefined ? config.includeProperties === 'true' : true;
            const includeLink = config.includeLink !== undefined ? config.includeLink === 'true' : true;

            const noteLinks = await this.vaultInterface.querySmartConnections(content, limit);

            if (!extract) {
                return noteLinks;
            }

            console.log(`Extraction Params: ${includeName}, ${includeProperties}, ${includeLink}`);

            const noteContents = await this.vaultInterface.extractNoteContents(
                noteLinks,
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
