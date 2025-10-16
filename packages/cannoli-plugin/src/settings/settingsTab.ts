import { App, PluginSettingTab, Setting } from "obsidian";
import Cannoli from "src/main";
import { createLLMSettings } from "./sections/llmSettings";
import { createCanvasSettings } from "./sections/canvasSettings";
import { createNoteExtractionSettings } from "./sections/noteExtractionSettings";
import { createChatCannoliSettings } from "./sections/chatCannoliSettings";
import { createTranscriptionSettings } from "./sections/transcriptionSettings";
import { createSecretsSettings } from "./sections/secretsSettings";
import { createBakingSettings } from "./sections/bakingSettings";
import { createValTownSettings } from "./sections/valtownSettings";
import { createActionSettings } from "./sections/actionSettings";
import { createTracingSettings } from "src/settings/sections/tracingSettings";
import { createServerSettings } from "src/settings/sections/serverSettings";

export class CannoliSettingTab extends PluginSettingTab {
  plugin: Cannoli;

  constructor(app: App, plugin: Cannoli) {
    super(app, plugin);
    this.plugin = plugin;

    this.display = this.display.bind(this);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Add a header
    containerEl.createEl("h1", { text: "Cannoli Settings" });

    containerEl.appendChild(this.plugin.createVersion2_3UpdateParagraph());

    // Add button to add sample folder
    new Setting(containerEl)
      .setName("Add Cannoli College")
      .setDesc(
        "Add a folder of sample cannolis to your vault to walk you through the basics of Cannoli. (Delete and re-add this folder to get the latest version after an update.)",
      )
      .addButton((button) =>
        button.setButtonText("Add").onClick(() => {
          this.plugin.addSampleFolder();
        }),
      );

    createLLMSettings(containerEl, this.plugin, this.display);

    createTracingSettings(containerEl, this.plugin, this.display);

    createCanvasSettings(containerEl, this.plugin);

    createNoteExtractionSettings(containerEl, this.plugin);

    createChatCannoliSettings(containerEl, this.plugin);

    createTranscriptionSettings(containerEl, this.plugin, this.display);

    createSecretsSettings(containerEl, this.plugin, this.display);

    createBakingSettings(containerEl, this.plugin);

    createValTownSettings(containerEl, this.plugin);

    createActionSettings(containerEl, this.plugin, this.display);

    createServerSettings(containerEl, this.plugin, this.display);
  }
}
