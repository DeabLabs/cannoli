import { App, Modal } from "obsidian";

export class ChangelogModal extends Modal {
  paragraph: HTMLParagraphElement;
  title: string;

  constructor(app: App, paragraph: HTMLParagraphElement, title: string) {
    super(app);
    this.paragraph = paragraph;
    this.title = title;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h1", { text: this.title });
    contentEl.appendChild(this.paragraph);
  }
}
