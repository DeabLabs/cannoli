import { SearchConfig, SearchSource } from "@deablabs/cannoli-core";
import { requestUrl } from "obsidian";

export class ExaSearchSource implements SearchSource {
	name = "exa";
	apiKey: string;
	defaultLimit: number;

	constructor(apiKey: string, defaultLimit: number) {
		this.defaultLimit = defaultLimit;
		this.apiKey = apiKey;
	}

	async search(content: string, config: SearchConfig): Promise<string[] | Error> {
		const limit = config.limit ?? this.defaultLimit;

		const response = await requestUrl({
			url: `https://api.exa.ai/search`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": `${this.apiKey}`,
			},
			body: JSON.stringify({ query: content, numResults: limit, useAutoprompt: true }),
		});

		const results = response.json.results;

		// Make an array of the ids of the results
		const ids = results.map((result: { id: string }) => result.id);

		const contentResponse = await requestUrl({
			url: `https://api.exa.ai/contents`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": `${this.apiKey}`,
			},
			body: JSON.stringify({ ids }),
		});

		const contents = contentResponse.json.results as unknown[];

		// Format the results to markdown
		const markdown = contents.map((result: { id: string, url: string, title: string, author: string, text: string }) => this.formatContentsToMarkdown(result));

		return markdown;
	}

	formatContentsToMarkdown(result: { id: string, url: string, title: string, author: string, text: string }): string {
		const authorField = result.author ? `**Author:** ${result.author}\n\n` : '';
		return `# ${result.title}\n[${result.url}](${result.url})\n${authorField}${result.text}`;
	}
}
