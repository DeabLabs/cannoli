import { Action } from "src/cannoli";
import { ResponseTextFetcher } from "src/run";

export const exaSearch: Action = {
    name: "exa",
    function: async ({
        query,
        exaAPIKey,
        limit = 10,
        fetcher,
    }: {
        query: string;
        exaAPIKey: string;
        limit?: number;
        fetcher: ResponseTextFetcher;
    }): Promise<string[] | Error> => {
        try {
            const searchResponseText = await fetcher(`https://api.exa.ai/search`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": exaAPIKey,
                },
                body: JSON.stringify({ query, numResults: limit, useAutoprompt: true }),
            });

            if (searchResponseText instanceof Error) {
                throw searchResponseText;
            }

            const searchResults = JSON.parse(searchResponseText);
            const ids = searchResults.results.map((result: { id: string }) => result.id);

            const contentResponseText = await fetcher(`https://api.exa.ai/contents`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": exaAPIKey,
                },
                body: JSON.stringify({ ids }),
            });

            if (contentResponseText instanceof Error) {
                throw contentResponseText;
            }

            const contents = JSON.parse(contentResponseText);
            const markdown = contents.results.map((result: { id: string, url: string, title: string, author: string, text: string }) => {
                const authorField = result.author ? `**Author:** ${result.author}\n\n` : '';
                return `# ${result.title}\n[${result.url}](${result.url})\n${authorField}${result.text}`;
            });

            return markdown;
        } catch (error) {
            return new Error(`Search failed: ${error.message}`);
        }
    },
    argInfo: {
        query: {
            category: "arg",
            type: "string",
        },
        limit: {
            category: "config",
            type: "number",
        },
        exaAPIKey: {
            category: "env",
        },
        fetcher: {
            category: "fetcher",
        },
    },
};
