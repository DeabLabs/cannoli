import { requestUrl } from "obsidian";
import { Messenger, HttpConfig } from "@deablabs/cannoli-core";


export class DiscordMessenger implements Messenger {
    name = "discord";
    configKeys = ["channel"];
    url = "http://localhost:3000";

    async sendMessage(message: string, config?: HttpConfig): Promise<string | Error> {
        // Use requestUrl to send a request to localhost 3000 with the body including the message and channelId

        let requireReply = true;

        if (config?.requireReply !== undefined) {
            // Coerce requireReply to from string to boolean
            requireReply = config?.requireReply === "true";
        }

        const response = await requestUrl({
            url: `${this.url}/send-message`,
            method: "POST", headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ message, channel: config?.channel, requireReply }),
        });

        return response.json.id;
    }
    async receiveMessage(shouldContinueWaiting: () => boolean, responseFromSend: string, config?: HttpConfig): Promise<string | Error> {
        const pollInterval = 2000; // Poll every 2 seconds

        let requireReply = true;

        if (config?.requireReply !== undefined) {
            // Coerce requireReply to from string to boolean
            requireReply = config?.requireReply === "true";
        }

        while (shouldContinueWaiting()) {
            try {
                const response = await requestUrl(
                    {
                        url: `${this.url}/receive-reply`,
                        headers: {
                            "Content-Type": "application/json",
                        },
                        method: "POST",
                        body: JSON.stringify({ id: responseFromSend, requireReply }),
                    }
                );

                if (response.status === 200) {
                    return response.json.reply;
                } else if (response.status !== 204) {
                    return new Error(`Unexpected response status: ${response.status}`);
                }
            } catch (error) {
                return new Error(error);
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Delete the hook
        // await requestUrl(
        //     {
        //         url: `${this.url}/hooks/${hookId}`,
        //         method: "DELETE",
        //         headers: {
        //             "Content-Type": "application/json",
        //         },
        //     }
        // );

        return "Polling stopped by callback";
    }
}


