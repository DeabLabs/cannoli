import { ModelUsage } from "@deablabs/cannoli-core";
import { App, Modal, Setting } from "obsidian";

export class RunPriceAlertModal extends Modal {
    usage: Record<string, ModelUsage>;
    onContinue: () => void;
    onCancel: () => void;
    requestThreshold: number;

    constructor(
        app: App,
        usage: Record<string, ModelUsage>,
        requestThreshold: number,
        onContinue: () => void,
        onCancel: () => void,
    ) {
        super(app);
        this.usage = usage;
        this.onContinue = onContinue;
        this.onCancel = onCancel;
        this.requestThreshold = requestThreshold;
    }

    onOpen() {
        const { contentEl } = this;

        let totalCalls = 0;
        let totalPromptTokens = 0;

        for (const usage of Object.values(this.usage)) {
            totalCalls += usage.numberOfCalls;
            totalPromptTokens += usage.promptTokens ?? 0;
        }

        contentEl.createEl("h1", { text: "Run usage alert" });
        contentEl.createEl("p", {
            text: `This run exceeds the AI requests threshold defined in your settings: ${this.requestThreshold}`,
        });

        // Convert usage object to array
        for (const [model, usage] of Object.entries(this.usage)) {
            contentEl.createEl("h2", { text: `Model: ${model}` });
            contentEl
                .createEl("p", {
                    text: `\t\tEstimated prompt tokens: ${usage.promptTokens}`,
                })
                .addClass("whitespace");
            contentEl
                .createEl("p", {
                    text: `\t\tNumber of AI requests: ${usage.numberOfCalls}`,
                })
                .addClass("whitespace");
        }

        contentEl.createEl("h2", {
            text: `Total AI requests: ${totalCalls}`,
        });

        contentEl.createEl("h2", {
            text: `Total estimated prompt tokens: ${totalPromptTokens}`,
        });

        const panel = new Setting(contentEl);

        panel.addButton((btn) =>
            btn.setButtonText("Cancel").onClick(() => {
                this.close();
                this.onCancel();
            })
        );

        panel.addButton((btn) =>
            btn
                .setButtonText("Run anyway")
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onContinue();
                })
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}