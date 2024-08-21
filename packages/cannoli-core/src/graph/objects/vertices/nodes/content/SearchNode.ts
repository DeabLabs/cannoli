import { EdgeType } from "src/graph";
import { z } from "zod";
import { ContentNode } from "../ContentNode";
import { defaultHttpConfig, HttpConfig, HTTPConfigSchema } from "./HttpNode";

const SearchConfigSchema = z.object({
    limit: z.coerce.number().optional(),
}).passthrough();

export type SearchConfig = z.infer<typeof SearchConfigSchema>;

export class SearchNode extends ContentNode {
    logDetails(): string {
        return super.logDetails() + `Subtype: Search\n`;
    }

    async execute(): Promise<void> {
        const overrides = this.getConfig(HTTPConfigSchema) as HttpConfig;
        if (overrides instanceof Error) {
            this.error(overrides.message);
            return;
        }

        const config = { ...defaultHttpConfig, ...overrides };

        this.executing();

        const content = await this.processReferences([], true);

        if (this.run.isMock) {
            this.loadOutgoingEdges("[Mock response]");
            this.completed();
            return;
        }

        let output: string;

        const results = await this.search(content, config);

        if (results instanceof Error) {
            if (config.catch) {
                this.error(results.message);
                return;
            }
            output = results.message;
        } else {
            // If there are any outgoing edges of type Item from this node, output should be a stringified json array
            if (this.outgoingEdges.some((edge) => this.graph[edge].type === EdgeType.Item)) {
                output = JSON.stringify(results);
            } else {
                output = results.join("\n\n");
            }
        }

        this.loadOutgoingEdges(output);
        this.completed();
    }

    async search(query: string, config: SearchConfig): Promise<string[] | Error> {
        return new Error("Search nodes not implemented.");
    }
}