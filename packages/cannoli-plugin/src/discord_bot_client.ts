import { requestUrl } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import NodeRSA from 'node-rsa';
import Cannoli from "./main";

class CannoliDiscordBotClient {
    private plugin: Cannoli;
    private eventSource: EventSource | null = null;

    // This will have to be stored in the cannoli runs eventually
    private replyCallbacks: Map<string, (content: string) => void> = new Map();

    constructor(plugin: Cannoli) {
        this.plugin = plugin;
    }

    private generateVaultKey(): string {
        return uuidv4();
    }

    private generateRSAKeyPair(): { privateKey: NodeRSA, publicKey: string } {
        const rsa = new NodeRSA({ b: 2048 });
        rsa.setOptions({ encryptionScheme: 'pkcs1' }); // Set the encryption scheme to pkcs1

        const key = rsa.generateKeyPair();
        const privateKey = key;
        const publicKey = key.exportKey('pkcs8-public-pem'); // Export public key in pkcs8 format
        return { privateKey, publicKey };
    }

    async initializeVault(): Promise<{ vaultKey: string, vaultID: string, privateKey: string, publicKey: string }> {
        // Generate a new vault key and RSA key pair
        const vaultKey = this.generateVaultKey();

        let privateKey, publicKey;
        try {
            ({ privateKey, publicKey } = this.generateRSAKeyPair());
        } catch (error) {
            console.error("Error generating new RSA key pair:", error);
            throw new Error("Failed to generate new RSA key pair");
        }

        const exportedPrivateKey = privateKey.exportKey('pkcs1-private-pem');
        const exportedPublicKey = publicKey;


        try {
            const response = await requestUrl({
                url: `${this.plugin.settings.discordBotUrl}/initialize-vault`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.plugin.settings.discordBotKey}`,
                },
                body: JSON.stringify({ vaultKey, publicKey: exportedPublicKey }),
            });

            if (response.json.status === "initialized") {
                return {
                    vaultKey,
                    vaultID: response.json.vaultID,
                    privateKey: exportedPrivateKey,
                    publicKey: exportedPublicKey
                };
            } else {
                throw new Error("Failed to initialize vault: " + response.json.message);
            }
        } catch (error) {
            console.error("Error initializing vault:", error);
            throw new Error("Failed to initialize vault due to network error");
        }
    }

    async sendMessage(channel: string, content: string, replyType: "next" | "reply"): Promise<string | Error> {
        if (!this.plugin.settings.discordVaultID || !this.plugin.settings.discordVaultKey) {
            return new Error("Vault not connected to bot");
        }

        console.log(JSON.stringify({ channel, content, replyType }));

        const response = await requestUrl({
            url: `${this.plugin.settings.discordBotUrl}/send-message/${this.plugin.settings.discordVaultID}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.plugin.settings.discordVaultKey}`,
            },
            body: JSON.stringify({ channel, content, replyType }),
        });

        return response.json.status === "message sent" ? response.json.messageID : new Error("Failed to send message");
    }

    async createCommand(name: string, description: string, args: string[]): Promise<string> {
        if (!this.plugin.settings.discordVaultID || !this.plugin.settings.discordVaultKey) {
            throw new Error("Vault not connected to bot");
        }

        const response = await requestUrl({
            url: `${this.plugin.settings.discordBotUrl}/create-command/${this.plugin.settings.discordVaultID}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.plugin.settings.discordVaultKey}`,
            },
            body: JSON.stringify({ name, description, args }),
        });

        return response.json.status === "command created" ? response.json.commandId : null;
    }

    connect(): void | Error {
        try {
            this.eventSource = new EventSource(`${this.plugin.settings.discordBotUrl}/listen/${this.plugin.settings.discordVaultID}`);
        } catch (error) {
            return new Error("Failed to start listening to Discord bot");
        }

        this.eventSource.onmessage = (event) => {
            if (event.data === "Connection established") {
                return;
            }

            const encryptedData = event.data;
            const decryptedData = this.decryptEvent(encryptedData);

            let data;
            try {
                data = JSON.parse(decryptedData);
            } catch (error) {
                return;
            }

            console.log("Callbacks on reply receive: ", this.replyCallbacks);
            if (data.type === "reply" && this.replyCallbacks.has(data.id)) {
                const callback = this.replyCallbacks.get(data.id);
                if (callback) {
                    callback(data.content);
                    this.replyCallbacks.delete(data.id);
                }
            }
        };

        this.eventSource.onerror = (err) => {
            console.error("SSE error:", err);
            this.eventSource?.close();
            this.eventSource = null;
        };
    }

    disconnect(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    private decryptEvent(encryptedData: string): string {
        if (!this.plugin.settings.discordPrivateKey) {
            throw new Error("Private key not initialized");
        }
        const privateKey = new NodeRSA(this.plugin.settings.discordPrivateKey);
        privateKey.setOptions({ encryptionScheme: 'pkcs1' }); // Ensure pkcs1 scheme
        const decrypted = privateKey.decrypt(encryptedData, 'utf8');
        return decrypted;
    }

    async waitForReply(messageId: string, callback: (content: string) => void): Promise<void> {
        if (!this.plugin.settings.discordVaultID || !this.plugin.settings.discordVaultKey) {
            throw new Error("Vault not connected to bot");
        }

        console.log("Setting callback for message ID: ", messageId);

        this.replyCallbacks.set(messageId, callback);
        console.log("Callbacks on message send: ", this.replyCallbacks);
    }

    async deleteVault(): Promise<void | Error> {
        try {
            const response = await requestUrl({
                url: `${this.plugin.settings.discordBotUrl}/delete-vault/${this.plugin.settings.discordVaultID}`,
                method: "DELETE",
                headers: {
                    "Authorization": `Bearer ${this.plugin.settings.discordVaultKey}`,
                },
            });

            if (response.json.status === "vault deleted") {
                return;
            } else {
                return new Error("Failed to delete vault: " + response.json.message);
            }
        } catch (error) {
            // If the vault is already deleted, just return
            if (error.status === 404) {
                return;
            }

            console.error("Error deleting vault:", error);
            return new Error("Failed to delete vault due to network error");
        }
    }
}

export default CannoliDiscordBotClient;
