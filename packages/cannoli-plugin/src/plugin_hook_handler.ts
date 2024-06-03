import { requestUrl } from "obsidian";
import { Messenger, HttpConfig } from "@deablabs/cannoli-core";

export class CannoliHooksMessenger implements Messenger {
    name = "cannoli-hooks";
    configKeys = ["hooksApiKey"];
    private url = "https://cannoli.website/api";
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async sendMessage(message: string, config: HttpConfig): Promise<string | Error> {

        const hookId = await this.createHook(config);
        if (hookId instanceof Error) {
            return new Error(`Could not create hook: ${hookId.message}`);
        }

        // Send the message to the relay
        const response = await requestUrl(
            {
                url: `${config.relayUrl}`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    message,
                    hookId,
                }),
            }
        );
        if (response instanceof Error) {
            return new Error(`Could not send message to relay: ${response.message}`);
        }

        return hookId;
    }

    async receiveMessage(shouldContinueWaiting: () => boolean, responseFromSend: unknown): Promise<string | Error> {
        return this.getHookResponse(responseFromSend as string, shouldContinueWaiting);
    }

    async createHook(config: HttpConfig): Promise<string | Error> {
        if (this.apiKey === "") {
            return new Error("Cannoli website API key not set");
        }

        try {
            // Send POST request to /hooks
            const response = await requestUrl(
                {
                    url: `${this.url}/hooks`,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${this.apiKey}`,
                    },
                }
            );

            if (response.status !== 200) {
                return new Error(response.status.toString());
            }

            const json = response.json;

            return json.hookId;
        } catch (error) {
            return new Error(error);
        }
    }

    async getHookResponse(hookId: string, shouldContinueWaiting: () => boolean): Promise<string | Error> {
        if (this.apiKey === "") {
            return new Error("Cannoli website API key not set");
        }

        const pollInterval = 2000; // Poll every 2 seconds

        while (shouldContinueWaiting()) {
            try {
                const response = await requestUrl(
                    {
                        url: `${this.url}/hooks/${hookId}`,
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${this.apiKey}`,
                        },
                        method: "GET",
                    }
                );

                if (response.status === 200) {
                    return response.json.content;
                } else if (response.status !== 204) {
                    return new Error(`Unexpected response status: ${response.status}`);
                }
            } catch (error) {
                return new Error(error);
            }



            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Delete the hook
        await requestUrl(
            {
                url: `${this.url}/hooks/${hookId}`,
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.apiKey}`,
                },
            }
        );

        return "Polling stopped by callback";
    }
}


