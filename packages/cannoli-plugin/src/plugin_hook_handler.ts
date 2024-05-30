import { Receiver } from "@deablabs/cannoli-core";
import { requestUrl } from "obsidian";

export class PluginHookHandler implements Receiver {
    private cannoliWebsiteAPIKey: string;
    private url = "https://cannoli.website";

    constructor(cannoliWebsiteAPIKey: string) {
        this.cannoliWebsiteAPIKey = cannoliWebsiteAPIKey;
    }

    async createHook(isMock: boolean | undefined): Promise<string | Error> {
        if (isMock) {
            return "mock_hook_id";
        }

        if (this.cannoliWebsiteAPIKey === "") {
            return new Error("Cannoli website API key not set");
        }

        try {
            // Send request to hooks/create
            const response = await requestUrl(
                {
                    url: `${this.url}/hooks/new`,
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${this.cannoliWebsiteAPIKey}`,
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

    async getHookResponse(hookId: string, isMock: boolean | undefined, shouldContinueWaiting: () => boolean): Promise<string | Error> {
        if (isMock) {
            return Promise.resolve("mock_hook_response");
        }

        if (this.cannoliWebsiteAPIKey === "") {
            return new Error("Cannoli website API key not set");
        }

        const pollInterval = 2000; // Poll every 2 seconds

        while (shouldContinueWaiting()) {
            try {
                const response = await requestUrl(
                    {
                        url: `${this.url}/hooks/receive/${hookId}`,
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${this.cannoliWebsiteAPIKey}`,
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
                url: `${this.url}/hooks/delete/${hookId}`,
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.cannoliWebsiteAPIKey}`,
                },
            }
        );

        return "Polling stopped by callback";
    }
}


