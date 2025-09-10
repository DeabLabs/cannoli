import {
  Notice,
  Plugin,
  RequestUrlParam,
  TFile,
  TFolder,
  addIcon,
  requestUrl,
} from "obsidian";
import {
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
  valTownSendEmail,
  Replacer,
  run,
  bake,
  CannoliFunctionInfo,
  parseCannoliFunctionInfo,
  BakeResult,
} from "@deablabs/cannoli-core";
import { cannoliCollege } from "../assets/cannoliCollege";
import { cannoliIcon } from "../assets/cannoliIcon";
import { VaultInterface } from "./vault_interface";
import { CanvasPersistor } from "./canvas";
import { dataviewQuery, smartConnectionsQuery, modalMaker } from "./actions";
import { Version2Modal } from "./modals/versionTwoModal";
import { ValTownModal } from "./modals/viewVals";
import { EditValModal } from "./modals/editVal";
import { RunPriceAlertModal } from "./modals/runPriceAlert";
import { CannoliSettings, DEFAULT_SETTINGS } from "./settings/settings";
import { CannoliSettingTab } from "./settings/settingsTab";

export default class Cannoli extends Plugin {
  settings: CannoliSettings;
  runningCannolis: { [key: string]: () => void } = {};

  async onload() {
    await this.loadSettings();

    if (!this.settings.seenVersion2Modal) {
      this.openVersion2Modal();
      this.settings.seenVersion2Modal = true;
      await this.saveSettings();
    }

    // Create a command whenever a file is renamed to be a cannoli file
    this.registerEvent(
      this.app.vault.on("rename", (file: TFile, oldPath: string) => {
        if (file.name.includes(".cno.canvas")) {
          this.createCannoliCommandForFile(file);
        }
      }),
    );

    // Create a command whenever a file is created and is a cannoli file
    this.registerEvent(
      this.app.vault.on("create", (file: TFile) => {
        if (file.name.includes(".cno.canvas")) {
          this.createCannoliCommandForFile(file);
        }
      }),
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
      }),
    );

    addIcon("cannoli", cannoliIcon);

    // Add command for running a cannoli
    this.createStartCommand();

    this.createCannoliCommands();

    if (process.env.NODE_ENV !== "production") {
      this.createOpenOnWebsiteCommand();
      this.createOpenOnWebsiteDevCommand();
    }

    this.createCopyCanvasToClipboardCommand();

    this.createViewValsCommand();

    this.createBakeToValTownCommand();

    this.createBakeCommand();

    // This creates an icon in the left ribbon.
    this.addRibbonIcon(
      "cannoli",
      "Start/stop cannoli",
      this.startActiveCannoliCommand,
    );

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new CannoliSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
  };

  createCopyCanvasToClipboardCommand = () => {
    this.addCommand({
      id: "copy-canvas-to-clipboard",
      name: "Copy canvas to clipboard",
      callback: this.copyCanvasToClipboard,
      icon: "cannoli",
    });
  };

  createViewValsCommand = () => {
    this.addCommand({
      id: "view-vals",
      name: "View vals",
      callback: this.openValTownModal,
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

  openVersion2Modal = async () => {
    const modal = new Version2Modal(
      this.app,
      this.createVersion2UpdateParagraph(),
    );
    modal.open();
  };

  createVersion2UpdateParagraph(): HTMLParagraphElement {
    const paragraph = createEl("p");
    paragraph.style.paddingLeft = "12px";
    paragraph.style.borderLeft = "2px solid var(--interactive-accent)";

    const dateSpan = createEl("span", { text: "8-11-2024" });
    dateSpan.style.opacity = "0.5";
    paragraph.appendChild(dateSpan);
    paragraph.appendChild(createEl("br"));
    paragraph.appendChild(createEl("br"));

    paragraph.appendText("🎉 Cannoli 2.0 is here! 🎉");
    paragraph.appendChild(createEl("br"));
    paragraph.appendChild(createEl("br"));
    paragraph.appendText(
      "There's a ton of new stuff in this update, including:",
    );
    paragraph.appendChild(createEl("br"));
    paragraph.appendChild(createEl("br"));
    paragraph.appendText("🔀 Parallel groups");
    paragraph.appendChild(createEl("br"));
    paragraph.appendText("👁️ Built-in LLM vision");
    paragraph.appendChild(createEl("br"));
    paragraph.appendText("🔧 New Action node features");
    paragraph.appendChild(createEl("br"));
    paragraph.appendText("☁️ Val Town integrations");
    paragraph.appendChild(createEl("br"));
    paragraph.appendText("📦 The cannoli-core npm package");
    paragraph.appendChild(createEl("br"));
    paragraph.appendChild(createEl("br"));
    paragraph.appendText(
      "We rewrote a lot of core cannoli code to support this release,",
    );
    paragraph.appendChild(createEl("br"));
    paragraph.appendText(
      "so if anything is broken, or you just wanna hang out with us,",
    );
    paragraph.appendChild(createEl("br"));
    paragraph.appendText("let us know on the discord here: ");
    paragraph.appendChild(
      createEl("a", {
        text: "https://discord.gg/wzayNxpxvR",
        href: "https://discord.gg/wzayNxpxvR",
      }),
    );
    paragraph.appendChild(createEl("br"));
    paragraph.appendChild(createEl("br"));
    paragraph.appendText("Check out the ");
    paragraph.appendChild(
      createEl("a", {
        text: "release notes",
        href: "https://docs.cannoli.website/Blog/Release+Notes+8-11-2024",
      }),
    );
    paragraph.appendText(" for more details! 🍝✨");

    return paragraph;
  }

  openOnWebsite = async (dev?: boolean) => {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return;
    const url = dev
      ? "http://localhost:5173/canvas/open"
      : "https://cannoli.website/canvas/open";

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

  openValTownModal = async () => {
    const modal = new ValTownModal(
      this.app,
      await this.getAllCannoliFunctions(),
      this.getAllCannoliFunctions,
      this.openCanvas,
      this.settings.valTownAPIKey,
      this.bakeToValTown,
      this.createCanvas,
    );
    modal.open();
  };

  bakeToValTown = async (fileName?: string) => {
    let file: TFile | null;

    if (fileName) {
      file = this.app.metadataCache.getFirstLinkpathDest(fileName, "");
      if (!file) {
        new Notice("File not found");
        return;
      }
    } else {
      file = this.app.workspace.getActiveFile();
    }

    if (!file || !file.path.endsWith(".canvas")) {
      new Notice("This file is not a canvas");
      return;
    }

    // Check that the user has a val town api key
    if (!this.settings.valTownAPIKey) {
      new Notice("Please enter a Val Town API key in the Cannoli settings");
      return;
    }

    new Notice("Baking to Val Town...");

    // Get the content of the file
    const content = JSON.parse(await this.app.vault.read(file));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tracingConfig, ...config } = this.getConfig(true);

    const bakeResult = await bake({
      language: "typescript",
      runtime: "deno",
      canvasName: file.name,
      cannoli: content,
      llmConfigs: this.getLLMConfigs(),
      fileManager: new VaultInterface(this),
      actions: this.getActions(),
      config,
      secrets: this.getSecrets(),
      httpTemplates: this.settings.httpTemplates,
      includeTypes: false,
      includeMetadata: true,
      forValtown: true,
    });

    if (bakeResult instanceof Error) {
      new Notice(`Error baking cannoli: ${bakeResult.message}`);
      return;
    }

    bakeResult.code = bakeResult.code.replace(
      /Deno\.env\.get\("VALTOWN_API_KEY"\)/g,
      'Deno.env.get("valtown")',
    );

    const userProfileResponse = await requestUrl({
      url: "https://api.val.town/v1/me",
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.valTownAPIKey}`,
      },
    });

    const userProfileJson = await userProfileResponse.json;
    const userId = userProfileJson.id;

    // Fetch all cannoli functions
    const cannoliFunctions = await this.getAllCannoliFunctions();
    //const cannoliFunctionNames = cannoliFunctions.map(func => func.cannoliFunctionInfo.name);

    // Check if the val is a known cannoli val
    const existingCannoliFunction = cannoliFunctions.find(
      (func) => func.cannoliFunctionInfo.name === bakeResult.cannoliInfo.name,
    );
    if (existingCannoliFunction) {
      // Update the existing cannoli val without asking
      await this.updateVal(bakeResult, existingCannoliFunction.id);
      return;
    }

    // Fetch all vals
    const myValsResponse = await requestUrl({
      url: `https://api.val.town/v1/users/${userId}/vals`,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.valTownAPIKey}`,
      },
    });

    const myVals = myValsResponse.json.data as {
      name: string;
      id: string;
    }[];

    // Check if the user has a val with the same name
    const existingVal = myVals.find(
      (val) => val.name === bakeResult.cannoliInfo.name,
    );

    if (existingVal) {
      // Make a modal to ask if they want to edit the existing val
      const userResponse = await new Promise<boolean>((resolve) => {
        const modal = new EditValModal(
          this.app,
          () => {
            resolve(true);
          },
          () => {
            resolve(false);
          },
        );
        modal.open();
      });

      if (userResponse) {
        await this.updateVal(bakeResult, existingVal.id);
      } else {
        return;
      }
    } else {
      await this.createVal(bakeResult);
    }
  };

  async updateVal(bakeResult: BakeResult, valId: string) {
    const newVersionResponse = await requestUrl({
      url: `https://api.val.town/v1/vals/${valId}/versions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.valTownAPIKey}`,
      },
      body: JSON.stringify({
        code: bakeResult.code,
        type: "http",
      }),
    });

    if (typeof newVersionResponse.json === "string") {
      new Notice(`Error updating Val: ${newVersionResponse.json}`);
      return;
    }

    const updateResponse = await requestUrl({
      url: `https://api.val.town/v1/vals/${valId}`,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.valTownAPIKey}`,
      },
      body: JSON.stringify({
        readme: bakeResult.readme,
      }),
    });

    if (updateResponse.status !== 204) {
      new Notice(`Error updating Val`);
      return;
    }

    new Notice(`${bakeResult.cannoliInfo.name} updated on Val Town`);
  }

  async createVal(bakeResult: BakeResult) {
    const response = await requestUrl({
      url: "https://api.val.town/v1/vals",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.valTownAPIKey}`,
      },
      body: JSON.stringify({
        name: bakeResult.cannoliInfo.name,
        code: bakeResult.code,
        type: "http",
        privacy: "private",
        readme: bakeResult.readme,
      }),
    });

    if (typeof response.json === "string") {
      new Notice(`Error creating Val: ${response.json}`);
      return;
    }

    const valUrl = `https://www.val.town/v/${response.json.author.username}/${response.json.name}`;
    new Notice(`${bakeResult.cannoliInfo.name} baked to Val Town`);
    window.open(valUrl, "_blank");
  }

  bake = async () => {
    // Check if the user's on a canvas
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || !activeFile.path.endsWith(".canvas")) {
      new Notice("This file is not a canvas");
      return;
    }

    // Get the content of the file
    const content = JSON.parse(await this.app.vault.read(activeFile));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tracingConfig, ...config } = this.getConfig(true);

    const bakeResult = await bake({
      language: this.settings.bakeLanguage,
      runtime: this.settings.bakeRuntime,
      changeIndentToFour: this.settings.bakeIndent === "4",
      canvasName: activeFile.name,
      cannoli: content,
      llmConfigs: this.getLLMConfigs(),
      fileManager: new VaultInterface(this),
      actions: this.getActions(),
      config,
      secrets: this.getSecrets(),
      httpTemplates: this.settings.httpTemplates,
      includeTypes: true,
    });

    if (bakeResult instanceof Error) {
      new Notice(`Error baking cannoli: ${bakeResult.message}`);
      return;
    }

    // Check that the baked cannoli folder exists
    let bakedCannoliFolder = this.app.vault.getFolderByPath(
      this.settings.bakedCannoliFolder,
    );
    if (!bakedCannoliFolder) {
      await this.app.vault.createFolder(this.settings.bakedCannoliFolder);
      bakedCannoliFolder = this.app.vault.getFolderByPath(
        this.settings.bakedCannoliFolder,
      );
    }

    // Function to find the file recursively
    const findFileRecursively = async (
      folder: TFolder,
      fileName: string,
    ): Promise<TFile | null> => {
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
      const existingFile = await findFileRecursively(
        bakedCannoliFolder,
        bakeResult.fileName,
      );
      if (existingFile) {
        // Overwrite the existing file
        await this.app.vault.modify(existingFile, bakeResult.code);
        new Notice(`Baked cannoli to ${existingFile.path}`);
      } else {
        // Create a new file in the vault in the "Baked Cannoli" folder
        const newFile = await this.app.vault.create(
          `${this.settings.bakedCannoliFolder}/${bakeResult.fileName}`,
          bakeResult.code,
        );
        new Notice(`Baked cannoli to ${newFile.path}`);
      }
    }
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

      this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
        if (frontmatter.cannoli) {
          // Get the file
          // Only take before the first pipe, if there is one
          const filename = frontmatter.cannoli
            .replace("[[", "")
            .replace("]]", "")
            .split("|")[0];

          const file = this.app.metadataCache.getFirstLinkpathDest(
            filename,
            "",
          );

          if (!file) {
            return null;
          }

          this.startOrStopCannoli(file);
        }
      });
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
    this.app.fileManager.processFrontMatter(activeFile, async (frontmatter) => {
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

        const cannoliFile = this.app.metadataCache.getFirstLinkpathDest(
          cannoliFilename,
          "",
        );

        if (!cannoliFile) {
          return null;
        }

        await this.replaceAudioWithTranscript(activeFile, audio);

        this.startCannoli(cannoliFile);
      } else {
        return null;
      }
    });
  };

  getAllCannoliFunctions = async () => {
    const response = await requestUrl({
      url: `https://api.val.town/v1/me`,
      headers: {
        Authorization: `Bearer ${this.settings.valTownAPIKey}`,
      },
    });

    if (response.status !== 200) {
      throw new Error("Failed to fetch val.town profile");
    }

    const profile = await response.json;

    const valsResponse = await requestUrl({
      url: `https://api.val.town/v1/users/${profile.id}/vals`,
      headers: {
        Authorization: `Bearer ${this.settings.valTownAPIKey}`,
      },
    });

    if (valsResponse.status !== 200) {
      throw new Error("Failed to fetch vals");
    }

    const data = await valsResponse.json;
    const vals = data.data;
    const allCannoliFunctions: {
      id: string;
      link: string;
      moduleUrl: string;
      httpEndpointUrl: string;
      cannoliFunctionInfo: CannoliFunctionInfo;
      identicalToLocal: boolean;
      localExists: boolean;
    }[] = [];

    for (const val of vals) {
      const cannoliInfo = parseCannoliFunctionInfo(val.code);

      if (cannoliInfo !== null) {
        const localFile = this.app.metadataCache.getFirstLinkpathDest(
          cannoliInfo.canvasName,
          "",
        );
        let localExists = false;

        if (localFile) {
          localExists = true;
        }

        let identicalToLocal = false;
        if (localFile) {
          identicalToLocal = await this.checkCannolisIdentical(
            cannoliInfo.cannoli,
            localFile,
          );
        }

        allCannoliFunctions.push({
          id: val.id,
          link: `https://www.val.town/v/${profile.username}/${val.name}`,
          moduleUrl: `https://esm.town/v/${profile.username}/${val.name}`,
          httpEndpointUrl: `https://${profile.username}-${val.name.toLowerCase()}.web.val.run`,
          cannoliFunctionInfo: cannoliInfo,
          identicalToLocal,
          localExists,
        });
      }
    }

    return allCannoliFunctions;
  };

  createProxyServer = async () => {
    // If they already have a proxy server, return
    if (this.settings.anthropicBaseURL) {
      new Notice(
        "You already have an anthropic baseURL configured, delete the current value to create a proxy server",
      );
      return;
    }

    const code = await requestUrl({
      url: "https://esm.town/v/cephalization/anthropicProxy",
      method: "GET",
    });

    if (code.status !== 200) {
      new Notice(`Error fetching proxy server code: ${code.text}`);
      return;
    }

    const response = await requestUrl({
      url: "https://api.val.town/v1/vals",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.valTownAPIKey}`,
      },
      body: JSON.stringify({
        name: "cannoliAnthropicProxyServer",
        code: code.text,
        type: "http",
        privacy: "unlisted",
        readme:
          "This is a proxy server for Anthropic requests. It is used to bypass the proxy server requirement for Anthropic requests.",
      }),
    });

    if (typeof response.json === "string") {
      new Notice(`Error creating Val: ${response.json}`);
      return;
    }

    this.settings.anthropicBaseURL = response.json.links.endpoint;

    new Notice(
      `Proxy server created on Val Town. You can now make Anthropic requests.`,
    );
  };

  createCanvas = async (name: string, canvas: string) => {
    try {
      await this.app.vault.create(name, canvas);
    } catch (error) {
      new Notice(`Error creating canvas: ${error}`);
      console.error(error);
    }
  };

  async checkCannolisIdentical(remote: unknown, file: TFile) {
    const fileContent = await this.app.vault.read(file);

    return JSON.stringify(remote) === JSON.stringify(JSON.parse(fileContent));
  }

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
      const newContent = content.replace(`\n![[${audio.name}]]\n`, transcript);
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
        .join((Math.random().toString(36) + "00000000000000000").slice(2, 18))
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

  getSecrets = () => {
    const secrets = {
      ...(this.settings.openaiAPIKey
        ? { OPENAI_API_KEY: this.settings.openaiAPIKey }
        : {}),
      ...(this.settings.exaAPIKey
        ? { EXA_API_KEY: this.settings.exaAPIKey }
        : {}),
      ...(this.settings.valTownAPIKey
        ? { VALTOWN_API_KEY: this.settings.valTownAPIKey }
        : {}),
      ...this.settings.secrets.reduce(
        (acc, secret) => {
          acc[secret.name] = secret.value;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };

    return secrets;
  };

  getConfig = (forBake?: boolean) => {
    const chatFormatStringIsDefault =
      this.settings.chatFormatString === DEFAULT_SETTINGS.chatFormatString ||
      forBake;

    return {
      ...(this.settings.contentIsColorless
        ? { contentIsColorless: this.settings.contentIsColorless }
        : {}),
      ...(!chatFormatStringIsDefault
        ? { chatFormatString: this.settings.chatFormatString }
        : {}),
      ...(this.settings.enableVision !== undefined
        ? { enableVision: this.settings.enableVision }
        : {}),
      tracingConfig: forBake ? undefined : this.settings.tracingConfig,
    };
  };

  getActions = () => {
    return [
      ...(this.settings.openaiAPIKey ? [dalleGenerate] : []),
      ...(this.settings.exaAPIKey ? [exaSearch] : []),
      dataviewQuery,
      smartConnectionsQuery,
      modalMaker,
      valTownEvaluate,
      valTownSendEmail,
    ];
  };

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
            azureOpenAIApiDeploymentName:
              this.settings.azureOpenAIApiDeploymentName,
            azureOpenAIApiInstanceName:
              this.settings.azureOpenAIApiInstanceName,
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
            baseURL: this.settings.anthropicBaseURL,
          };
        case "groq":
          return {
            apiKey: this.settings.groqAPIKey,
            model: this.settings.groqModel,
            temperature: this.settings.groqTemperature,
          };
      }
    };

    const providers: SupportedProviders[] = [
      "openai",
      "azure_openai",
      "ollama",
      "gemini",
      "anthropic",
      "groq",
    ];
    const llmConfigs: LLMConfig[] = providers.map((provider) => ({
      ...getConfigByProvider(provider),
      provider,
    }));

    // Ensure the default provider is first
    const defaultProviderIndex = llmConfigs.findIndex(
      (config) => config.provider === this.settings.llmProvider,
    );
    const defaultProvider = llmConfigs[defaultProviderIndex];
    if (defaultProviderIndex !== 0) {
      llmConfigs.splice(defaultProviderIndex, 1);
      llmConfigs.unshift(defaultProvider);
    }

    return llmConfigs;
  };

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
        `Please enter your ${this.settings.llmProvider} API key in the Cannoli settings`,
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

    if (!canvasData) {
      new Notice(`Cannoli run canceled.`);
      return;
    }

    const note = this.app.workspace.getActiveFile()?.basename;
    const cannoliArgs = {
      obsidianCurrentNote: note ? `[[${note}]]` : "No active note",
      obsidianSelection: this.app.workspace.activeEditor?.editor?.getSelection()
        ? this.app.workspace.activeEditor?.editor?.getSelection()
        : "No selection",
    };

    const canvas = new CanvasPersistor(canvasData, file);

    const fetcher: ResponseTextFetcher = async (
      url: string,
      { body, method, headers }: RequestInit,
    ) => {
      const headersObj = Array.isArray(headers)
        ? Object.fromEntries(headers)
        : headers instanceof Headers
          ? {}
          : headers;
      const constrainedBody =
        typeof body === "string"
          ? body
          : body instanceof ArrayBuffer
            ? body
            : undefined;
      return requestUrl({
        body: constrainedBody || undefined,
        method,
        headers: headersObj,
        url,
      }).then((response) => {
        return response.text;
      });
    };

    const vaultInterface = new VaultInterface(this);

    const replacers: Replacer[] = [
      vaultInterface.replaceDataviewQueries,
      vaultInterface.replaceSmartConnections,
    ];

    const config = this.getConfig();

    const secrets = this.getSecrets();

    const actions = this.getActions();

    // Do the validation run
    const [validationStoppagePromise] = run({
      cannoli: canvasData,
      llmConfigs: llmConfigs,
      actions: actions,
      httpTemplates: this.settings.httpTemplates,
      replacers: replacers,
      config: config,
      secrets: secrets,
      fetcher: fetcher,
      args: cannoliArgs,
      persistor: noCanvas ? undefined : canvas,
      fileManager: vaultInterface,
      isMock: true,
      runName: name,
    });

    const validationStoppage = await validationStoppagePromise;

    if (validationStoppage.reason === "error") {
      new Notice(
        `Cannoli ${name} failed with the error:\n\n${validationStoppage.message}`,
      );
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
      shouldContinue = await this.showRunUsageAlertModal(
        validationStoppage.usage,
      );
    }

    if (!shouldContinue) {
      new Notice(`Cannoli ${name} was cancelled.`);
      return;
    }

    const cannoliServerSettings = this.settings.cannoliServerEnabled
      ? {
          url: this.settings.cannoliServerUrl,
          secret: this.settings.cannoliServerSecret,
        }
      : undefined;

    // Do the live run
    const [liveStoppagePromise, stopLiveCannoli] = run({
      cannoli: canvasData,
      llmConfigs: llmConfigs,
      actions: actions,
      httpTemplates: this.settings.httpTemplates,
      replacers: replacers,
      config: config,
      secrets: secrets,
      fetcher: fetcher,
      args: cannoliArgs,
      persistor: noCanvas ? undefined : canvas,
      fileManager: vaultInterface,
      isMock: false,
      runName: name,
      ...(cannoliServerSettings
        ? { cannoliServer: cannoliServerSettings }
        : {}),
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
        totalCompletionTokens +=
          liveStoppage.usage[model].completionTokens ?? 0;
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
      new Notice(
        `Cannoli ${name} failed with the error:\n\n${liveStoppage.message}${usageString}`,
      );
    } else if (liveStoppage.reason === "complete") {
      new Notice(`Cannoli complete: ${name}${usageString}`);
    } else {
      new Notice(`Cannoli stopped: ${name}${usageString}`);
    }
  };

  async fetchData(file: TFile): Promise<CanvasData | null> {
    const fileContent = await this.app.vault.cachedRead(file);
    const parsedContent = JSON.parse(fileContent) as CanvasData;

    const subCanvasGroupIds: string[] = [];

    for (const node of parsedContent.nodes) {
      if (
        node.type === "group" &&
        (node.label === "cannoli" || node.label === "Cannoli")
      ) {
        subCanvasGroupIds.push(node.id);
      }
    }

    if (this.settings.onlyRunCannoliGroups && subCanvasGroupIds.length === 0) {
      new Notice(
        "No cannoli groups found. You have the 'Only run Cannoli groups' setting enabled, but no cannoli groups are present in the canvas.",
      );
      return null;
    }

    if (subCanvasGroupIds.length > 0) {
      let allNodes: typeof parsedContent.nodes = [];
      let allEdges: typeof parsedContent.edges = [];

      for (const subCanvasGroupId of subCanvasGroupIds) {
        const subCanvasGroup = parsedContent.nodes.find(
          (node) => node.id === subCanvasGroupId,
        ) as CanvasGroupData;
        if (!subCanvasGroup) {
          throw new Error(`Group with id ${subCanvasGroupId} not found.`);
        }

        const { nodeIds, edgeIds } = this.getNodesAndEdgesInGroup(
          subCanvasGroup,
          parsedContent,
        );

        allNodes = allNodes.concat(
          parsedContent.nodes.filter((node) => nodeIds.includes(node.id)),
        );
        allEdges = allEdges.concat(
          parsedContent.edges.filter((edge) => edgeIds.includes(edge.id)),
        );
      }

      return {
        ...parsedContent,
        nodes: allNodes,
        edges: allEdges,
      };
    }

    return parsedContent;
  }

  openCanvas(canvasName: string): boolean {
    const file = this.app.metadataCache.getFirstLinkpathDest(canvasName, "");
    if (file) {
      this.app.workspace.openLinkText(file.path, "");
      return true;
    } else {
      new Notice(`Cannoli: "${canvasName.replace(/\.canvas/g, "")}" not found`);
      return false;
    }
  }

  getNodesAndEdgesInGroup(
    group: CanvasGroupData,
    canvasData: CanvasData,
  ): { nodeIds: string[]; edgeIds: string[] } {
    const groupRectangle = this.createRectangle(
      group.x,
      group.y,
      group.width,
      group.height,
    );

    const nodeIds: string[] = [];
    const edgeIds: string[] = [];

    for (const node of canvasData.nodes) {
      if (node.id === group.id) continue;
      if (node.color === "1") continue;

      const nodeRectangle = this.createRectangle(
        node.x,
        node.y,
        node.width,
        node.height,
      );

      if (this.encloses(groupRectangle, nodeRectangle)) {
        nodeIds.push(node.id);
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

  encloses(
    a: ReturnType<typeof this.createRectangle>,
    b: ReturnType<typeof this.createRectangle>,
  ): boolean {
    return (
      a.x <= b.x &&
      a.y <= b.y &&
      a.x_right >= b.x_right &&
      a.y_bottom >= b.y_bottom
    );
  }

  overlaps(
    a: ReturnType<typeof this.createRectangle>,
    b: ReturnType<typeof this.createRectangle>,
  ): boolean {
    const horizontalOverlap = a.x < b.x_right && a.x_right > b.x;
    const verticalOverlap = a.y < b.y_bottom && a.y_bottom > b.y;
    return horizontalOverlap && verticalOverlap;
  }

  showRunUsageAlertModal = (
    usage: Record<string, ModelUsage>,
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const onContinueCallback = () => resolve(true);
      const onCancelCallback = () => resolve(false);

      new RunPriceAlertModal(
        this.app,
        usage,
        this.settings.requestThreshold,
        onContinueCallback,
        onCancelCallback,
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
          content,
        );
      }
    }

    // Send a Notice that the folder has been created
    new Notice("Cannoli College folder added");
  };
}
