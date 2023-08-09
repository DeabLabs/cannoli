import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import { Configuration, OpenAIApi } from "openai";
import { Canvas } from "src/canvas";
import { CannoliFactory } from "src/factory";
import { Run, Stoppage } from "src/run";

interface CannoliSettings {
	openaiAPIKey: string;
}

const DEFAULT_SETTINGS: CannoliSettings = {
	openaiAPIKey: "Paste key here",
};

export default class Cannoli extends Plugin {
	settings: CannoliSettings;
	runningCannolis: { [key: string]: Run } = {};
	openai: OpenAIApi;

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
			this.startOrStopCannoli
		);

		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CannoliSettingTab(this.app, this));

		// Create an instance of OpenAI
		const configuration = new Configuration({
			apiKey: this.settings.openaiAPIKey,
		});
		delete configuration.baseOptions.headers["User-Agent"];

		// Create an instance of OpenAI
		this.openai = new OpenAIApi(configuration);
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

	startOrStopCannoli = async () => {
		const activeFile = this.app.workspace.getActiveFile();

		// Check if file is a .canvas file
		if (!activeFile || !activeFile.path.endsWith(".canvas")) {
			new Notice("Move to a canvas file to start a Cannoli");
			return;
		}

		// Check if the cannoli is already running
		if (this.runningCannolis[activeFile.basename]) {
			this.runningCannolis[activeFile.basename].stop();
			delete this.runningCannolis[activeFile.basename];
			return;
		}

		this.startCannoli(activeFile);
	};

	startCannoli = async (file: TFile) => {
		// Check if the cannoli is already running
		if (this.runningCannolis[file.basename]) {
			new Notice(`Cannoli: ${file.basename} is already running`);
			return;
		}

		const canvas = new Canvas(file);

		await canvas.fetchData();

		const factory = new CannoliFactory();

		const graph = factory.parse(canvas.getCanvasData());

		// Create callback function to trigger notice
		const onFinished = (stoppage: Stoppage) => {
			delete this.runningCannolis[file.basename];

			// If the file's basename ends with .cno, don't include the extension in the notice
			const name = file.basename.endsWith(".cno")
				? file.basename.slice(0, -4)
				: file.basename;

			if (stoppage.reason === "error") {
				new Notice(
					`Cannoli ${name} failed with the error: ${stoppage.message}`
				);
			} else if (stoppage.reason === "complete") {
				new Notice(`Cannoli Complete: ${name}`);
			} else {
				new Notice(`Cannoli Stopped: ${name}`);
			}
		};

		// Create validation run
		const validationRun = new Run({
			graph: graph,
			isMock: true,
			canvas: canvas,
			vault: this.app.vault,
			onFinish: onFinished,
		});

		console.log("Starting validation run");

		await validationRun.start();

		console.log("Validation run complete");

		validationRun.reset();

		// Create live run
		const run = new Run({
			graph: graph,
			openai: this.openai,
			isMock: false,
			canvas: canvas,
			vault: this.app.vault,
			onFinish: onFinished,
		});

		this.runningCannolis[file.basename] = run;

		await run.start();
	};
}

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
