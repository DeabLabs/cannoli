import { App, Modal, Setting } from "obsidian";

export class EditValModal extends Modal {
	onContinue: () => void;
	onCancel: () => void;

	constructor(app: App, onContinue: () => void, onCancel: () => void) {
		super(app);
		this.onContinue = onContinue;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h1", { text: "Val Already Exists" });

		contentEl.createEl("p", {
			text: "A Val with this name already exists. Would you like to update the existing Val with the new content?",
		});

		const panel = new Setting(contentEl);
		panel.addButton((btn) =>
			btn
				.setButtonText("Yes, Update")
				.setCta()
				.onClick(() => {
					this.close();
					this.onContinue();
				}),
		);
		panel.addButton((btn) =>
			btn.setButtonText("No, Cancel").onClick(() => {
				this.close();
				this.onCancel();
			}),
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
