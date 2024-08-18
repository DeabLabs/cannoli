import { App, Modal } from "obsidian";

export class Version2Modal extends Modal {
    paragraph: HTMLParagraphElement;

    constructor(app: App, paragraph: HTMLParagraphElement) {
        super(app);
        this.paragraph = paragraph;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h1", { text: "Cannoli 2.0" });
        contentEl.appendChild(this.paragraph);
    }
}