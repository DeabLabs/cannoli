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
import {
	HttpTemplate,
	ResponseTextFetcher,
	Usage,
	GetDefaultsByProvider,
	LLMProvider,
	SupportedProviders,
	runCannoli,
	CanvasData,
	CanvasGroupData,
	Messenger,
	SearchSource,
} from "@deablabs/cannoli-core";
import { cannoliCollege } from "../assets/cannoliCollege";
import { cannoliIcon } from "../assets/cannoliIcon";
import invariant from "tiny-invariant";
import { VaultInterface } from "./vault_interface";
import { ObsidianCanvas } from "./canvas";
import { SYMBOLS, cannoliValTemplate } from "./val_templates";
import { CannoliHooksMessenger } from "./plugin_hook_handler";
import { DiscordMessenger } from "./discord_messenger";
import { ObsidianMessenger } from "./obsidian_messenger";
import CannoliDiscordBotClient from "./discord_bot_client";
import { ExaSearchSource } from "./exa_search_source";
import { SmartConnectionsSearchSource } from "./smart_connections_search_source";

interface CannoliSettings {
	llmProvider: SupportedProviders;
	ollamaBaseUrl: string;
	ollamaModel: string;
	ollamaTemperature: number;
	geminiModel: string;
	geminiAPIKey: string;
	geminiTemperature: number;
	anthropicModel: string;
	anthropicAPIKey: string;
	anthropicTemperature: number;
	groqModel: string;
	groqAPIKey: string;
	groqTemperature: number;
	openaiAPIKey: string;
	openaiBaseURL: string;
	costThreshold: number;
	defaultModel: string;
	defaultTemperature: number;
	httpTemplates: HttpTemplate[];
	includeFilenameAsHeader: boolean;
	includePropertiesInExtractedNotes: boolean;
	includeLinkInExtractedNotes: boolean;
	chatFormatString: string;
	enableAudioTriggeredCannolis?: boolean;
	deleteAudioFilesAfterAudioTriggeredCannolis?: boolean;
	transcriptionPrompt?: string;
	autoScrollWithTokenStream: boolean;
	pLimit: number;
	contentIsColorless: boolean;
	valTownAPIKey: string;
	defaultSearchSource: string;
	exaAPIKey: string;
	exaDefaultLimit: number;
	cannoliWebsiteAPIKey: string;
	discordVaultKey: string;
	discordVaultID: string;
	discordBotKey: string;
	discordPrivateKey: string;
	discordPublicKey: string;
	discordBotUrl: string;
	discordCommandsEnabled: boolean;
}

const DEFAULT_SETTINGS: CannoliSettings = {
	llmProvider: "openai",
	ollamaBaseUrl: "http://127.0.0.1:11434",
	ollamaModel: "llama2",
	ollamaTemperature: 1,
	geminiModel: "gemini-1.0-pro-latest",
	geminiAPIKey: "",
	geminiTemperature: 1,
	anthropicModel: "claude-3-opus-20240229",
	anthropicAPIKey: "",
	anthropicTemperature: 1,
	groqModel: "llama3-70b-8192",
	groqAPIKey: "",
	groqTemperature: 1,
	openaiAPIKey: "",
	openaiBaseURL: "",
	costThreshold: 0.5,
	defaultModel: "gpt-3.5-turbo",
	defaultTemperature: 1,
	httpTemplates: [],
	includeFilenameAsHeader: false,
	includePropertiesInExtractedNotes: false,
	includeLinkInExtractedNotes: false,
	chatFormatString: `---\n# <u>{{role}}</u>\n\n{{content}}`,
	enableAudioTriggeredCannolis: false,
	deleteAudioFilesAfterAudioTriggeredCannolis: false,
	autoScrollWithTokenStream: false,
	pLimit: 50,
	contentIsColorless: false,
	valTownAPIKey: "",
	defaultSearchSource: "smart-connections",
	exaAPIKey: "",
	exaDefaultLimit: 5,
	cannoliWebsiteAPIKey: "",
	discordVaultKey: "",
	discordVaultID: "",
	discordBotKey: "",
	discordPrivateKey: "",
	discordPublicKey: "",
	discordBotUrl: "",
	discordCommandsEnabled: false,
};

export default class Cannoli extends Plugin {
	settings: CannoliSettings;
	runningCannolis: { [key: string]: () => void } = {};
	discordBotClient: CannoliDiscordBotClient;

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

		this.createOpenOnWebsiteCommand();

		this.createOpenOnWebsiteDevCommand();

		this.createCopyCanvasToClipboardCommand();

		this.createCreateValCommand();

		// This creates an icon in the left ribbon.
		this.addRibbonIcon(
			"cannoli",
			"Start/stop cannoli",
			this.startActiveCannoliCommand
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CannoliSettingTab(this.app, this));

		this.discordBotClient = new CannoliDiscordBotClient(this);

		if (this.settings.discordVaultID && this.settings.discordVaultKey) {
			this.discordBotClient.connect();
		}
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

	createOpenOnWebsiteCommand = () => {
		this.addCommand({
			id: "open-on-website",
			name: "Open on website",
			callback: this.openOnWebsite,
			icon: "cannoli",
		});
	};

	createOpenOnWebsiteDevCommand = () => {
		this.addCommand({
			id: "open-on-website-dev",
			name: "Open on website [DEV]",
			callback: () => this.openOnWebsite(true),
			icon: "cannoli",
		});
	}

	createCopyCanvasToClipboardCommand = () => {
		this.addCommand({
			id: "copy-canvas-to-clipboard",
			name: "Copy canvas to clipboard",
			callback: this.copyCanvasToClipboard,
			icon: "cannoli",
		});
	};

	createCreateValCommand = () => {
		this.addCommand({
			id: "create-val",
			name: "Create Val",
			callback: this.createVal,
			icon: "cannoli",
		});
	};

	openOnWebsite = async (dev?: boolean) => {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;
		const url = dev ? "http://localhost:5173/canvas/open" : "https://cannoli.website/canvas/open";

		// get the content of the file
		const content = await this.app.vault.read(activeFile);

		// make request to the website
		const response = await requestUrl({
			url: url,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: content,
		});

		// Check that the response has json
		const json = response.json;
		if (!json) {
			new Notice("Error opening file on website");
			return;
		}

		// Check that json contains redirect key
		if (!json.redirect) {
			new Notice("Error opening file on website");
			return;
		}

		// Send the redirect to the browser
		window.open(json.redirect, "_blank");
	};

	copyCanvasToClipboard = async () => {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		if (!activeFile.path.endsWith(".canvas")) {
			new Notice("This file is not a canvas");
			return;
		}

		const content = await this.app.vault.read(activeFile);
		await navigator.clipboard.writeText(content);

		new Notice("Canvas copied to clipboard");
	};

	createVal = async () => {
		// Check if the user's on a canvas
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || !activeFile.path.endsWith(".canvas")) {
			new Notice("This file is not a canvas");
			return;
		}

		// Check that the user has a val town api key
		if (!this.settings.valTownAPIKey) {
			new Notice("Please enter a Val Town API key in the Cannoli settings");
			return;
		}

		// Get the content of the file
		const content = await this.app.vault.read(activeFile);
		const code = cannoliValTemplate.replace(SYMBOLS.defaultProvider, this.settings.llmProvider)
			.replace(SYMBOLS.defaultModel, this.settings.defaultModel)
			.replace(SYMBOLS.canvasJSON, content)
			.replace(SYMBOLS.defaultGroqModel, this.settings.groqModel)
			.replace(SYMBOLS.defaultOpenaiModel, this.settings.defaultModel)
			.replace(SYMBOLS.defaultGeminiModel, this.settings.geminiModel)
			.replace(SYMBOLS.defaultAnthropicModel, this.settings.anthropicModel)
			.replace(SYMBOLS.defaultOpenaiTemperature, this.settings.defaultTemperature.toString())
			.replace(SYMBOLS.defaultGeminiTemperature, this.settings.geminiTemperature.toString())
			.replace(SYMBOLS.defaultAnthropicTemperature, this.settings.anthropicTemperature.toString())
			.replace(SYMBOLS.defaultGroqTemperature, this.settings.groqTemperature.toString())
			.replace(SYMBOLS.defaultOpenaiBaseURL, this.settings.openaiBaseURL)


		// const args = this.getArgsFromCanvas(content);

		const name = activeFile.basename.toLocaleLowerCase().replace(".canvas", "").replace(/ /g, "-").replace(/[^a-z]/g, "");



		const response = await requestUrl({
			url: "https://api.val.town/v1/vals",
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${this.settings.valTownAPIKey}`,
			},
			body: JSON.stringify({
				name: name,
				code: code,
			}),
		});

		// If the response is not ok, send a notice
		if (typeof response.json === "string") {
			new Notice(`Error creating Val: ${response.json}`);
			return;
		}

		const valUrl = `https://www.val.town/v/${response.json.author.username}/${response.json.name}`;

		// const readme = cannoliValReadmeTemplate(
		// 	name,
		// 	valUrl,
		// 	args
		// );

		// console.log(readme);

		// await requestUrl({
		// 	url: `https://api.val.town/v1/vals/${response.json.id}`,
		// 	method: "PUT",
		// 	headers: {
		// 		"Content-Type": "application/json",
		// 		"Authorization": `Bearer ${this.settings.valTownAPIKey}`,
		// 	},
		// 	body: JSON.stringify({
		// 		name: name,
		// 		readme: readme,
		// 		code: code,
		// 	}),
		// });

		new Notice(`Val created for ${activeFile.basename}`);

		// Redirect to the val
		window.open(valUrl, "_blank");
	};

	getArgsFromCanvas = (canvas: string) => {
		// Parse into JSON
		const json = JSON.parse(canvas);

		// Find all nodes with no attatched edges
		// Build array of all node IDs referenced in the edges by "toNode" or "fromNode"
		const edges = json.edges;
		const nodeIds = edges.map((edge: { toNode: string, fromNode: string }) => {
			return [edge.toNode, edge.fromNode];
		}).flat();

		// Look for nodes that are not in the nodeIds array
		const nodes = json.nodes;
		const noEdgeNodes = nodes.filter((node: { id: string }) => {
			return !nodeIds.includes(node.id);
		});

		// Look in the floating nodes for ones whose text has a first line like this "[name]\n", and grab the name
		const floatingNodeNames = noEdgeNodes.filter((node: { text?: string }) => {
			const firstLine = node.text?.split("\n")?.[0];
			return firstLine?.trim().startsWith("[") && firstLine?.trim().endsWith("]");
		}).map((node: { text: string }) => {
			return node.text.trim().slice(1, -1);
		});

		// Return the array
		return floatingNodeNames;
	}

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
			this.runningCannolis[cannoli.basename]();
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

	startCannoli = async (file: TFile, noCanvas = false) => {
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

		// map cannoli settings to provider config
		const getConfigByProvider: GetDefaultsByProvider = (p) => {
			switch (p) {
				case "openai":
					return {
						apiKey: this.settings.openaiAPIKey,
						model: this.settings.defaultModel,
						temperature: this.settings.defaultTemperature,
						baseURL: this.settings.openaiBaseURL,
					};
				case "ollama":
					return {
						baseURL: this.settings.ollamaBaseUrl,
						model: this.settings.ollamaModel,
						temperature: this.settings.ollamaTemperature,
					};
				case "gemini":
					return {
						apiKey: this.settings.geminiAPIKey,
						model: this.settings.geminiModel,
						temperature: this.settings.geminiTemperature,
					};
				case "anthropic":
					return {
						apiKey: this.settings.anthropicAPIKey,
						model: this.settings.anthropicModel,
						temperature: this.settings.anthropicTemperature,
					};
				case "groq":
					return {
						apiKey: this.settings.groqAPIKey,
						model: this.settings.groqModel,
						temperature: this.settings.groqTemperature,
					};
			}
		}

		// Create an instance of llm
		let llm: LLMProvider | undefined;
		switch (this.settings.llmProvider) {
			case "openai": {
				const config = getConfigByProvider("openai");
				llm = new LLMProvider({
					provider: "openai",
					baseConfig: config,
					getDefaultConfigByProvider: getConfigByProvider,
				});
				break;
			}
			case "ollama": {
				const config = getConfigByProvider("ollama");
				llm = new LLMProvider({
					provider: "ollama",
					baseConfig: config,
					getDefaultConfigByProvider: getConfigByProvider,
				});
				break;
			}
			case "gemini": {
				const config = getConfigByProvider("gemini");
				llm = new LLMProvider({
					provider: "gemini",
					baseConfig: config,
					getDefaultConfigByProvider: getConfigByProvider,
				});
				break;
			}
			case "anthropic": {
				const config = getConfigByProvider("anthropic");
				llm = new LLMProvider({
					provider: "anthropic",
					baseConfig: config,
					getDefaultConfigByProvider: getConfigByProvider,
				});
				break;
			}
			case "groq": {
				const config = getConfigByProvider("groq");
				llm = new LLMProvider({
					provider: "groq",
					baseConfig: config,
					getDefaultConfigByProvider: getConfigByProvider,
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

		// Parse the file into a CanvasData object
		const canvasData = await this.fetchData(file);


		const cannoliSettings = {
			contentIsColorless: this.settings.contentIsColorless ?? false,
			chatFormatString: this.settings.chatFormatString ?? DEFAULT_SETTINGS.chatFormatString
		};
		const cannoliArgs = {
			currentNote: `[[${this.app.workspace.getActiveFile()?.basename}]]` ??
				"No active note",
			selection: this.app.workspace.activeEditor?.editor?.getSelection() ? this.app.workspace.activeEditor?.editor?.getSelection() : "No selection"
		};


		const canvas = new ObsidianCanvas(canvasData, file);

		const fetcher: ResponseTextFetcher = async (url: string, { body, method, headers }: RequestInit) => {
			const headersObj = Array.isArray(headers) ? Object.fromEntries(headers) : headers instanceof Headers ? {} : headers;
			const constrainedBody = typeof body === "string" ? body : body instanceof ArrayBuffer ? body : undefined;
			return requestUrl({ body: constrainedBody || undefined, method, headers: headersObj, url }).then(response => {
				return response.text
			});
		};

		const vaultInterface = new VaultInterface(this, fetcher);

		const messengers: Messenger[] = [];

		const hooksMessenger = new CannoliHooksMessenger(this.settings.cannoliWebsiteAPIKey);
		messengers.push(hooksMessenger);

		let discordMessenger: DiscordMessenger | undefined;

		if (this.settings.discordVaultID && this.settings.discordVaultKey) {
			discordMessenger = new DiscordMessenger(this.discordBotClient);
			messengers.push(discordMessenger);
		}

		const obsidianMessenger = new ObsidianMessenger(this.app);
		messengers.push(obsidianMessenger);

		const searchSources: SearchSource[] = [
			new ExaSearchSource(this.settings.exaAPIKey, this.settings.exaDefaultLimit),
			new SmartConnectionsSearchSource(vaultInterface)
		];

		// Make sure the default search source is first in the array
		const defaultSearchSource = searchSources.find(source => source.name === this.settings.defaultSearchSource);
		if (defaultSearchSource) {
			searchSources.unshift(defaultSearchSource);
		}


		// Do the validation run
		const [validationStoppagePromise] = runCannoli({
			llm: llm,
			cannoliJSON: canvasData,
			fileSystemInterface: vaultInterface,
			messengers: messengers,
			searchSources: searchSources,
			isMock: true,
			canvas: noCanvas ? undefined : canvas,
			fetcher: fetcher,
			settings: cannoliSettings,
			args: cannoliArgs
		});
		const validationStoppage = await validationStoppagePromise;


		if (validationStoppage.reason === "error") {
			new Notice(`Cannoli ${name} failed with the error:\n\n${validationStoppage.message}`);
			return;
		}

		let shouldContinue = true;

		// If the total price is greater than the threshold, ask the user if they want to continue
		if (validationStoppage.totalCost > this.settings.costThreshold) {
			shouldContinue = await this.showRunPriceAlertModal(validationStoppage.usage);
		}

		if (!shouldContinue) {
			new Notice(`Cannoli ${name} was cancelled due to cost.`);
			return;
		}

		// Do the live run
		const [liveStoppagePromise, stopLiveCannoli] = runCannoli({
			llm: llm,
			cannoliJSON: canvasData,
			fileSystemInterface: vaultInterface,
			messengers: messengers,
			searchSources: searchSources,
			isMock: false,
			canvas: noCanvas ? undefined : canvas,
			fetcher: fetcher,
			settings: cannoliSettings,
			args: cannoliArgs
		});

		// add to running cannolis
		this.runningCannolis[file.basename] = stopLiveCannoli;

		const liveStoppage = await liveStoppagePromise;

		delete this.runningCannolis[file.basename];


		let costString = "";

		// If the cost is less than 0.01, don't show the notice
		if (liveStoppage.totalCost > 0.01) {
			costString = `\n$${liveStoppage.totalCost.toFixed(2)}`;
		}

		if (liveStoppage.reason === "error") {
			new Notice(`Cannoli ${name} failed with the error:\n\n${liveStoppage.message}${costString}`);
		} else if (liveStoppage.reason === "complete") {
			new Notice(`Cannoli complete: ${name}${costString}`);
		} else {
			new Notice(`Cannoli stopped: ${name}${costString}`);
		}
	};

	async fetchData(file: TFile): Promise<CanvasData> {
		const fileContent = await this.app.vault.cachedRead(file);
		const parsedContent = JSON.parse(fileContent) as CanvasData;

		let subCanvasGroupId: string | undefined;

		for (const node of parsedContent.nodes) {
			if (node.type === "group" && (node.text === "cannoli" || node.text === "Cannoli")) {
				subCanvasGroupId = node.id;
				break;
			}
		}

		let canvasData = parsedContent;

		if (subCanvasGroupId) {
			const subCanvasGroup = parsedContent.nodes.find(
				(node) => node.id === subCanvasGroupId
			) as CanvasGroupData;
			if (!subCanvasGroup) {
				throw new Error(`Group with id ${subCanvasGroupId} not found.`);
			}

			const { nodeIds, edgeIds } = this.getNodesAndEdgesInGroup(subCanvasGroup, parsedContent);

			parsedContent.nodes = parsedContent.nodes.filter((node) => nodeIds.includes(node.id));
			parsedContent.edges = parsedContent.edges.filter((edge) => edgeIds.includes(edge.id));

			canvasData = parsedContent;
		}

		return canvasData;
	}

	getNodesAndEdgesInGroup(group: CanvasGroupData, canvasData: CanvasData): { nodeIds: string[]; edgeIds: string[] } {
		const groupRectangle = this.createRectangle(group.x, group.y, group.width, group.height);

		const nodeIds: string[] = [];
		const edgeIds: string[] = [];

		for (const node of canvasData.nodes) {
			if (node.id === group.id) continue;
			if (node.color === "1") continue;

			const nodeRectangle = this.createRectangle(node.x, node.y, node.width, node.height);

			if (this.encloses(groupRectangle, nodeRectangle)) {
				nodeIds.push(node.id);
			} else if (this.overlaps(groupRectangle, nodeRectangle)) {
				throw new Error(
					`Invalid layout: Node with id ${node.id} overlaps with the group but is not fully enclosed. Nodes should be fully inside or outside of each group.`
				);
			}
		}

		for (const edge of canvasData.edges) {
			if (nodeIds.includes(edge.fromNode) && nodeIds.includes(edge.toNode)) {
				edgeIds.push(edge.id);
			}
		}

		return { nodeIds, edgeIds };
	}

	createRectangle(x: number, y: number, width: number, height: number) {
		return {
			x,
			y,
			width,
			height,
			x_right: x + width,
			y_bottom: y + height,
		};
	}

	encloses(a: ReturnType<typeof this.createRectangle>, b: ReturnType<typeof this.createRectangle>): boolean {
		return a.x <= b.x && a.y <= b.y && a.x_right >= b.x_right && a.y_bottom >= b.y_bottom;
	}

	overlaps(a: ReturnType<typeof this.createRectangle>, b: ReturnType<typeof this.createRectangle>): boolean {
		const horizontalOverlap = a.x < b.x_right && a.x_right > b.x;
		const verticalOverlap = a.y < b.y_bottom && a.y_bottom > b.y;
		return horizontalOverlap && verticalOverlap;
	}

	showRunPriceAlertModal = (usage: Record<string, Usage>): Promise<boolean> => {
		return new Promise((resolve) => {
			const onContinueCallback = () => resolve(true);
			const onCancelCallback = () => resolve(false);

			new RunPriceAlertModal(
				this.app,
				usage,
				onContinueCallback,
				onCancelCallback
			).open();
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

		// Send a Notice that the folder has been created
		new Notice("Cannoli College folder added");
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

		// Add some space between the header and the description
		contentEl.createEl("div", { cls: "spacer" });

		// Insert a spacer element
		contentEl.createEl("div", { cls: "spacer", attr: { style: "height: 20px;" } });

		const createDescription = (text: string) => {
			const p = contentEl.createEl("p", {
				cls: "http-template-description",
			});
			// Allow newlines in the description
			p.innerHTML = text.replace(/\n/g, "<br>");
			return p;
		};

		// Brief description of what this modal does
		createDescription(
			`This modal allows you to edit the template for an action node. You can use this template to predefine the structure of http requests.\n\nUse {{variableName}} syntax to insert variables anywhere in the request. If there's only one variable, it will be replaced with whatever is written to the action node. If there are multiple variables, the action node will look for the variables in the available named arrows.`
		);

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
		urlInput.setAttribute("placeholder", "https://example.com/{{path}}");
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
				this.template.headers.length > 0
				? this.template.headers
				: `{ "Content-Type": "application/json" }`;

		const headersInput = contentEl.createEl("textarea") as HTMLTextAreaElement;

		headersInput.value = headersValue;
		headersInput.setAttribute("rows", "3");
		headersInput.setAttribute("placeholder", `{ "Content-Type": "application/json" }`);

		createInputGroup("Headers: (optional)", headersInput, "headers-input");

		// Body template input
		const bodyInput = contentEl.createEl("textarea", {
			placeholder:
				"Enter body. Use {{variableName}} for variables.",
		}) as HTMLTextAreaElement;

		const bodyValue = this.template.body ?? this.template.bodyTemplate ?? '';

		const formattedBody = this.formatBody(bodyValue);
		bodyInput.value = formattedBody;
		bodyInput.setAttribute("rows", "3");
		bodyInput.setAttribute(
			"placeholder",
			"Enter body template. Use {{variableName}} for variables."
		);
		createInputGroup(
			"Body: (optional)",
			bodyInput,
			"body-input"
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
					if (!urlInput.value) {
						alert("URL is required");
						return;
					}

					try {
						JSON.parse(headersInput.value || "{}");
					} catch (error) {
						alert(
							"Invalid JSON format for headers. Please correct and try again."
						);
						return;
					}

					// Updating template object
					this.template.name = nameInput.value;
					this.template.url = urlInput.value;
					this.template.headers = headersInput.value;
					this.template.method = methodSelect.value;
					this.template.body = bodyInput.value;

					// Delete deprecated bodyTemplate
					delete this.template.bodyTemplate;

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
		new Setting(containerEl)
			.setName("ValTown API key")
			.setDesc(
				`This key will be used to create Vals on your Val Town account when you run the "Create Val" command.`
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.valTownAPIKey)
					.setPlaceholder("...")
					.onChange(async (value) => {
						this.plugin.settings.valTownAPIKey = value;
						await this.plugin.saveSettings();
					}).inputEl.setAttribute("type", "password")
			);

		new Setting(containerEl)
			.setName("Cannoli.website API key")
			.setDesc(
				"Get an API key from our website to use hook nodes."
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.cannoliWebsiteAPIKey)
					.setPlaceholder("...")
					.onChange(async (value) => {
						this.plugin.settings.cannoliWebsiteAPIKey = value;
						await this.plugin.saveSettings();
					}).inputEl.setAttribute("type", "password")
			);

		// Discord bot settings
		new Setting(containerEl)
			.setName("Enable Discord Commands")
			.setDesc("Enable or disable the Discord bot to trigger cannolis on your vault using commands.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.discordCommandsEnabled)
					.onChange(async (value) => {
						this.plugin.settings.discordCommandsEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Manage Discord Bot Connection")
			.setDesc("Initialize and connect to the Discord bot, or delete the vault from the bot.")
			.addButton((button) => {
				if (this.plugin.settings.discordVaultID) {
					button.setButtonText("Disconnect")
						.setWarning()
						.onClick(async () => {
							this.plugin.discordBotClient.disconnect();
							const error = await this.plugin.discordBotClient.deleteVault();
							if (error) {
								new Notice("Failed to disconnect vault from Discord bot: " + error.message);
								return;
							}
							this.plugin.settings.discordVaultID = "";
							this.plugin.settings.discordVaultKey = "";
							this.plugin.settings.discordPrivateKey = "";
							this.plugin.settings.discordPublicKey = "";
							new Notice("Vault disconnected from Discord bot.");
							await this.plugin.saveSettings();
							this.display();
						});
				} else {
					button.setButtonText("Connect")
						.onClick(async () => {
							button.setDisabled(true);
							button.setButtonText("Connecting...");

							try {
								const { vaultKey, vaultID, privateKey, publicKey } = await this.plugin.discordBotClient.initializeVault();
								this.plugin.settings.discordVaultKey = vaultKey;
								this.plugin.settings.discordVaultID = vaultID;
								this.plugin.settings.discordPrivateKey = privateKey;
								this.plugin.settings.discordPublicKey = publicKey;
							} catch (error) {
								new Notice("Failed to connect to Discord bot: " + error.message);
							}

							try {
								this.plugin.discordBotClient.connect();
							} catch (error) {
								new Notice("Failed to start listening to Discord bot: " + error.message);
							}

							new Notice("Successfully connected to Discord bot.");

							button.setDisabled(false);
							button.setButtonText("Connect");
							await this.plugin.saveSettings();
							this.display();
						});
				}
			});

		new Setting(containerEl)
			.setName("Discord Bot Key")
			.setDesc("The key used initialize vaults on the Discord bot.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.discordBotKey ?? "")
					.onChange(async (value) => {
						this.plugin.settings.discordBotKey = value;
						await this.plugin.saveSettings();
					})
					.inputEl.setAttribute("type", "password")
			);

		new Setting(containerEl)
			.setName("Discord Bot URL")
			.setDesc("The URL of the Discord bot.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.discordBotUrl ?? "")
					.onChange(async (value) => {
						this.plugin.settings.discordBotUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Discord Vault Key")
			.setDesc(
				"Copy this key and give it to the discord bot using the 'link-vault' command. Only one discord server can be linked at a time. Linking a new server will unlink the server that's currently linked to this vault."
			)
			.addText((text) =>
				text
					.setValue((this.plugin.settings.discordVaultID && this.plugin.settings.discordVaultKey) ? `${this.plugin.settings.discordVaultID}:${this.plugin.settings.discordVaultKey}` : "")
					.setDisabled(true)
					.inputEl.setAttribute("type", "password")
			)
			.addButton((button) =>
				button
					.setButtonText("Copy")
					.setCta()
					.onClick(async () => {
						const key = `${this.plugin.settings.discordVaultID}:${this.plugin.settings.discordVaultKey}`;
						await navigator.clipboard.writeText(key);
						new Notice("Discord Vault Key copied to clipboard");
					})
			);


		// Add dropdown for AI provider with options OpenAI and Ollama
		new Setting(containerEl)
			.setName("AI Provider")
			.setDesc(
				"Choose which provider settings to edit. This dropdown will also select your default provider, which can be overridden at the node level using config arrows."
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
						}).inputEl.setAttribute("type", "password")
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
			// openai base url setting
			new Setting(containerEl)
				.setName("Openai base url")
				.setDesc(
					"This url will be used to make openai llm calls against a different endpoint. This is useful for switching to an azure enterprise endpoint, or, some other openai compatible service."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.openaiBaseURL)
						.setPlaceholder("https://api.openai.com/v1/")
						.onChange(async (value) => {
							this.plugin.settings.openaiBaseURL = value;
							await this.plugin.saveSettings();
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
			// Default LLM temperature setting
			new Setting(containerEl)
				.setName("Default LLM temperature")
				.setDesc(
					"This temperature will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(
							!isNaN(this.plugin.settings.ollamaTemperature) &&
								this.plugin.settings.ollamaTemperature
								? this.plugin.settings.ollamaTemperature.toString()
								: DEFAULT_SETTINGS.ollamaTemperature.toString()
						)
						.onChange(async (value) => {
							// If it's not empty and it's a number, save it
							if (!isNaN(parseFloat(value))) {
								this.plugin.settings.ollamaTemperature =
									parseFloat(value);
								await this.plugin.saveSettings();
							} else {
								// Otherwise, reset it to the default
								this.plugin.settings.ollamaTemperature =
									DEFAULT_SETTINGS.ollamaTemperature;
								await this.plugin.saveSettings();
							}
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
						}).inputEl.setAttribute("type", "password")
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
			// Default LLM temperature setting
			new Setting(containerEl)
				.setName("Default LLM temperature")
				.setDesc(
					"This temperature will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(
							!isNaN(this.plugin.settings.geminiTemperature) &&
								this.plugin.settings.geminiTemperature
								? this.plugin.settings.geminiTemperature.toString()
								: DEFAULT_SETTINGS.geminiTemperature.toString()
						)
						.onChange(async (value) => {
							// If it's not empty and it's a number, save it
							if (!isNaN(parseFloat(value))) {
								this.plugin.settings.geminiTemperature =
									parseFloat(value);
								await this.plugin.saveSettings();
							} else {
								// Otherwise, reset it to the default
								this.plugin.settings.geminiTemperature =
									DEFAULT_SETTINGS.geminiTemperature;
								await this.plugin.saveSettings();
							}
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
						}).inputEl.setAttribute("type", "password")
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
			// Default LLM temperature setting
			new Setting(containerEl)
				.setName("Default LLM temperature")
				.setDesc(
					"This temperature will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(
							!isNaN(this.plugin.settings.anthropicTemperature) &&
								this.plugin.settings.anthropicTemperature
								? this.plugin.settings.anthropicTemperature.toString()
								: DEFAULT_SETTINGS.anthropicTemperature.toString()
						)
						.onChange(async (value) => {
							// If it's not empty and it's a number, save it
							if (!isNaN(parseFloat(value))) {
								this.plugin.settings.anthropicTemperature =
									parseFloat(value);
								await this.plugin.saveSettings();
							} else {
								// Otherwise, reset it to the default
								this.plugin.settings.anthropicTemperature =
									DEFAULT_SETTINGS.anthropicTemperature;
								await this.plugin.saveSettings();
							}
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
						}).inputEl.setAttribute("type", "password")
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
			// Default LLM temperature setting
			new Setting(containerEl)
				.setName("Default LLM temperature")
				.setDesc(
					"This temperature will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(
							!isNaN(this.plugin.settings.groqTemperature) &&
								this.plugin.settings.groqTemperature
								? this.plugin.settings.groqTemperature.toString()
								: DEFAULT_SETTINGS.groqTemperature.toString()
						)
						.onChange(async (value) => {
							// If it's not empty and it's a number, save it
							if (!isNaN(parseFloat(value))) {
								this.plugin.settings.groqTemperature =
									parseFloat(value);
								await this.plugin.saveSettings();
							} else {
								// Otherwise, reset it to the default
								this.plugin.settings.groqTemperature =
									DEFAULT_SETTINGS.groqTemperature;
								await this.plugin.saveSettings();
							}
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


		containerEl.createEl("h1", { text: "Search" });

		new Setting(containerEl)
			.setName("Default search source")
			.setDesc("This search source will be used for all search nodes unless overridden with a config arrow.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("exa", "Exa")
					.addOption("smart-connections", "Smart connections")
					.setValue(this.plugin.settings.defaultSearchSource)
					.onChange(async (value) => {
						this.plugin.settings.defaultSearchSource = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Exa API key")
			.setDesc("This key will be used to make all Exa search calls.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.exaAPIKey)
					.setPlaceholder("...")
					.onChange(async (value) => {
						this.plugin.settings.exaAPIKey = value;
						await this.plugin.saveSettings();
					})
					.inputEl.setAttribute("type", "password")
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

		// Toggle including markdown links when extracting text from files
		new Setting(containerEl)
			.setName(
				"Include markdown links when extracting or editing notes by default"
			)
			.setDesc(
				`When extracting or editing a note in a cannoli, include the note's markdown link above the content. This default can be overridden by adding "@" or "!@" after the note link in a reference like this: {{[[Stuff]]@}} or {{[[Stuff]]!@}}.`
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.includeLinkInExtractedNotes ||
						false
					)
					.onChange(async (value) => {
						this.plugin.settings.includeLinkInExtractedNotes =
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
						headers: `{ "Content-Type": "application/json" }`,
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
