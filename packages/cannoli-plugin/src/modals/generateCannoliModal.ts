import { App, Modal, Notice } from "obsidian";

export class GenerateCannoliModal extends Modal {
    promptCallback: (prompt: string) => void;

    constructor(app: App, promptCallback: (prompt: string) => void) {
        super(app);
        this.promptCallback = promptCallback;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: "Generate Cannoli" });

        const promptInput = contentEl.createEl("textarea");
        promptInput.placeholder = "Enter a prompt";
        promptInput.rows = 5;
        promptInput.style.width = "100%";

        const generateButton = contentEl.createEl("button", { text: "Generate" });
        generateButton.style.marginTop = "10px";

        generateButton.onclick = () => {
            const prompt = promptInput.value.trim();
            if (prompt) {
                this.close();
                new Notice("Generating Cannoli...");
                this.promptCallback(prompt);
            } else {
                new Notice("Please enter a prompt");
            }
        };
    }
}