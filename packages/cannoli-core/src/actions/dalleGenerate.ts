import { Action } from "../run";

export const dalleGenerate: Action = {
    name: "dalle",
    function: async ({
        prompt,
        OPENAI_API_KEY,
        model = "dall-e-3",
        size = "1024x1024"
    }: {
        prompt: string;
        OPENAI_API_KEY: string;
        model?: string;
        size?: string;
    }) => {
        try {
            const response = await fetch("https://api.openai.com/v1/images/generations", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                    model: model,
                    prompt: prompt,
                    n: 1,
                    size: size,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || "Unknown error");
            }

            return `![${data.data?.[0]?.revised_prompt}](${data.data?.[0]?.url})`;
        } catch (error) {
            return new Error(`Error: ${error.message}`);
        }
    },
    argInfo: {
        prompt: {
            category: "arg",
        },
        model: {
            category: "config",
        },
        size: {
            category: "config",
        },
        OPENAI_API_KEY: {
            category: "env",
        },
    },
    importInfo: {
        name: "dalleGenerate",
        path: "npm:@deablabs/cannoli-core",
    },
};
