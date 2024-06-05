import { Messenger, HttpConfig } from "@deablabs/cannoli-core";
import CannoliDiscordBotClient from "./discord_bot_client";

export class DiscordMessenger implements Messenger {
    name = "discord";
    configKeys = ["channel"];
    private client: CannoliDiscordBotClient;

    constructor(botClient: CannoliDiscordBotClient) {
        this.client = botClient;
    }

    async sendMessage(message: string, config?: HttpConfig): Promise<string | Error> {
        try {
            const replyType = config?.requireReply === "true" ? "reply" : "next";
            const messageId = await this.client.sendMessage(config?.channel as string, message, replyType);

            return messageId;
        } catch (error) {
            // If it's a 403 error, return an error telling the user to link their vault to the bot
            if (error instanceof Error && error.message.includes("403")) {
                return new Error("Vault not linked to bot. Please link your vault to the Cannoli bot by pasting your vault key (found in Cannoli settings) into the 'link-vault' command.");
            }

            return error;
        }
    }

    receiveMessage(shouldContinueWaiting: () => boolean, responseFromSend: string, config?: HttpConfig): Promise<string | Error> {
        return new Promise((resolve, reject) => {
            this.client.waitForReply(responseFromSend, (reply) => {
                resolve(reply);
            });
        });
    }
}
