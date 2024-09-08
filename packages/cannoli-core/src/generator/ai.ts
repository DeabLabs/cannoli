import Anthropic from "@anthropic-ai/sdk";
import { cannoliRecipeInstructionsPrompt, cannoliRecipeJsonPrompt, cannoliSchemaPrompt } from "./prompt";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export async function generateCannoliRecipe(prompt: string, apiKey: string): Promise<string> {
    const anthropic = new Anthropic({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true
    });

    const firstMessage: MessageParam = {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": `${prompt}\n\n${cannoliRecipeInstructionsPrompt}`
            }
        ]
    };

    const secondMessage: MessageParam = {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": cannoliRecipeJsonPrompt
            }
        ]
    };

    const planResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 8192,
        system: cannoliSchemaPrompt,
        messages: [firstMessage]
    });

    const planResponseMessage: MessageParam = {
        "role": "assistant",
        "content": planResponse.content
    };

    const jsonResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 8192,
        system: cannoliSchemaPrompt,
        messages: [firstMessage, planResponseMessage, secondMessage]
    });

    const jsonResponseContent = jsonResponse.content[0];

    if (jsonResponseContent.type !== "text") {
        throw new Error("JSON response is not text");
    }

    return jsonResponseContent.text;
}