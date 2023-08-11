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
import { CannoliGraph, VerifiedCannoliCanvasData } from "src/models/graph";
import { Run, Stoppage, Usage } from "src/run";
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
		// If the file's basename ends with .cno, don't include the extension in the notice
		const name = file.basename.endsWith(".cno")
			? file.basename.slice(0, -4)
			: file.basename;

		// Check if the cannoli is already running
		if (this.runningCannolis[file.basename]) {
			new Notice(`Cannoli: ${name} is already running`);
			return;
		}

		new Notice(`Started Cannoli: ${name}`);

		// Sleep for 1.5s to give the vault time to load
		await new Promise((resolve) => setTimeout(resolve, 1500));

		const canvas = new Canvas(file);
		await canvas.fetchData();

		const factory = new CannoliFactory(canvas.getCanvasData());

		const graph = factory.getCannoliData();
		console.log(JSON.stringify(graph, null, 2));

		const shouldContinue = await this.validateCannoli(
			graph,
			file,
			name,
			canvas
		);

		if (shouldContinue) {
			await this.runCannoli(graph, file, name, canvas);
		} else {
			console.log("Run was canceled during validation");
		}
	};

	validateCannoli = async (
		graph: VerifiedCannoliCanvasData,
		file: TFile,
		name: string,
		canvas: Canvas
	) => {
		return new Promise<boolean>((resolve) => {
			// Create callback function to trigger notice
			const onFinish = (stoppage: Stoppage) => {
				console.log("Finished validation run");

				delete this.runningCannolis[file.basename];

				if (stoppage.reason === "error") {
					new Notice(
						`Cannoli ${name} failed with the error:\n\n${stoppage.message}`
					);
					resolve(false);
					return;
				}

				const onContinueCallback = () => {
					resolve(true); // Resolve with true if continued
				};

				const onCancelCallback = () => {
					resolve(false); // Resolve with false if canceled
				};

				new RunPriceAlertModal(
					this.app,
					stoppage.usage,
					onContinueCallback,
					onCancelCallback
				).open();
			};

			const validationGraph = new CannoliGraph(
				JSON.parse(JSON.stringify(graph))
			);

			// Create validation run
			const validationRun = new Run({
				graph: validationGraph.graph,
				isMock: true,
				canvas: canvas,
				vault: this.app.vault,
				onFinish: onFinish,
			});

			console.log("Starting validation run");

			validationRun.start();
		});
	};

	runCannoli = async (
		graph: VerifiedCannoliCanvasData,
		file: TFile,
		name: string,
		canvas: Canvas
	) => {
		return new Promise<void>((resolve) => {
			// Create callback function to trigger notice
			const onFinish = (stoppage: Stoppage) => {
				delete this.runningCannolis[file.basename];

				let costString = "";

				// If the cost is less than 0.01, don't show the notice
				if (stoppage.totalCost > 0.01) {
					costString = `\n$${stoppage.totalCost.toFixed(2)}`;
				}

				if (stoppage.reason === "error") {
					new Notice(
						`Cannoli ${name} failed with the error:\n\n${stoppage.message}${costString}`
					);
				} else if (stoppage.reason === "complete") {
					new Notice(`Cannoli Complete: ${name}${costString}`);
				} else {
					new Notice(`Cannoli Stopped: ${name}${costString}`);
				}

				console.log(
					`${name} finished with cost: ${stoppage.totalCost}`
				);

				// Resolve the promise to continue the async function
				resolve();
			};

			const liveGraph = new CannoliGraph(
				JSON.parse(JSON.stringify(graph))
			);

			// Create live run
			const run = new Run({
				graph: liveGraph.graph,
				openai: this.openai,
				isMock: false,
				canvas: canvas,
				vault: this.app.vault,
				onFinish: onFinish,
			});

			this.runningCannolis[file.basename] = run;

			run.start();
		});
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

export class RunPriceAlertModal extends Modal {
	usage: Usage[];
	onContinue: () => void;
	onCancel: () => void;

	constructor(
		app: App,
		usage: Record<string, Usage>,
		onContinue: () => void,
		onCancel: () => void
	) {
		super(app);
		this.usage = Object.values(usage);
		this.onContinue = onContinue;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;

		let totalCost = 0;

		for (const usageItem of this.usage) {
			totalCost += usageItem.modelUsage.totalCost;
		}

		contentEl.createEl("h1", { text: "Run Price Alert" });
		contentEl.createEl("p", {
			text: "Review the estimated usage before proceeding.",
		});

		// Convert usage object to array

		this.usage.forEach((usage) => {
			contentEl.createEl("h2", { text: `Model: ${usage.model.name}` });
			contentEl.createEl("p", {
				text: `Prompt Tokens: ${
					usage.modelUsage.promptTokens
				}, Cost: $${(
					usage.modelUsage.promptTokens * usage.model.promptTokenPrice
				).toFixed(5)}`,
			});
			contentEl.createEl("p", {
				text: `Completion Tokens: ${
					usage.modelUsage.completionTokens
				}, Cost: $${(
					usage.modelUsage.completionTokens *
					usage.model.completionTokenPrice
				).toFixed(5)}`,
			});
			contentEl.createEl("p", {
				text: `Total Cost for ${
					usage.model.name
				}: $${usage.modelUsage.totalCost.toFixed(5)}`,
			});
		});

		contentEl.createEl("h2", {
			text: `Overall Total Cost: $${totalCost.toFixed(5)}`,
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Continue")
				.setCta()
				.onClick(() => {
					this.close();
					this.onContinue();
				})
		);

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Cancel").onClick(() => {
				this.close();
				this.onCancel();
			})
		);
	}

	onClose() {
		const { contentEl } = this;
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
