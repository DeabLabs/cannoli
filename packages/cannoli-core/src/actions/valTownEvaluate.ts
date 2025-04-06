import { Action, ResponseTextFetcher } from "src/run";

export const valTownEvaluate: Action = {
	name: "valtown-eval",
	function: async ({
		code,
		args,
		VALTOWN_API_KEY,
		fetcher,
	}: {
		code: string;
		args: Record<string, string>;
		VALTOWN_API_KEY: string;
		fetcher: ResponseTextFetcher;
	}) => {
		if (!VALTOWN_API_KEY) {
			return new Error("VALTOWN_API_KEY is required");
		}

		// Extract code blocks if present, handling optional language tags
		const codeBlocks = code.match(/```[\s\S]*?```/g);
		const codeToSend = codeBlocks
			? codeBlocks
					.map((block) =>
						block.replace(/```[\s\S]*?\n/, "").replace(/```/, ""),
					)
					.join("\n")
			: code;

		try {
			const response = await fetcher("https://api.val.town/v1/eval", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${VALTOWN_API_KEY}`,
				},
				body: JSON.stringify({
					code: codeToSend,
				}),
			});

			return response;
		} catch (error) {
			return new Error(`Error evaluating code: ${error}`);
		}
	},
	argInfo: {
		code: {
			category: "arg",
			prompt: "Ensure your code is valid JavaScript or TypeScript which directly returns a result by using immediately invoked function expressions or top-level return statements.",
		},
		args: {
			category: "extra",
			prompt: "Provide any arguments to the code block as a JSON string.",
		},
		VALTOWN_API_KEY: {
			category: "secret",
		},
		fetcher: {
			category: "fetcher",
		},
	},
	importInfo: {
		name: "valTownEvaluate",
		path: "npm:@deablabs/cannoli-core",
	},
};
