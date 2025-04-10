import { Notice, Setting } from "obsidian";
import Cannoli from "src/main";

export function createSecretsSettings(
	containerEl: HTMLElement,
	plugin: Cannoli,
	display: () => void,
): void {
	containerEl.createEl("h1", { text: "Secrets" });

	new Setting(containerEl)
		.setName("Secrets")
		.setDesc(
			`These secrets will be available in all of your cannolis, using "{{secret name}}". They are not stored in the canvas, and wil not be included when you bake a cannoli.`,
		)
		.addButton((button) =>
			button.setButtonText("+ Secret").onClick(async () => {
				// Create a new secret object
				const newSecret = {
					name: "",
					value: "",
					visibility: "password",
				};
				plugin.settings.secrets.push(newSecret);
				await plugin.saveSettings();
				// Refresh the settings pane to reflect the changes
				display();
			}),
		);

	// Iterate through saved secrets and display them
	for (const secret of plugin.settings.secrets) {
		new Setting(containerEl)
			.addText((text) =>
				text
					.setValue(secret.name)
					.setPlaceholder("Secret Name")
					.onChange(async (value) => {
						secret.name = value;
						await plugin.saveSettings();
					}),
			)
			.addText((text) =>
				text
					.setValue(secret.value)
					.setPlaceholder("Secret Value")
					.onChange(async (value) => {
						secret.value = value;
						await plugin.saveSettings();
					})
					.inputEl.setAttribute(
						"type",
						secret.visibility || "password",
					),
			)
			.addButton((button) =>
				button.setButtonText("👁️").onClick(async () => {
					secret.visibility =
						secret.visibility === "password" ? "text" : "password";
					await plugin.saveSettings();
					display();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText("📋")
					.setTooltip("Copy to clipboard")
					.onClick(async () => {
						await navigator.clipboard.writeText(secret.value);
						new Notice("Secret value copied to clipboard");
					}),
			)
			.addButton((button) =>
				button
					.setButtonText("Delete")
					.setWarning()
					.onClick(async () => {
						const index = plugin.settings.secrets.indexOf(secret);
						if (index > -1) {
							plugin.settings.secrets.splice(index, 1);
							await plugin.saveSettings();
							// Refresh the settings pane to reflect the changes
							display();
						}
					}),
			);
	}
}
