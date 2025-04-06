import { Action, ResponseTextFetcher } from "src/run";

export const valTownSendEmail: Action = {
	name: "valtown-email",
	function: async ({
		body,
		to = undefined,
		subject = undefined,
		html = undefined,
		VALTOWN_API_KEY,
		fetcher,
	}: {
		body: string;
		to: string | undefined;
		subject: string | undefined;
		html: string | undefined;
		VALTOWN_API_KEY: string;
		fetcher: ResponseTextFetcher;
	}) => {
		if (!VALTOWN_API_KEY) {
			return new Error("VALTOWN_API_KEY is required");
		}

		if (!body && !html) {
			return new Error("Either body or html content is required");
		}

		try {
			const response = await fetcher("https://api.val.town/v1/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${VALTOWN_API_KEY}`,
				},
				body: JSON.stringify({
					to,
					subject,
					text: body,
					html,
				}),
			});

			return response;
		} catch (error) {
			return new Error(`Error sending email: ${error}`);
		}
	},
	argInfo: {
		body: {
			category: "arg",
			prompt: "Enter the plain text content of the email",
		},
		to: {
			category: "arg",
			prompt: "Enter the recipient's email address (optional, will use account default if not provided)",
		},
		subject: {
			category: "arg",
			prompt: "Enter the subject of the email (optional)",
		},
		html: {
			category: "arg",
			prompt: "Enter the HTML content of the email (optional if body is provided)",
		},
		VALTOWN_API_KEY: {
			category: "secret",
		},
		fetcher: {
			category: "fetcher",
		},
	},
	importInfo: {
		name: "valTownSendEmail",
		path: "npm:@deablabs/cannoli-core",
	},
};
