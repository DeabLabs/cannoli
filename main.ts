import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
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
	runningCannolis: { [key: string]: CannoliGraph } = {};

	async onload() {
		await this.loadSettings();

		this.createCannoliCommands();

		// Rerun the createCannoliCommands function whenever a file is renamed to be a cannoli file
		this.app.vault.on("rename", (file: TFile, oldPath: string) => {
			if (file.name.includes(".cno.canvas")) {
				this.createCannoliCommands();
			}
		});

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"brain-circuit",
			"Start/Stop this Cannoli",
			this.startActiveCannoli
		);

		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CannoliSettingTab(this.app, this));
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

	createCannoliCommands = async () => {
		// Sleep for 0.5s to give the vault time to load
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Get all files that contain ".cno.canvas" in their name
		const cannoliFiles = this.app.vault.getFiles().filter((file) => {
			return file.name.includes(".cno.canvas");
		});

		console.log(`Found ${cannoliFiles.length} cannoli files.`);

		// Create a command for each cannoli file
		cannoliFiles.forEach((file) => {
			this.addCommand({
				id: `run-cannoli-${file.path}`,
				name: `Run ${file.basename.slice(0, -4)}`,
				callback: async () => {
					this.startCannoli(file);
				},
			});
		});
	};

	startActiveCannoli = async () => {
		const activeFile = this.app.workspace.getActiveFile();

		// Check if file is a .canvas file
		if (!activeFile || !activeFile.path.endsWith(".canvas")) {
			new Notice("Move to a canvas file to start a Cannoli");
			return;
		}

		this.startCannoli(activeFile);
	};

	startCannoli = async (file: TFile) => {
		const cannoli = new CannoliGraph(
			file,
			this.settings.openaiAPIKey,
			this.app.vault
		);

		await cannoli.initialize(true);

		// Create callback function to trigger notice
		const onCompleteCallback = () => {
			// If the file's basename ends with .cno, don't include the extension in the notice
			if (file.basename.endsWith(".cno")) {
				new Notice(`Cannoli Complete: ${file.basename.slice(0, -4)}`);
			} else {
				new Notice(`Cannoli Complete: ${file.basename}`);
			}
		};

		// Create error callback function to trigger error notice
		const onErrorCallback = (error: Error) => {
			if (file.basename.endsWith(".cno")) {
				new Notice(`Cannoli Failed: ${file.basename.slice(0, -4)}`);
			} else {
				new Notice(`Cannoli Failed: ${file.basename}`);
			}
		};

		cannoli.run(onCompleteCallback, onErrorCallback);

		// const activeFilePath = activeFile.path;
		// const currentCannoli = this.runningCannolis[activeFilePath];

		// if (currentCannoli) {
		// 	// Stop the existing cannoli and remove it from the map
		// 	currentCannoli.stop();
		// 	delete this.runningCannolis[activeFilePath];
		// 	new Notice(`Stopped Cannoli on ${activeFilePath}`);
		// } else {
		// 	// Start a new cannoli
		// 	console.log("Starting Cannoli...");
		// 	await new Promise((resolve) => setTimeout(resolve, 1500));

		// 	const cannoli = new CannoliGraph(
		// 		activeFile,
		// 		this.settings.openaiAPIKey,
		// 		this.app.vault
		// 	);

		// 	cannoli.setOnCompleteCallback(() => {
		// 		delete this.runningCannolis[activeFilePath];
		// 	});

		// 	await cannoli.initialize(true);
		// 	cannoli.run();

		// 	this.runningCannolis[activeFilePath] = cannoli;
		// 	new Notice(`Starting Cannoli on ${activeFilePath}`);
		// }
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
