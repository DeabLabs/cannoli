import { GenericCompletionParams, GenericCompletionResponse } from "src/providers";
import { ChatRole } from "src/run";
import { CannoliEdge } from "../CannoliEdge";

export const chatFormatString = `---
# <u>{{role}}</u>

{{content}}`

export class ChatConverterEdge extends CannoliEdge {
    load({
        content,
        request,
    }: {
        content?: string | Record<string, string>;
        request?: GenericCompletionParams;
    }): void {
        const format = this.run.config?.chatFormatString?.toString() ?? chatFormatString;
        const messageString = "";
        let messages: GenericCompletionResponse[] = [];

        if (content && format) {
            // Convert content to messages using the format
            messages = this.stringToArray(content as string, format);
        } else {
            throw new Error(
                "Chat converter edge was loaded without a content or messages"
            );
        }

        this.setContent(messageString);
        this.setMessages(messages);
    }

    stringToArray(str: string, format: string): GenericCompletionResponse[] {
        const rolePattern = format
            .replace("{{role}}", "(System|User|Assistant)")
            .replace("{{content}}", "")
            .trim();
        const regex = new RegExp(rolePattern, "g");

        let match;
        let messages: GenericCompletionResponse[] = [];
        let lastIndex = 0;

        let firstMatch = true;

        while ((match = regex.exec(str)) !== null) {
            const [, role] = match;

            // If this is the first match and there's text before it, add that text as a 'user' message
            if (firstMatch && match.index > 0) {
                messages.push({
                    role: "user" as const,
                    content: str.substring(0, match.index).trim(),
                });
            }
            firstMatch = false;

            const start = regex.lastIndex;
            let end;
            const nextMatch = regex.exec(str);
            if (nextMatch) {
                end = nextMatch.index;
            } else {
                end = str.length;
            }
            regex.lastIndex = start;

            const content = str.substring(start, end).trim();
            const uncapRole = role.charAt(0).toLowerCase() + role.slice(1);

            messages.push({
                role: uncapRole as ChatRole,
                content,
            });

            lastIndex = end;
        }

        if (messages.length === 0) {
            messages.push({
                role: "user" as ChatRole,
                content: str.trim(),
            });
            return messages;
        }

        if (lastIndex < str.length - 1) {
            messages.push({
                role: "user" as ChatRole,
                content: str.substring(lastIndex).trim(),
            });
        }

        if (this.text.length > 0) {
            messages = this.limitMessages(messages);
        }

        return messages;
    }

    limitMessages(
        messages: GenericCompletionResponse[]
    ): GenericCompletionResponse[] {
        let isTokenBased = false;
        let originalText = this.text;

        if (originalText.startsWith("#")) {
            isTokenBased = true;
            originalText = originalText.substring(1);
        }

        const limitValue = Number(originalText);

        if (isNaN(limitValue) || limitValue < 0) {
            return messages;
        }

        let outputMessages: GenericCompletionResponse[];

        if (isTokenBased) {
            const maxCharacters = limitValue * 4;
            let totalCharacters = 0;
            let index = 0;

            for (let i = messages.length - 1; i >= 0; i--) {
                const message = messages[i];
                if (message.content) {
                    totalCharacters += message.content.length;
                }

                if (totalCharacters > maxCharacters) {
                    index = i + 1;
                    break;
                }
            }
            outputMessages = messages.slice(index);
        } else {
            outputMessages = messages.slice(-Math.max(limitValue, 1));
        }

        // Safeguard to always include at least one message
        if (outputMessages.length === 0 && messages.length > 0) {
            outputMessages = [messages[messages.length - 1]];
        }

        return outputMessages;
    }
}