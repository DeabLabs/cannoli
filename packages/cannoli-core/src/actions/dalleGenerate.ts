import { Action } from "../run";

export const dalleGenerate: Action = {
  name: "dalle",
  function: async (_args) => {
    const {
      prompt,
      OPENAI_API_KEY,
      model = "dall-e-3",
      size = "1024x1024",
    } = _args as {
      prompt: string;
      OPENAI_API_KEY: string;
      model?: string;
      size?: string;
    };
    try {
      const response = await fetch(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: model,
            prompt: prompt,
            n: 1,
            size: size,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Unknown error");
      }

      return `![${data.data?.[0]?.revised_prompt}](${data.data?.[0]?.url})`;
    } catch (error) {
      if (error instanceof Error) {
        return new Error(`Error: ${error.message}`);
      } else {
        return new Error(`Error: ${error}`);
      }
    }
  },
  argInfo: {
    prompt: {
      category: "arg",
    },
    model: {
      category: "arg",
    },
    size: {
      category: "arg",
    },
    OPENAI_API_KEY: {
      category: "secret",
    },
  },
  importInfo: {
    name: "dalleGenerate",
    path: "npm:@deablabs/cannoli-core",
  },
};
