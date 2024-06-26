import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	RequestUrlParam,
	Setting,
	TFile,
	TFolder,
	addIcon,
	requestUrl,
} from "obsidian";
import {
	HttpTemplate,
	ResponseTextFetcher,
	SupportedProviders,
	CanvasData,
	CanvasGroupData,
	ModelUsage,
	LLMConfig,
	GenericModelConfig,
	dalleGenerate,
	exaSearch,
	valTownEvaluate,
	Replacer,
	runWithControl,
	bake,
	BakeLanguage,
	BakeRuntime
} from "@deablabs/cannoli-core";
import { cannoliCollege } from "../assets/cannoliCollege";
import { cannoliIcon } from "../assets/cannoliIcon";
import { VaultInterface } from "./vault_interface";
import { ObsidianCanvas } from "./canvas";
import { dataviewQuery, smartConnectionsQuery } from "./actions";

interface CannoliSettings {
	llmProvider: SupportedProviders;
	ollamaBaseUrl: string;
	ollamaModel: string;
	ollamaTemperature: number;
	azureAPIKey: string;
	azureModel: string;
	azureTemperature: number;
	azureOpenAIApiDeploymentName: string;
	azureOpenAIApiInstanceName: string;
	azureOpenAIApiVersion: string;
	azureBaseURL: string;
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
	requestThreshold: number;
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
	exaAPIKey: string;
	bakedCannoliFolder: string;
	bakeLanguage: BakeLanguage;
	bakeRuntime: BakeRuntime;
	bakeIndent: "2" | "4";
}

const DEFAULT_SETTINGS: CannoliSettings = {
	llmProvider: "openai",
	ollamaBaseUrl: "http://127.0.0.1:11434",
	ollamaModel: "llama2",
	ollamaTemperature: 1,
	azureModel: "",
	azureAPIKey: "",
	azureTemperature: 1,
	azureOpenAIApiDeploymentName: "",
	azureOpenAIApiInstanceName: "",
	azureOpenAIApiVersion: "",
	azureBaseURL: "",
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
	requestThreshold: 20,
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
	exaAPIKey: "",
	bakedCannoliFolder: "Baked Cannoli",
	bakeLanguage: "typescript",
	bakeRuntime: "node",
	bakeIndent: "2",
};

export default class Cannoli extends Plugin {
	settings: CannoliSettings;
	runningCannolis: { [key: string]: () => void } = {};

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

		this.createBakeToValTownCommand();

		this.createBakeCommand();

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

	createBakeToValTownCommand = () => {
		this.addCommand({
			id: "bake-to-val-town",
			name: "Bake to Val Town",
			callback: this.bakeToValTown,
			icon: "cannoli",
		});
	};

	createBakeCommand = () => {
		this.addCommand({
			id: "bake",
			name: "Bake",
			callback: this.bake,
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

	bakeToValTown = async () => {
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

		const nameWithoutExtensions = activeFile.basename.replace(".canvas", "").replace(".cno", "");

		// Get the content of the file
		const content = JSON.parse(await this.app.vault.read(activeFile));

		const bakeResult = await bake({
			language: "typescript",
			runtime: "deno",
			cannoliName: nameWithoutExtensions,
			cannoli: content,
			llmConfigs: this.getLLMConfigs(),
			fileManager: new VaultInterface(this),
			actions: this.getActions(),
			config: this.getConfig(true),
			envVars: this.getEnvVars(),
			httpTemplates: this.settings.httpTemplates,
		});

		if (bakeResult instanceof Error) {
			new Notice(`Error baking cannoli: ${bakeResult.message}`);
			return;
		}

		bakeResult.code = bakeResult.code.replace(/Deno\.env\.get\("VALTOWN_API_KEY"\)/g, 'Deno.env.get("valtown")');

		const userProfileResponse = await requestUrl({
			url: "https://api.val.town/v1/me",
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${this.settings.valTownAPIKey}`,
			},
		});

		const userProfileJson = await userProfileResponse.json;

		const userId = userProfileJson.id;

		const myValsResponse = await requestUrl({
			url: `https://api.val.town/v1/users/${userId}/vals`,
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${this.settings.valTownAPIKey}`,
			},
		});

		const myVals = myValsResponse.json.data as { name: string, id: string }[];

		// Check if the user has a val with the same name
		const existingVal = myVals.find(val => val.name === bakeResult.name);

		let editVal = false;

		if (existingVal) {
			// Make a modal to ask if they want to edit the existing val
			const userResponse = await new Promise<boolean>((resolve) => {
				const modal = new EditValModal(this.app, () => {
					resolve(true);
				}, () => {
					resolve(false);
				});
				modal.open();
			});

			if (userResponse) {
				editVal = true;
			} else {
				return;
			}
		}

		let response;

		if (editVal) {
			response = await requestUrl({
				url: `https://api.val.town/v1/vals/${existingVal?.id}/versions`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${this.settings.valTownAPIKey}`,
				},
				body: JSON.stringify({
					code: bakeResult.code,
				}),
			});
		} else {
			response = await requestUrl({
				url: "https://api.val.town/v1/vals",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${this.settings.valTownAPIKey}`,
				},
				body: JSON.stringify({
					name: bakeResult.name,
					code: bakeResult.code,
				}),
			});
		}

		// If the response is not ok, send a notice
		if (typeof response.json === "string") {
			new Notice(`Error creating Val: ${response.json}`);
			return;
		}

		const valUrl = `https://www.val.town/v/${response.json.author.username}/${response.json.name}`;

		new Notice(`${activeFile.basename} baked to Val Town`);

		// Redirect to the val
		window.open(valUrl, "_blank");
	};

	bake = async () => {
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

		const nameWithoutExtensions = activeFile.basename.replace(".canvas", "").replace(".cno", "");

		// Get the content of the file
		const content = JSON.parse(await this.app.vault.read(activeFile));

		const bakeResult = await bake({
			language: this.settings.bakeLanguage,
			runtime: this.settings.bakeRuntime,
			changeIndentToFour: this.settings.bakeIndent === "4",
			cannoliName: nameWithoutExtensions,
			cannoli: content,
			llmConfigs: this.getLLMConfigs(),
			fileManager: new VaultInterface(this),
			actions: this.getActions(),
			config: this.getConfig(true),
			envVars: this.getEnvVars(),
			httpTemplates: this.settings.httpTemplates,
		});

		if (bakeResult instanceof Error) {
			new Notice(`Error baking cannoli: ${bakeResult.message}`);
			return;
		}

		// Check that the baked cannoli folder exists
		let bakedCannoliFolder = this.app.vault.getFolderByPath(this.settings.bakedCannoliFolder);
		if (!bakedCannoliFolder) {
			await this.app.vault.createFolder(this.settings.bakedCannoliFolder);
			bakedCannoliFolder = this.app.vault.getFolderByPath(this.settings.bakedCannoliFolder);
		}

		// Function to find the file recursively
		const findFileRecursively = async (folder: TFolder, fileName: string): Promise<TFile | null> => {
			for (const child of folder.children) {
				if (child instanceof TFile && child.name === fileName) {
					return child;
				} else if (child instanceof TFolder) {
					const found = await findFileRecursively(child, fileName);
					if (found) return found;
				}
			}
			return null;
		};

		// Check if the file already exists
		if (bakedCannoliFolder) {
			const existingFile = await findFileRecursively(bakedCannoliFolder, bakeResult.fileName);
			if (existingFile) {
				// Overwrite the existing file
				await this.app.vault.modify(existingFile, bakeResult.code);
				new Notice(`Baked cannoli to ${existingFile.path}`);
			} else {
				// Create a new file in the vault in the "Baked Cannoli" folder
				const newFile = await this.app.vault.create(`${this.settings.bakedCannoliFolder}/${bakeResult.fileName}`, bakeResult.code);
				new Notice(`Baked cannoli to ${newFile.path}`);
			}
		}
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

	getEnvVars = () => {
		return {
			...(this.settings.openaiAPIKey ? { OPENAI_API_KEY: this.settings.openaiAPIKey } : {}),
			...(this.settings.exaAPIKey ? { EXA_API_KEY: this.settings.exaAPIKey } : {}),
			...(this.settings.valTownAPIKey ? { VALTOWN_API_KEY: this.settings.valTownAPIKey } : {}),
		};
	}

	getConfig = (forBake = false) => {
		const chatFormatStringIsDefault = this.settings.chatFormatString === DEFAULT_SETTINGS.chatFormatString || forBake;

		return {
			...(this.settings.contentIsColorless ? { contentIsColorless: this.settings.contentIsColorless } : {}),
			...(!chatFormatStringIsDefault ? { chatFormatString: this.settings.chatFormatString } : {}),
		};
	}

	getActions = () => {
		return [
			...(this.settings.openaiAPIKey ? [dalleGenerate] : []),
			...(this.settings.exaAPIKey ? [exaSearch] : []),
			dataviewQuery,
			smartConnectionsQuery,
			valTownEvaluate
		];
	}

	getLLMConfigs = () => {
		// map cannoli settings to provider config
		const getConfigByProvider = (p: SupportedProviders): GenericModelConfig => {
			switch (p) {
				case "openai":
					return {
						apiKey: this.settings.openaiAPIKey,
						model: this.settings.defaultModel,
						temperature: this.settings.defaultTemperature,
						baseURL: this.settings.openaiBaseURL,
					};
				case "azure_openai":
					return {
						apiKey: this.settings.azureAPIKey,
						model: this.settings.azureModel,
						temperature: this.settings.azureTemperature,
						azureOpenAIApiDeploymentName: this.settings.azureOpenAIApiDeploymentName,
						azureOpenAIApiInstanceName: this.settings.azureOpenAIApiInstanceName,
						azureOpenAIApiVersion: this.settings.azureOpenAIApiVersion,
						baseURL: this.settings.azureBaseURL,
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

		const providers: SupportedProviders[] = ["openai", "azure_openai", "ollama", "gemini", "anthropic", "groq"];
		const llmConfigs: LLMConfig[] = providers
			.map((provider) => ({
				...getConfigByProvider(provider),
				provider,
			}))

		// Ensure the default provider is first
		const defaultProviderIndex = llmConfigs.findIndex((config) => config.provider === this.settings.llmProvider);
		const defaultProvider = llmConfigs[defaultProviderIndex];
		if (defaultProviderIndex !== 0) {
			llmConfigs.splice(defaultProviderIndex, 1);
			llmConfigs.unshift(defaultProvider);
		}

		return llmConfigs;
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

		const llmConfigs = this.getLLMConfigs();

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

		const cannoliArgs = {
			obsidianCurrentNote: `[[${this.app.workspace.getActiveFile()?.basename}]]` ??
				"No active note",
			obsidianSelection: this.app.workspace.activeEditor?.editor?.getSelection() ? this.app.workspace.activeEditor?.editor?.getSelection() : "No selection"
		};

		const canvas = new ObsidianCanvas(canvasData, file);

		const fetcher: ResponseTextFetcher = async (url: string, { body, method, headers }: RequestInit) => {
			const headersObj = Array.isArray(headers) ? Object.fromEntries(headers) : headers instanceof Headers ? {} : headers;
			const constrainedBody = typeof body === "string" ? body : body instanceof ArrayBuffer ? body : undefined;
			return requestUrl({ body: constrainedBody || undefined, method, headers: headersObj, url }).then(response => {
				return response.text;
			});
		};

		const vaultInterface = new VaultInterface(this);

		const replacers: Replacer[] = [
			vaultInterface.replaceDataviewQueries,
			vaultInterface.replaceSmartConnections
		];

		const config = this.getConfig();

		const envVars = this.getEnvVars();

		const actions = this.getActions();

		// Do the validation run
		const [validationStoppagePromise] = await runWithControl({
			cannoli: canvasData,
			llmConfigs: llmConfigs,
			actions: actions,
			httpTemplates: this.settings.httpTemplates,
			replacers: replacers,
			config: config,
			envVars: envVars,
			fetcher: fetcher,
			args: cannoliArgs,
			persistor: noCanvas ? undefined : canvas,
			fileManager: vaultInterface,
			isMock: true
		});

		const validationStoppage = await validationStoppagePromise;

		if (validationStoppage.reason === "error") {
			new Notice(`Cannoli ${name} failed with the error:\n\n${validationStoppage.message}`);
			return;
		}

		let shouldContinue = true;

		let totalCalls = 0;

		// For all models in the usage object, add up the number of calls
		for (const model in validationStoppage.usage) {
			totalCalls += validationStoppage.usage[model].numberOfCalls;
		}

		// If the total number of requests is greater than the threshold, ask the user if they want to continue
		if (totalCalls > this.settings.requestThreshold) {
			shouldContinue = await this.showRunUsageAlertModal(validationStoppage.usage);
		}

		if (!shouldContinue) {
			new Notice(`Cannoli ${name} was cancelled.`);
			return;
		}

		// Do the live run
		const [liveStoppagePromise, stopLiveCannoli] = await runWithControl({
			cannoli: canvasData,
			llmConfigs: llmConfigs,
			actions: actions,
			httpTemplates: this.settings.httpTemplates,
			replacers: replacers,
			config: config,
			envVars: envVars,
			fetcher: fetcher,
			args: cannoliArgs,
			persistor: noCanvas ? undefined : canvas,
			fileManager: vaultInterface,
			isMock: false,
		});

		// add to running cannolis
		this.runningCannolis[file.basename] = stopLiveCannoli;

		const liveStoppage = await liveStoppagePromise;

		delete this.runningCannolis[file.basename];


		let usageString = "";

		if (liveStoppage.usage) {
			let totalCalls = 0;
			let totalPromptTokens = 0;
			let totalCompletionTokens = 0;

			for (const model in liveStoppage.usage) {
				totalCalls += liveStoppage.usage[model].numberOfCalls;
				totalPromptTokens += liveStoppage.usage[model].promptTokens ?? 0;
				totalCompletionTokens += liveStoppage.usage[model].completionTokens ?? 0;
			}

			if (totalCalls > 0) {
				usageString = `\nAI Requests: ${totalCalls}`;
			}

			if (totalPromptTokens > 0) {
				usageString += `\nPrompt Tokens: ${totalPromptTokens}`;
			}
			if (totalCompletionTokens > 0) {
				usageString += `\nCompletion Tokens: ${totalCompletionTokens}`;
			}
		}

		if (liveStoppage.reason === "error") {
			new Notice(`Cannoli ${name} failed with the error:\n\n${liveStoppage.message}${usageString}`);
		} else if (liveStoppage.reason === "complete") {
			new Notice(`Cannoli complete: ${name}${usageString}`);
		} else {
			new Notice(`Cannoli stopped: ${name}${usageString}`);
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

	showRunUsageAlertModal = (usage: Record<string, ModelUsage>): Promise<boolean> => {
		return new Promise((resolve) => {
			const onContinueCallback = () => resolve(true);
			const onCancelCallback = () => resolve(false);

			new RunPriceAlertModal(
				this.app,
				usage,
				this.settings.requestThreshold,
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

export class EditValModal extends Modal {
	onContinue: () => void;
	onCancel: () => void;

	constructor(
		app: App,
		onContinue: () => void,
		onCancel: () => void,
	) {
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
		panel.addButton((btn) => btn.setButtonText("Yes, Update")
			.setCta()
			.onClick(() => {
				this.close();
				this.onContinue();
			}));
		panel.addButton((btn) => btn.setButtonText("No, Cancel").onClick(() => {
			this.close();
			this.onCancel();
		}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// export class BakeModal extends Modal {
// 	onContinue: (options: {
// 		language: BakeLanguage,
// 		runtime: BakeRuntime
// 	}) => void;
// 	onCancel: () => void;

// 	constructor(
// 		app: App,
// 		onContinue: (options: { language: BakeLanguage, runtime: BakeRuntime }) => void,
// 		onCancel: () => void,
// 	) {
// 		super(app);
// 		this.onContinue = onContinue;
// 		this.onCancel = onCancel;
// 	}

// 	onOpen() {
// 		const { contentEl } = this;
// 		contentEl.createEl("h1", { text: "Bake Cannoli" });

// 		contentEl.createEl("p", {
// 			text: "Select the language and runtime for baking the cannoli.",
// 		});

// 		let selectedLanguage: BakeLanguage = "typescript";
// 		let selectedRuntime: BakeRuntime = "node";

// 		// Language dropdown
// 		new Setting(contentEl)
// 			.setName("Language")
// 			.setDesc("Choose the language for the cannoli.")
// 			.addDropdown((dropdown) => {
// 				dropdown.addOption("typescript", "TypeScript");
// 				dropdown.addOption("javascript", "JavaScript");
// 				dropdown.setValue(selectedLanguage);
// 				dropdown.onChange((value) => {
// 					selectedLanguage = value as BakeLanguage;
// 				});
// 			});

// 		// Runtime dropdown
// 		new Setting(contentEl)
// 			.setName("Runtime")
// 			.setDesc("Choose the runtime for the cannoli.")
// 			.addDropdown((dropdown) => {
// 				dropdown.addOption("node", "Node.js");
// 				dropdown.addOption("deno", "Deno");
// 				dropdown.addOption("bun", "Bun");
// 				dropdown.setValue(selectedRuntime);
// 				dropdown.onChange((value) => {
// 					selectedRuntime = value as BakeRuntime;
// 				});
// 			});

// 		contentEl.createEl("p", {
// 			text: "Reminder: To see the files, ensure the 'Detect all file extensions' setting is turned on in the 'Files and links' page of your Obsidian settings.",
// 		});

// 		const panel = new Setting(contentEl);
// 		panel.addButton((btn) => btn.setButtonText("Cancel").onClick(() => {
// 			this.close();
// 			this.onCancel();
// 		}));
// 		panel.addButton((btn) => btn.setButtonText("Bake").setCta().onClick(() => {
// 			this.close();
// 			this.onContinue({ language: selectedLanguage, runtime: selectedRuntime });
// 		}));
// 	}

// 	onClose() {
// 		const { contentEl } = this;
// 		contentEl.empty();
// 	}
// }

export class RunPriceAlertModal extends Modal {
	usage: Record<string, ModelUsage>;
	onContinue: () => void;
	onCancel: () => void;
	requestThreshold: number;

	constructor(
		app: App,
		usage: Record<string, ModelUsage>,
		requestThreshold: number,
		onContinue: () => void,
		onCancel: () => void,
	) {
		super(app);
		this.usage = usage;
		this.onContinue = onContinue;
		this.onCancel = onCancel;
		this.requestThreshold = requestThreshold;
	}

	onOpen() {
		const { contentEl } = this;

		let totalCalls = 0;
		let totalPromptTokens = 0;

		for (const usage of Object.values(this.usage)) {
			totalCalls += usage.numberOfCalls;
			totalPromptTokens += usage.promptTokens ?? 0;
		}

		contentEl.createEl("h1", { text: "Run usage alert" });
		contentEl.createEl("p", {
			text: `This run exceeds the AI requests threshold defined in your settings: ${this.requestThreshold}`,
		});

		// Convert usage object to array
		for (const [model, usage] of Object.entries(this.usage)) {
			contentEl.createEl("h2", { text: `Model: ${model}` });
			contentEl
				.createEl("p", {
					text: `\t\tEstimated prompt tokens: ${usage.promptTokens}`,
				})
				.addClass("whitespace");
			contentEl
				.createEl("p", {
					text: `\t\tNumber of AI requests: ${usage.numberOfCalls}`,
				})
				.addClass("whitespace");
		}

		contentEl.createEl("h2", {
			text: `Total AI requests: ${totalCalls}`,
		});

		contentEl.createEl("h2", {
			text: `Total estimated prompt tokens: ${totalPromptTokens}`,
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
				.setButtonText("Run anyway")
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

		// Add dropdown for AI provider with options OpenAI and Ollama
		new Setting(containerEl)
			.setName("AI Provider")
			.setDesc(
				"Choose which provider settings to edit. This dropdown will also select your default provider, which can be overridden at the node level using config arrows."
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("openai", "OpenAI");
				dropdown.addOption("azure_openai", "Azure OpenAI");
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

			// Request threshold setting. This is the number of AI requests at which the user will be alerted before running a Cannoli
			new Setting(containerEl)
				.setName("AI requests threshold")
				.setDesc(
					"If the cannoli you are about to run is estimated to make more than this amount of AI requests, you will be alerted before running it."
				)
				.addText((text) =>
					text
						.setValue(
							Number.isInteger(this.plugin.settings.requestThreshold)
								? this.plugin.settings.requestThreshold.toString()
								: DEFAULT_SETTINGS.requestThreshold.toString()
						)
						.onChange(async (value) => {
							// If it's not empty and it's an integer, save it
							if (!isNaN(parseInt(value)) && Number.isInteger(parseInt(value))) {
								this.plugin.settings.requestThreshold = parseInt(value);
								await this.plugin.saveSettings();
							} else {
								// Otherwise, reset it to the default
								this.plugin.settings.requestThreshold = DEFAULT_SETTINGS.requestThreshold;
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
		} else if (this.plugin.settings.llmProvider === "azure_openai") {
			// azure openai api key setting
			new Setting(containerEl)
				.setName("Azure OpenAI API key")
				.setDesc(
					"This key will be used to make all Azure OpenAI LLM calls. Be aware that complex cannolis, can be expensive to run."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.azureAPIKey)
						.setPlaceholder("sk-...")
						.onChange(async (value) => {
							this.plugin.settings.azureAPIKey = value;
							await this.plugin.saveSettings();
						}).inputEl.setAttribute("type", "password")
				);
			// azure openai model setting
			new Setting(containerEl)
				.setName("Azure OpenAI model")
				.setDesc(
					"This model will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.azureModel)
						.onChange(async (value) => {
							this.plugin.settings.azureModel = value;
							await this.plugin.saveSettings();
						})
				);
			// Default LLM temperature setting
			new Setting(containerEl)
				.setName("LLM temperature")
				.setDesc(
					"This temperature will be used for all LLM nodes unless overridden with a config arrow."
				)
				.addText((text) =>
					text
						.setValue(
							!isNaN(this.plugin.settings.azureTemperature) &&
								this.plugin.settings.azureTemperature
								? this.plugin.settings.azureTemperature.toString()
								: DEFAULT_SETTINGS.azureTemperature.toString()
						)
						.onChange(async (value) => {
							// If it's not empty and it's a number, save it
							if (!isNaN(parseFloat(value))) {
								this.plugin.settings.azureTemperature =
									parseFloat(value);
								await this.plugin.saveSettings();
							} else {
								// Otherwise, reset it to the default
								this.plugin.settings.azureTemperature =
									DEFAULT_SETTINGS.azureTemperature;
								await this.plugin.saveSettings();
							}
						})
				);
			// azure openai api deployment name setting
			new Setting(containerEl)
				.setName("Azure OpenAI API deployment name")
				.setDesc(
					"This deployment will be used to make all Azure OpenAI LLM calls."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.azureOpenAIApiDeploymentName)
						.setPlaceholder("deployment-name")
						.onChange(async (value) => {
							this.plugin.settings.azureOpenAIApiDeploymentName = value;
							await this.plugin.saveSettings();
						})
				);

			// azure openai api instance name setting
			new Setting(containerEl)
				.setName("Azure OpenAI API instance name")
				.setDesc(
					"This instance will be used to make all Azure OpenAI LLM calls."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.azureOpenAIApiInstanceName)
						.setPlaceholder("instance-name")
						.onChange(async (value) => {
							this.plugin.settings.azureOpenAIApiInstanceName = value;
							await this.plugin.saveSettings();
						})
				);

			// azure openai api version setting
			new Setting(containerEl)
				.setName("Azure OpenAI API version")
				.setDesc(
					"This version will be used to make all Azure OpenAI LLM calls. Be aware that complex cannolis, can be expensive to run."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.azureOpenAIApiVersion)
						.setPlaceholder("xxxx-xx-xx")
						.onChange(async (value) => {
							this.plugin.settings.azureOpenAIApiVersion = value;
							await this.plugin.saveSettings();
						})
				);

			// azure base url setting
			new Setting(containerEl)
				.setName("Azure base url")
				.setDesc(
					"This url will be used to make azure openai llm calls against a different endpoint. This is useful for switching to an azure enterprise endpoint, or, some other openai compatible service."
				)
				.addText((text) =>
					text
						.setValue(this.plugin.settings.azureBaseURL)
						.setPlaceholder("https://api.openai.com/v1/")
						.onChange(async (value) => {
							this.plugin.settings.azureBaseURL = value;
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

		containerEl.createEl("h1", { text: "Integrations" });

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
			.setName("Exa API key")
			.setDesc("This key will be used to make all Exa search requests.")
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

		containerEl.createEl("h1", { text: "Baking" });

		// Filepath for baked cannoli folder
		new Setting(containerEl)
			.setName("Baked cannoli folder")
			.setDesc("The path to the folder where baked cannoli will be saved. There can be subfolders.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.bakedCannoliFolder)
					.onChange(async (value) => {
						this.plugin.settings.bakedCannoliFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Language")
			.addDropdown((dropdown) => {
				dropdown.addOption("typescript", "Typescript");
				dropdown.addOption("javascript", "Javascript");
				dropdown.setValue(this.plugin.settings.bakeLanguage);
				dropdown.onChange(async (value) => {
					this.plugin.settings.bakeLanguage = value as BakeLanguage;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Runtime")
			.addDropdown((dropdown) => {
				dropdown.addOption("node", "Node");
				dropdown.addOption("deno", "Deno");
				dropdown.addOption("bun", "Bun");
				dropdown.setValue(this.plugin.settings.bakeRuntime);
				dropdown.onChange(async (value) => {
					this.plugin.settings.bakeRuntime = value as BakeRuntime;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Indent")
			.addDropdown((dropdown) => {
				dropdown.addOption("2", "2");
				dropdown.addOption("4", "4");
				dropdown.setValue(this.plugin.settings.bakeIndent);
				dropdown.onChange(async (value) => {
					this.plugin.settings.bakeIndent = value as "2" | "4";
					await this.plugin.saveSettings();
				});
			});

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
