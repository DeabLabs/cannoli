import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	RequestUrlParam,
	Setting,
	TFile,
	addIcon,
	requestUrl,
} from "obsidian";
import { Canvas } from "src/canvas";
import { CannoliFactory } from "src/factory";
import { CannoliGraph, VerifiedCannoliCanvasData } from "src/models/graph";
import { Run, Stoppage, Usage } from "src/run";
import { cannoliCollege } from "assets/cannoliCollege";
import { cannoliIcon } from "assets/cannoliIcon";
import { GenericModelConfig, LLMProvider, SupportedProviders } from "src/providers";
import invariant from "tiny-invariant";

interface CannoliSettings {
	llmProvider: SupportedProviders;
	ollamaBaseUrl: string;
	ollamaModel: string;
	geminiModel: string;
	geminiAPIKey: string;
	anthropicModel: string;
	anthropicAPIKey: string;
	groqModel: string;
	groqAPIKey: string;
	openaiAPIKey: string;
	costThreshold: number;
	defaultModel: string;
	defaultTemperature: number;
	httpTemplates: HttpTemplate[];
	includeFilenameAsHeader: boolean;
	includePropertiesInExtractedNotes: boolean;
	chatFormatString: string;
	enableAudioTriggeredCannolis?: boolean;
	deleteAudioFilesAfterAudioTriggeredCannolis?: boolean;
	transcriptionPrompt?: string;
	autoScrollWithTokenStream: boolean;
	pLimit: number;
	contentIsColorless: boolean;
}

const DEFAULT_SETTINGS: CannoliSettings = {
	llmProvider: "openai",
	ollamaBaseUrl: "http://127.0.0.1:11434",
	ollamaModel: "llama2",
	geminiModel: "gemini-1.0-pro-latest",
	geminiAPIKey: "",
	anthropicModel: "claude-3-opus-20240229",
	anthropicAPIKey: "",
	groqModel: "llama3-70b-8192",
	groqAPIKey: "",
	openaiAPIKey: "",
	costThreshold: 0.5,
	defaultModel: "gpt-3.5-turbo",
	defaultTemperature: 1,
	httpTemplates: [],
	includeFilenameAsHeader: false,
	includePropertiesInExtractedNotes: false,
	chatFormatString: `---\n# <u>{{role}}</u>\n\n{{content}}`,
	enableAudioTriggeredCannolis: false,
	deleteAudioFilesAfterAudioTriggeredCannolis: false,
	autoScrollWithTokenStream: false,
	pLimit: 50,
	contentIsColorless: false,
};

export interface HttpTemplate {
	id: string;
	name: string;
	url: string;
	headers: Record<string, string>;
	method: string;
	bodyTemplate?: string;
}

export default class Cannoli extends Plugin {
	settings: CannoliSettings;
	runningCannolis: { [key: string]: Run } = {};

	async onload() {
		await this.loadSettings();

		// Create a command whenever a file is renamed to be a cannoli file
		this.registerEvent(
			this.app.vault.on("rename", (file: TFile, oldPath: string) => {
				if (file.name.includes(".cno.canvas")) {
					this.createCannoliCommandForFile(file);
				}
			})
		);

		// Create a command whenever a file is created and is a cannoli file
		this.registerEvent(
			this.app.vault.on("create", (file: TFile) => {
				if (file.name.includes(".cno.canvas")) {
					this.createCannoliCommandForFile(file);
				}
			})
		);

		// Call "newAudioFile" whenever a new audio file is created
		this.registerEvent(
			this.app.vault.on("create", (file: TFile) => {
				if (
					// flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm.
					this.settings.enableAudioTriggeredCannolis &&
					(file.name.includes(".flac") ||
						file.name.includes(".mp3") ||
						file.name.includes(".mp4") ||
						file.name.includes(".mpeg") ||
						file.name.includes(".mpga") ||
						file.name.includes(".m4a") ||
						file.name.includes(".ogg") ||
						file.name.includes(".wav") ||
						file.name.includes(".webm"))
				) {
					this.newAudioFile(file);
				}
			})
		);

		addIcon("cannoli", cannoliIcon);

		// Add command for running a cannoli
		this.createStartCommand();

		this.createCannoliCommands();

		// This creates an icon in the left ribbon.
		this.addRibbonIcon(
			"cannoli",
			"Start/stop cannoli",
			this.startActiveCannoliCommand
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CannoliSettingTab(this.app, this));
	}

	onunload() { }

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
			this.createCannoliCommandForFile(file);
		});
	};

	createCannoliCommandForFile = async (file: TFile) => {
		this.addCommand({
			id: `run-cannoli-${file.path}`,
			name: `Run ${file.basename.slice(0, -4)}`,
			callback: async () => {
				this.startCannoli(file);
			},
			icon: "cannoli",
		});
	};

	createStartCommand = () => {
		this.addCommand({
			id: "start",
			name: "Start/stop cannoli",
			checkCallback: this.startCannoliCommand,
			icon: "cannoli",
		});
	};

	startActiveCannoliCommand = () => {
		this.startCannoliCommand(false);
	};

	startCannoliCommand = (checking: boolean) => {
		const activeFile = this.app.workspace.getActiveFile();

		const isMDFile = activeFile?.path.endsWith(".md");

		const isCanvasFile = activeFile?.path.endsWith(".canvas");

		if (!activeFile) return false;

		if (isMDFile) {
			if (checking) return true;

			this.app.fileManager.processFrontMatter(
				activeFile,
				(frontmatter) => {
					if (frontmatter.cannoli) {
						// Get the file
						// Only take before the first pipe, if there is one
						const filename = frontmatter.cannoli
							.replace("[[", "")
							.replace("]]", "")
							.split("|")[0];

						const file =
							this.app.metadataCache.getFirstLinkpathDest(
								filename,
								""
							);

						if (!file) {
							return null;
						}

						this.startOrStopCannoli(file);
					}
				}
			);
		} else if (isCanvasFile) {
			if (checking) return true;

			this.startOrStopCannoli(activeFile);
		} else {
			return false;
		}
	};

	startOrStopCannoli = async (cannoli: TFile) => {
		// Check if file is a .canvas file
		if (!cannoli || !cannoli.path.endsWith(".canvas")) {
			new Notice("This file is not a canvas");
			return;
		}

		// Check if the cannoli is already running
		if (this.runningCannolis[cannoli.basename]) {
			this.runningCannolis[cannoli.basename].stop();
			delete this.runningCannolis[cannoli.basename];
			return;
		}

		this.startCannoli(cannoli);
	};

	newAudioFile = async (audio: TFile) => {
		// Get the current active file
		const activeFile = this.app.workspace.getActiveFile();

		// If it isn't a markdown file, return
		if (!activeFile || !activeFile.path.endsWith(".md")) {
			return;
		}

		// If the current file doesn't have a cannoli in the frontmatter, return
		this.app.fileManager.processFrontMatter(
			activeFile,
			async (frontmatter) => {
				if (frontmatter.cannoli) {
					// Get the file
					// Only take before the first pipe, if there is one
					const cannoliFilename = frontmatter.cannoli
						.replace("[[", "")
						.replace("]]", "")
						.split("|")[0];

					// If the file isn't a canvas file, return
					if (!cannoliFilename.endsWith(".canvas")) {
						return null;
					}

					const cannoliFile =
						this.app.metadataCache.getFirstLinkpathDest(
							cannoliFilename,
							""
						);

					if (!cannoliFile) {
						return null;
					}

					await this.replaceAudioWithTranscript(activeFile, audio);

					this.startCannoli(cannoliFile);
				} else {
					return null;
				}
			}
		);
	};

	async replaceAudioWithTranscript(file: TFile, audio: TFile) {
		// Transcribe the audio
		const transcript = await this.generateTranscript(audio);

		if (!transcript) {
			return;
		}

		// Max number of polling attempts
		const maxAttempts = 50;
		// Time delay between polling attempts in milliseconds
		const delay = 100;
		let attempts = 0;

		// Function to check if the reference exists in the content
		const checkReferenceExists = async () => {
			let exists = false;
			await this.app.vault.process(file, (content) => {
				exists = content.includes(`![[${audio.name}]]`);
				return content; // No modification
			});
			return exists;
		};

		// Polling loop
		while (attempts < maxAttempts) {
			if (await checkReferenceExists()) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, delay));
			attempts++;
		}

		// If reference doesn't appear after max attempts, exit function
		if (attempts === maxAttempts) {
			return;
		}

		// Replace the reference to the audio file with the transcript
		await this.app.vault.process(file, (content) => {
			const newContent = content.replace(
				`\n![[${audio.name}]]\n`,
				transcript
			);
			return newContent;
		});

		// If the delete setting is enabled, delete the audio file
		if (this.settings.deleteAudioFilesAfterAudioTriggeredCannolis) {
			this.app.vault.delete(audio);
		}
	}

	async generateTranscript(file: TFile) {
		// Send notice
		new Notice("Transcribing audio");

		if (!file) {
			console.error("File not found");
			return;
		}

		const audioBuffer = await this.app.vault.readBinary(file as TFile);
		const N = 16;
		const randomBoundryString =
			"WebKitFormBoundary" +
			Array(N + 1)
				.join(
					(Math.random().toString(36) + "00000000000000000").slice(
						2,
						18
					)
				)
				.slice(0, N);

		const pre_string = `------${randomBoundryString}\r\nContent-Disposition: form-data; name="file"; filename="audio.${file.extension}"\r\nContent-Type: "application/octet-stream"\r\n\r\n`;
		let post_string = `\r\n------${randomBoundryString}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1`;

		if (this.settings.transcriptionPrompt) {
			post_string += `\r\n------${randomBoundryString}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${this.settings.transcriptionPrompt}`;
		}

		post_string += `\r\n------${randomBoundryString}--\r\n`;

		const pre_string_encoded = new TextEncoder().encode(pre_string);
		const post_string_encoded = new TextEncoder().encode(post_string);

		const concatenated = await new Blob([
			pre_string_encoded,
			audioBuffer,
			post_string_encoded,
		]).arrayBuffer();

		const options: RequestUrlParam = {
			url: "https://api.openai.com/v1/audio/transcriptions",
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=----${randomBoundryString}`,
				Authorization: "Bearer " + this.settings.openaiAPIKey,
			},
			body: concatenated,
		};

		try {
			const response = await requestUrl(options);
			if ("text" in response.json) return response.json.text as string;
			else throw new Error("Error. " + JSON.stringify(response.json));
		} catch (error) {
			console.error(error);
		}
	}

	startCannoli = async (file: TFile) => {
		// If the api key is the default, send a notice telling the user to add their key
		const keyName = this.settings.llmProvider + "APIKey";
		if (
			this.settings.llmProvider !== "ollama" &&
			// @ts-expect-error - This is a valid check
			this.settings?.[keyName] !== undefined &&
			// @ts-expect-error - Please forgive me
			DEFAULT_SETTINGS?.[keyName] !== undefined &&
			// @ts-expect-error - I'm sorry
			this.settings?.[keyName] === DEFAULT_SETTINGS?.[keyName]
		) {
			new Notice(
				`Please enter your ${this.settings.llmProvider} API key in the Cannoli settings`
			);
			return;
		}

		// Create an instance of llm
		let llm: LLMProvider | undefined;
		switch (this.settings.llmProvider) {
			case "openai": {
				const openAiConfig: GenericModelConfig = {
					apiKey: this.settings.openaiAPIKey,
					model: this.settings.defaultModel,
					temperature: this.settings.defaultTemperature,
					role: "user",
				};
				llm = new LLMProvider({
					provider: "openai",
					baseConfig: openAiConfig,
				});
				break;
			}
			case "ollama": {
				const ollamaConfig: GenericModelConfig = {
					baseURL: this.settings.ollamaBaseUrl,
					model: this.settings.ollamaModel,
				};
				llm = new LLMProvider({
					provider: "ollama",
					baseConfig: ollamaConfig,
				});
				break;
			}
			case "gemini": {
				const geminiConfig: GenericModelConfig = {
					apiKey: this.settings.geminiAPIKey,
					model: this.settings.geminiModel,
				};
				llm = new LLMProvider({
					provider: "gemini",
					baseConfig: geminiConfig,
				});
				break;
			}
			case "anthropic": {
				const anthropicConfig: GenericModelConfig = {
					apiKey: this.settings.anthropicAPIKey,
					model: this.settings.anthropicModel,
				};
				llm = new LLMProvider({
					provider: "anthropic",
					baseConfig: anthropicConfig,
				});
				break;
			}
			case "groq": {
				const groqConfig: GenericModelConfig = {
					apiKey: this.settings.groqAPIKey,
					model: this.settings.groqModel,
				};
				llm = new LLMProvider({
					provider: "groq",
					baseConfig: groqConfig,
				});
				break;
			}
		}
		invariant(llm, "LLM provider not found");

		// If the file's basename ends with .cno, don't include the extension in the notice
		const name = file.basename.endsWith(".cno")
			? file.basename.slice(0, -4)
			: file.basename;

		// Check if the cannoli is already running
		if (this.runningCannolis[file.basename]) {
			new Notice(`Cannoli: ${name} is already running`);
			return;
		}

		new Notice(`Started cannoli: ${name}`);

		// Sleep for 1.5s to give the vault time to load
		await new Promise((resolve) => setTimeout(resolve, 1500));

		const canvas = new Canvas(file);
		await canvas.fetchData();

		const factory = new CannoliFactory(
			canvas.getCanvasData(),
			`[[${this.app.workspace.getActiveFile()?.basename}]]` ??
			"No active note",
			this.settings.contentIsColorless ?? false
		);

		const graph = factory.getCannoliData();
		// console.log(JSON.stringify(graph, null, 2));

		const shouldContinue = await this.validateCannoli(
			graph,
			file,
			name,
			canvas,
			llm
		);

		// const shouldContinue = true;

		if (shouldContinue) {
			await this.runCannoli(graph, file, name, canvas, llm);
		}
	};

	validateCannoli = async (
		graph: VerifiedCannoliCanvasData,
		file: TFile,
		name: string,
		canvas: Canvas,
		llm: LLMProvider,
		audioTranscription?: string
	) => {
		return new Promise<boolean>((resolve) => {
			// Create callback function to trigger notice
			const onFinish = (stoppage: Stoppage) => {
				// console.log("Finished validation run");

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

				// If the total price is greater than the threshold, ask the user if they want to continue
				if (stoppage.totalCost > this.settings.costThreshold) {
					new RunPriceAlertModal(
						this.app,
						stoppage.usage,
						onContinueCallback,
						onCancelCallback
					).open();
				} else {
					// Otherwise, continue
					onContinueCallback();
				}
			};

			const validationGraph = new CannoliGraph(
				JSON.parse(JSON.stringify(graph))
			);

			// Create validation run
			const validationRun = new Run({
				graph: validationGraph.graph,
				isMock: true,
				canvas: canvas,
				onFinish: onFinish,
				cannoli: this,
				llm: llm,
			});

			// console.log("Starting validation run");

			validationRun.start();
		});
	};

	runCannoli = async (
		graph: VerifiedCannoliCanvasData,
		file: TFile,
		name: string,
		canvas: Canvas,
		llm?: LLMProvider
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
					new Notice(`Cannoli complete: ${name}${costString}`);
				} else {
					new Notice(`Cannoli stopped: ${name}${costString}`);
				}

				// Resolve the promise to continue the async function
				resolve();
			};

			const liveGraph = new CannoliGraph(
				JSON.parse(JSON.stringify(graph))
			);

			// Create live run
			const run = new Run({
				graph: liveGraph.graph,
				llm: llm,
				isMock: false,
				canvas: canvas,
				onFinish: onFinish,
				cannoli: this,
			});

			// run.logGraph();

			this.runningCannolis[file.basename] = run;

			run.start();
		});
	};

	addSampleFolder = async () => {
		try {
			await this.app.vault.createFolder("Cannoli College");
		} catch (error) {
			// If the folder already exists, send a Notice
			new Notice("Cannoli College folder already exists");
			return;
		}

		// For each element of the cannoliCollege object, create a subfolder with the name of the key
		for (const [key, value] of Object.entries(cannoliCollege)) {
			await this.app.vault.createFolder("Cannoli College/" + key);

			// Iterate through the array of objects in the subfolder
			for (const item of value) {
				const { name, content } = item; // Destructure the name and content properties

				await this.app.vault.create(
					"Cannoli College/" + key + "/" + name,
					content
				);
			}
		}
	};
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

		contentEl.createEl("h1", { text: "Run cost alert" });
		contentEl.createEl("p", {
			text: "Check the cost of your run before continuing",
		});

		// Convert usage object to array

		this.usage.forEach((usage) => {
			contentEl.createEl("h2", { text: `Model: ${usage.model.name}` });
			contentEl
				.createEl("p", {
					text: `\t\tEstimated prompt tokens: ${usage.modelUsage.promptTokens}`,
				})
				.addClass("whitespace");
			contentEl
				.createEl("p", {
					text: `\t\tNumber of API calls: ${usage.modelUsage.apiCalls}`,
				})
				.addClass("whitespace");
			contentEl
				.createEl("p", {
					text: `\t\tCost: $${(
						usage.modelUsage.promptTokens *
						usage.model.promptTokenPrice
					).toFixed(2)}`,
				})
				.addClass("whitespace");
		});

		contentEl.createEl("h2", {
			text: `Total cost: $${totalCost.toFixed(2)}`,
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
				.setButtonText("Continue")
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

export class HttpTemplateEditorModal extends Modal {
	template: HttpTemplate;
	onSave: (template: HttpTemplate) => void;
	onCancel: () => void;

	constructor(
		app: App,
		template: HttpTemplate,
		onSave: (template: HttpTemplate) => void,
		onCancel: () => void
	) {
		super(app);
		this.template = template;
		this.onSave = onSave;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.addClass("http-template-editor");
		contentEl.createEl("h1", { text: "Edit action node template" });

		const createInputGroup = (
			labelText: string,
			inputElement: HTMLElement,
			id: string
		) => {
			const div = contentEl.createEl("div", {
				cls: "http-template-group",
			});
			const label = div.createEl("label", { text: labelText });
			label.htmlFor = id;
			inputElement.setAttribute("id", id);
			div.appendChild(inputElement);
		};

		const createDescription = (text: string) => {
			const p = contentEl.createEl("p", {
				cls: "http-template-description",
			});
			p.textContent = text;
			return p;
		};

		const nameInput = contentEl.createEl("input", {
			type: "text",
			value: this.template.name || "",
		}) as HTMLInputElement;
		nameInput.setAttribute("id", "name-input");
		createInputGroup("Name:", nameInput, "name-input");

		const urlInput = contentEl.createEl("input", {
			type: "text",
			value: this.template.url || "",
		}) as HTMLInputElement;
		urlInput.setAttribute("id", "url-input");
		createInputGroup("URL:", urlInput, "url-input");

		// Create a select element for HTTP methods
		const methodSelect = contentEl.createEl("select") as HTMLSelectElement;
		const methods = ["GET", "POST", "PUT", "DELETE"];
		methods.forEach((method) => {
			const option = methodSelect.createEl("option", {
				text: method,
				value: method,
			});
			// If the current template's method matches, select this option
			if (this.template.method === method) {
				option.selected = true;
			}
		});
		createInputGroup("Method:", methodSelect, "method-select");

		const headersValue =
			this.template.headers &&
				Object.keys(this.template.headers).length > 0
				? JSON.stringify(this.template.headers, null, 2)
				: JSON.stringify(
					{ "Content-Type": "application/json" },
					null,
					2
					// eslint-disable-next-line no-mixed-spaces-and-tabs
				);

		const headersInput = contentEl.createEl("textarea", {
			placeholder: `{ "Content-Type": "application/json" }`,
		}) as HTMLTextAreaElement;
		headersInput.value = headersValue;
		headersInput.setAttribute("rows", "3");

		createInputGroup("Headers:", headersInput, "headers-input");

		// Body template input
		const bodyTemplateInput = contentEl.createEl("textarea", {
			placeholder:
				"Enter body template. Use {{variableName}} for variables.",
		}) as HTMLTextAreaElement;
		const formattedBody = this.formatBody(this.template.bodyTemplate || "");
		bodyTemplateInput.value = formattedBody;
		bodyTemplateInput.setAttribute("rows", "3");
		bodyTemplateInput.setAttribute(
			"placeholder",
			"Enter body template. Use {{variableName}} for variables."
		);
		createInputGroup(
			"Body template: (optional)",
			bodyTemplateInput,
			"body-template-input"
		);

		// Add the permanent description below the input
		createDescription(
			"You can use the optional body template to predefine the structure of the request body. Use {{variableName}} syntax to insert variables into the body template. If there's only one variable, it will be replaced with whatever is written to the action node. If there are multiple variables, the action node will look for the variables in the available named arrows."
		);

		const panel = new Setting(contentEl);

		panel.addButton((btn) =>
			btn.setButtonText("Cancel").onClick(() => {
				this.close();
				this.onCancel();
			})
		);

		panel.addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(() => {
					// Parsing headers
					let headers: Record<string, string> = {};
					try {
						headers = JSON.parse(headersInput.value || "{}");
					} catch (error) {
						alert(
							"Invalid JSON format for headers. Please correct and try again."
						);
						return;
					}

					// Updating template object
					this.template.name = nameInput.value;
					this.template.url = urlInput.value;
					this.template.headers = headers;
					this.template.method = methodSelect.value;
					this.template.bodyTemplate = bodyTemplateInput.value;

					this.close();
					this.onSave(this.template);
				})
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	formatBody(body: string): string {
		try {
			// Try to parse the body as JSON
			const parsedBody = JSON.parse(body);

			// If successful, stringify it with proper formatting
			return JSON.stringify(parsedBody, null, 2);
		} catch (error) {
			// If parsing failed, return the body as-is
			return body;
		}
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

		// Add button to add sample folder
		new Setting(containerEl)
			.setName("Add Cannoli College")
			.setDesc(
				"Add a folder of sample cannolis to your vault to walk you through the basics of Cannoli. (Delete and re-add this folder to get the latest version after an update.)"
			)
			.addButton((button) =>
				button.setButtonText("Add").onClick(() => {
					this.plugin.addSampleFolder();
				})
			);

		// Add dropdown for AI provider with options OpenAI and Ollama
		new Setting(containerEl)
			.setName("Default AI provider")
			.setDesc(
				"Select the default AI provider you'd like to use for your cannolis. This can be overridden in the canvas file."
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("openai", "OpenAI");
				dropdown.addOption("ollama", "Ollama");
				dropdown.addOption("gemini", "Gemini");
				dropdown.addOption("anthropic", "Anthropic");
				dropdown.addOption("groq", "Groq");
				dropdown.setValue(
					this.plugin.settings.llmProvider ??
					DEFAULT_SETTINGS.llmProvider
				);
				dropdown.onChange(async (value) => {
					this.plugin.settings.llmProvider = value as SupportedProviders;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		containerEl.createEl("h1", { text: "LLM" });

		if (this.plugin.settings.llmProvider === "openai") {
			new Setting(containerEl)
				.setName("OpenAI API key")
				.setDesc(
					"This key will be used to make all openai LLM calls. Be aware that complex cannolis, especially those with many GPT-4 calls, can be expensive to run."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.openaiAPIKey)
						.setPlaceholder("sk-...")
						.onChange(async (value) => {
							this.plugin.settings.openaiAPIKey = value;
							await this.plugin.saveSettings();
						})
				);

			// Cost threshold setting. This is the cost at which the user will be alerted before running a Cannoli
			new Setting(containerEl)
				.setName("Cost threshold")
				.setDesc(
					"If the cannoli you are about to run is estimated to cost more than this amount (USD$), you will be alerted before running it."
				)
				.addText((text) =>
					text
						.setValue(
							!isNaN(this.plugin.settings.costThreshold)
								? this.plugin.settings.costThreshold.toString()
								: DEFAULT_SETTINGS.costThreshold.toString()
						)
						.onChange(async (value) => {
							// If it's not empty and it's a number, save it
							if (!isNaN(parseFloat(value))) {
								this.plugin.settings.costThreshold =
									parseFloat(value);
								await this.plugin.saveSettings();
							} else {
								// Otherwise, reset it to the default
								this.plugin.settings.costThreshold =
									DEFAULT_SETTINGS.costThreshold;
								await this.plugin.saveSettings();
							}
						})
				);

			// Default LLM model setting
			new Setting(containerEl)
				.setName("Default LLM model")
				.setDesc(
					"This model will be used for all LLM nodes unless overridden with a config arrow. (Note that special arrow types rely on function calling, which is not available in all models.)"
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.defaultModel)
						.onChange(async (value) => {
							this.plugin.settings.defaultModel = value;
							await this.plugin.saveSettings();
						})
				);

			// Default LLM temperature setting
			new Setting(containerEl)
				.setName("Default LLM temperature")
				.setDesc(
					"This temperature will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(
							!isNaN(this.plugin.settings.defaultTemperature) &&
								this.plugin.settings.defaultTemperature
								? this.plugin.settings.defaultTemperature.toString()
								: DEFAULT_SETTINGS.defaultTemperature.toString()
						)
						.onChange(async (value) => {
							// If it's not empty and it's a number, save it
							if (!isNaN(parseFloat(value))) {
								this.plugin.settings.defaultTemperature =
									parseFloat(value);
								await this.plugin.saveSettings();
							} else {
								// Otherwise, reset it to the default
								this.plugin.settings.defaultTemperature =
									DEFAULT_SETTINGS.defaultTemperature;
								await this.plugin.saveSettings();
							}
						})
				);
		} else if (this.plugin.settings.llmProvider === "ollama") {
			// ollama base url setting
			new Setting(containerEl)
				.setName("Ollama base url")
				.setDesc(
					"This url will be used to make all ollama LLM calls. Be aware that ollama models have different features and capabilities that may not be compatible with all features of cannoli."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.ollamaBaseUrl)
						.setPlaceholder("https://ollama.com")
						.onChange(async (value) => {
							this.plugin.settings.ollamaBaseUrl = value;
							await this.plugin.saveSettings();
						})
				);
			// ollama model setting
			new Setting(containerEl)
				.setName("Ollama model")
				.setDesc(
					"This model will be used for all LLM nodes unless overridden with a config arrow. (Note that special arrow types rely on function calling, which is not available in all models.)"
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.ollamaModel)
						.onChange(async (value) => {
							this.plugin.settings.ollamaModel = value;
							await this.plugin.saveSettings();
						})
				);
		} else if (this.plugin.settings.llmProvider === "gemini") {
			// gemini api key setting
			new Setting(containerEl)
				.setName("Gemini API key")
				.setDesc(
					"This key will be used to make all Gemini LLM calls. Be aware that complex cannolis, can be expensive to run."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.geminiAPIKey)
						.setPlaceholder("sk-...")
						.onChange(async (value) => {
							this.plugin.settings.geminiAPIKey = value;
							await this.plugin.saveSettings();
						})
				);
			// gemini model setting
			new Setting(containerEl)
				.setName("Gemini model")
				.setDesc(
					"This model will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.geminiModel)
						.onChange(async (value) => {
							this.plugin.settings.geminiModel = value;
							await this.plugin.saveSettings();
						})
				);
		} else if (this.plugin.settings.llmProvider === "anthropic") {
			// anthropic api key setting
			new Setting(containerEl)
				.setName("Anthropic API key")
				.setDesc(
					"This key will be used to make all Anthropic LLM calls. Be aware that complex cannolis, can be expensive to run."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.anthropicAPIKey)
						.setPlaceholder("sk-...")
						.onChange(async (value) => {
							this.plugin.settings.anthropicAPIKey = value;
							await this.plugin.saveSettings();
						})
				);
			// anthropic model setting
			new Setting(containerEl)
				.setName("Anthropic model")
				.setDesc(
					"This model will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.anthropicModel)
						.onChange(async (value) => {
							this.plugin.settings.anthropicModel = value;
							await this.plugin.saveSettings();
						})
				);
		} else if (this.plugin.settings.llmProvider === "groq") {
			// groq api key setting
			new Setting(containerEl)
				.setName("Groq API key")
				.setDesc(
					"This key will be used to make all Groq LLM calls. Be aware that complex cannolis, can be expensive to run."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.groqAPIKey)
						.setPlaceholder("sk-...")
						.onChange(async (value) => {
							this.plugin.settings.groqAPIKey = value;
							await this.plugin.saveSettings();
						})
				);
			// groq model setting
			new Setting(containerEl)
				.setName("Groq model")
				.setDesc(
					"This model will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.groqModel)
						.onChange(async (value) => {
							this.plugin.settings.groqModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		new Setting(containerEl)
			.setName("LLM call concurrency limit (pLimit)")
			.setDesc(
				"The maximum number of LLM calls that can be made at once. Decrease this if you are running into rate limiting issues."
			)
			.addText((text) =>
				text
					.setValue(
						Number.isInteger(this.plugin.settings.pLimit)
							? this.plugin.settings.pLimit.toString()
							: DEFAULT_SETTINGS.pLimit.toString()
					)
					.onChange(async (value) => {
						// If it's not empty and it's a positive integer, save it
						if (!isNaN(parseInt(value)) && parseInt(value) > 0) {
							this.plugin.settings.pLimit = parseInt(value);
							await this.plugin.saveSettings();
						} else {
							// Otherwise, reset it to the default
							this.plugin.settings.pLimit =
								DEFAULT_SETTINGS.pLimit;
							await this.plugin.saveSettings();
						}
					})
			);

		containerEl.createEl("h1", { text: "Canvas preferences" });

		// Add toggle for contentIsColorless
		new Setting(containerEl)
			.setName("Parse colorless nodes as content nodes")
			.setDesc(
				"Toggle this if you'd like colorless (grey) nodes to be interpreted as content nodes rather than call nodes. Purple nodes will then be interpreted as call nodes."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.contentIsColorless ??
						DEFAULT_SETTINGS.contentIsColorless
					)
					.onChange(async (value) => {
						this.plugin.settings.contentIsColorless = value;
						await this.plugin.saveSettings();
					})
			);

		// Put header here
		containerEl.createEl("h1", { text: "Note extraction" });

		// Toggle adding filenames as headers when extracting text from files
		new Setting(containerEl)
			.setName(
				"Include filenames as headers in extracted notes by default"
			)
			.setDesc(
				`When extracting a note in a cannoli, include the filename as a top-level header. This default can be overridden by adding "#" or "!#" after the note link in a reference like this: {{[[Stuff]]#}} or {{[[Stuff]]!#}}.`
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.includeFilenameAsHeader || false
					)
					.onChange(async (value) => {
						this.plugin.settings.includeFilenameAsHeader = value;
						await this.plugin.saveSettings();
					})
			);

		// Toggle including properties (YAML frontmatter) when extracting text from files
		new Setting(containerEl)
			.setName(
				"Include properties when extracting or editing notes by default"
			)
			.setDesc(
				`When extracting or editing a note in a cannoli, include the note's properties (YAML frontmatter). This default can be overridden by adding "^" or "!^" after the note link in a reference like this: {{[[Stuff]]^}} or {{[[Stuff]]!^}}.`
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings
							.includePropertiesInExtractedNotes || false
					)
					.onChange(async (value) => {
						this.plugin.settings.includePropertiesInExtractedNotes =
							value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h1", { text: "Chat cannolis" });

		// Chat format string setting, error if invalid
		new Setting(containerEl)
			.setName("Chat format string")
			.setDesc(
				"This string will be used to format chat messages when using chat arrows. This string must contain the placeholders {{role}} and {{content}}, which will be replaced with the role and content of the message, respectively."
			)
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.chatFormatString)
					.onChange(async (value) => {
						// Check if the format string is valid
						const rolePlaceholder = "{{role}}";
						const contentPlaceholder = "{{content}}";
						if (
							!value.includes(rolePlaceholder) ||
							!value.includes(contentPlaceholder)
						) {
							alert(
								`Invalid format string. Please include both ${rolePlaceholder} and ${contentPlaceholder}.`
							);
							return;
						}

						this.plugin.settings.chatFormatString = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-scroll with token stream")
			.setDesc(
				"Move the cursor forward every time a token is streamed in from a chat arrow. This will lock the scroll position to the bottom of the note."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.autoScrollWithTokenStream || false
					)
					.onChange(async (value) => {
						this.plugin.settings.autoScrollWithTokenStream = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h1", { text: "Transcription" });

		// Toggle voice recording triggered cannolis
		new Setting(containerEl)
			.setName("Enable audio recorder triggered cannolis")
			.setDesc(
				`Enable cannolis to be triggered by audio recordings. When you make a recording in a note with a cannoli property: (1) The audio file will be transcribed using Whisper. (2) The file reference will be replaced with the transcript. (3) The cannoli defined in the property will run.`
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.enableAudioTriggeredCannolis ||
						false
					)
					.onChange(async (value) => {
						this.plugin.settings.enableAudioTriggeredCannolis =
							value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.enableAudioTriggeredCannolis) {
			// Transcription prompt
			new Setting(containerEl)
				.addTextArea((text) =>
					text
						.setPlaceholder(
							"Enter prompt to improve transcription accuracy"
						)
						.setValue(
							this.plugin.settings.transcriptionPrompt || ""
						)
						.onChange(async (value) => {
							this.plugin.settings.transcriptionPrompt = value;
							await this.plugin.saveSettings();
						})
				)
				.setName("Transcription prompt")
				.setDesc(
					"Use this prompt to guide the style and vocabulary of the transcription. (i.e. the level of punctuation, format and spelling of uncommon words in the prompt will be mimicked in the transcription)"
				);

			// Toggle deleting audio files after starting an audio triggered cannoli
			new Setting(containerEl)
				.setName("Delete audio files after transcription")
				.setDesc(
					"After a recording is transcribed, delete the audio file."
				)
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings
								.deleteAudioFilesAfterAudioTriggeredCannolis ||
							false

							// eslint-disable-next-line no-mixed-spaces-and-tabs
						)
						.onChange(async (value) => {
							this.plugin.settings.deleteAudioFilesAfterAudioTriggeredCannolis =
								value;
							await this.plugin.saveSettings();
						})
				);
		}

		containerEl.createEl("h1", { text: "Action nodes" });

		new Setting(containerEl)
			.setName("Action node templates")
			.setDesc("Manage default HTTP templates for action nodes.")
			.addButton((button) =>
				button.setButtonText("+ Template").onClick(() => {
					// Create a new command object to pass to the modal
					const newCommand: HttpTemplate = {
						name: "",
						url: "",
						headers: {},
						id: "",
						method: "GET",
					};

					// Open the modal to edit the new template
					new HttpTemplateEditorModal(
						this.app,
						newCommand,
						(command) => {
							this.plugin.settings.httpTemplates.push(command);
							this.plugin.saveSettings();
							// Refresh the settings pane to reflect the changes
							this.display();
						},
						() => { }
					).open();
				})
			);

		// Iterate through saved templates and display them
		for (const template of this.plugin.settings.httpTemplates) {
			new Setting(containerEl)
				.setName(template.name)
				.addButton((button) =>
					button.setButtonText("Edit").onClick(() => {
						// Open the modal to edit the existing template
						new HttpTemplateEditorModal(
							this.app,
							template,
							(updatedTemplate) => {
								Object.assign(template, updatedTemplate);
								this.plugin.saveSettings();
								// Refresh the settings pane to reflect the changes
								this.display();
							},
							() => { }
						).open();
					})
				)
				.addButton((button) =>
					button.setButtonText("Delete").onClick(() => {
						const index =
							this.plugin.settings.httpTemplates.indexOf(
								template
							);
						if (index > -1) {
							this.plugin.settings.httpTemplates.splice(index, 1);
							this.plugin.saveSettings();
							// Refresh the settings pane to reflect the changes
							this.display();
						}
					})
				);
		}
	}
}
