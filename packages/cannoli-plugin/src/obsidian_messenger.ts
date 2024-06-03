import { App, Modal, Setting } from "obsidian";
import { Messenger, HttpConfig } from "@deablabs/cannoli-core";

class MessageModal extends Modal {
    result: string;
    onSubmit: (result: string) => void;
    message: string;

    constructor(app: App, message: string, onSubmit: (result: string) => void) {
        super(app);
        this.message = message;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h1", { text: this.message });

        new Setting(contentEl)
            .setName("Response")
            .addText((text) =>
                text.onChange((value) => {
                    this.result = value;
                })
            );

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Submit")
                    .setCta()
                    .onClick(() => {
                        this.close();
                        this.onSubmit(this.result);
                    })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class ObsidianMessenger implements Messenger {
    name = "obsidian";
    configKeys = [];

    app: App;

    constructor(app: App) {
        this.app = app;
    }

    sendMessage(message: string, config?: HttpConfig): Promise<string | Error> {
        return new Promise((resolve) => {
            const onSubmit = (result: string) => {
                resolve(result);
            };

            const modal = new MessageModal(this.app, message, onSubmit);
            modal.open();
        });
    }

    async receiveMessage(shouldContinueWaiting: () => boolean, responseFromSend: string, config?: HttpConfig): Promise<string | Error> {
        // Return the result from the modal
        return responseFromSend;
    }
}
