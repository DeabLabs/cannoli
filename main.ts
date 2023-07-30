import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import { CannoliGraph } from "src/cannoli";

// Remember to rename these classes and interfaces!

interface CannoliSettings {
	openaiAPIKey: string;
}

const DEFAULT_SETTINGS: CannoliSettings = {
	openaiAPIKey: "Paste key here",
};

export default class Cannoli extends Plugin {
	settings: CannoliSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"brain-circuit",
			"Start this Cannoli",
			this.startCannoli
		);

		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a simple command that can be triggered anywhere
		// this.addCommand({
		// 	id: "run-active-cannoli",
		// 	name: "Start Cannoli",
		// 	callback: () => {
		// 		new SampleModal(this.app).open();
		// 	},
		// });

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CannoliSettingTab(this.app, this));

		// add a button to the dom to trigger cannoli
		setTimeout(() => {
			this.app.workspace.containerEl
				.createEl("button", {
					text: "Start Cannoli",
					cls: "cannoli-button",
				})
				.addEventListener("click", this.startCannoli);
		}, 250);

		// this.registerEvent(
		// 	this.app.workspace.on("editor-menu", (menu, editor, view) => {
		// 		menu.addItem((item) => {
		// 			item.setTitle("Open in Cannoli")
		// 				.setIcon("dot-network")
		// 				.onClick(async () => {
		// 					// Extract the selected text (this could be your group identifier)
		// 					const selection = editor.getSelection();

		// 					// Add your logic here to open this group in Cannoli
		// 					console.log(`Opening ${selection} in Cannoli`);

		// 					// You can replace the console log above with actual function call to open the group in Cannoli
		// 					// this.openInCannoli(selection);
		// 				});
		// 		});
		// 	})
		// );
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	startCannoli = async () => {
		// Get the active file
		const activeFile = this.app.workspace.getActiveFile();

		// Check if file is a .canvas file
		if (!activeFile || !activeFile.path.endsWith(".canvas")) {
			// Send notice if not a .canvas file
			new Notice("Move to a canvas file to start a Cannoli");
			return;
		}

		console.log("Starting Cannoli...");

		// Wait 200ms for recent changes to be saved
		await new Promise((resolve) => setTimeout(resolve, 1500));

		// Create a Cannoli object and initialize it
		const cannoli = new CannoliGraph(
			activeFile,
			this.settings.openaiAPIKey,
			this.app.vault
		);

		// Initialize the graph
		await cannoli.initialize(true);

		// Run the graph
		cannoli.run();

		// Send notice containing active file name
		new Notice(`Starting Cannoli on ${activeFile.path}`);
	};
}

// class SampleModal extends Modal {
// 	constructor(app: App) {
// 		super(app);
// 	}

// 	onOpen() {
// 		const { contentEl } = this;
// 		contentEl.setText("Woah!");
// 	}

// 	onClose() {
// 		const { contentEl } = this;
// 		contentEl.empty();
// 	}
// }

export class ErrorModal extends Modal {
	error: string;

	constructor(app: App, error: string) {
		super(app);
		this.error = error;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("error-modal");
		contentEl.setText(this.error);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.removeClass("error-modal");
		contentEl.empty();
	}
}

class CannoliSettingTab extends PluginSettingTab {
	plugin: Cannoli;

	constructor(app: App, plugin: Cannoli) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("OpenAI API Key")
			.setDesc(
				"This key will be used to make all openai LLM calls. Be aware that complex Cannolis, especially those with many GPT-4 calls, can be expensive to run."
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.openaiAPIKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiAPIKey = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
