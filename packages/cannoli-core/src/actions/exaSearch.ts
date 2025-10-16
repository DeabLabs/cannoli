import { Action } from "src/run";
import { ResponseTextFetcher } from "src/run";

export const exaSearch: Action = {
  name: "exa",
  function: async (_args): Promise<string[] | Error> => {
    const {
      query,
      EXA_API_KEY,
      limit = 10,
      fetcher,
    } = _args as {
      query: string;
      EXA_API_KEY: string;
      limit?: number;
      fetcher: ResponseTextFetcher;
    };
    try {
      const searchResponseText = await fetcher(`https://api.exa.ai/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": EXA_API_KEY,
        },
        body: JSON.stringify({
          query,
          numResults: limit,
          useAutoprompt: true,
        }),
      });

      if (searchResponseText instanceof Error) {
        throw searchResponseText;
      }

      const searchResults = JSON.parse(searchResponseText);
      const ids = searchResults.results.map(
        (result: { id: string }) => result.id,
      );

      const contentResponseText = await fetcher(`https://api.exa.ai/contents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": EXA_API_KEY,
        },
        body: JSON.stringify({ ids }),
      });

      if (contentResponseText instanceof Error) {
        throw contentResponseText;
      }

      const contents = JSON.parse(contentResponseText);
      const markdown = contents.results.map(
        (result: {
          id: string;
          url: string;
          title: string;
          author: string;
          text: string;
        }) => {
          const authorField = result.author
            ? `**Author:** ${result.author}\n\n`
            : "";
          return `# ${result.title}\n[${result.url}](${result.url})\n${authorField}${result.text}`;
        },
      );

      return markdown;
    } catch (error) {
      if (error instanceof Error) {
        return new Error(`Search failed: ${error.message}`);
      } else {
        return new Error(`Search failed: ${error}`);
      }
    }
  },
  argInfo: {
    query: {
      category: "arg",
      type: "string",
    },
    limit: {
      category: "arg",
      type: "number",
    },
    EXA_API_KEY: {
      category: "secret",
    },
    fetcher: {
      category: "fetcher",
    },
  },
  importInfo: {
    name: "exaSearch",
    path: "npm:@deablabs/cannoli-core",
  },
};
