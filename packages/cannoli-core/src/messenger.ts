import { HttpConfig } from "./models/node";

export interface Messenger {
    name: string;
    configKeys: string[];

    sendMessage(message: string, config?: HttpConfig): Promise<unknown | Error>;

    receiveMessage(shouldContinueWaiting: () => boolean, responseFromSend: unknown, config?: HttpConfig): Promise<string | Error>;
}

