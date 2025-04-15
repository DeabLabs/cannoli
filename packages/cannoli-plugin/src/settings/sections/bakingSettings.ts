import { BakeLanguage, BakeRuntime } from "@deablabs/cannoli-core";
import { Setting } from "obsidian";
import Cannoli from "src/main";

export function createBakingSettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
): void {
  containerEl.createEl("h1", { text: "Baking" });

  // Filepath for baked cannoli folder
  new Setting(containerEl)
    .setName("Baked cannoli folder")
    .setDesc(
      "The path to the folder where baked cannoli will be saved. There can be subfolders.",
    )
    .addText((text) =>
      text
        .setValue(plugin.settings.bakedCannoliFolder)
        .onChange(async (value) => {
          plugin.settings.bakedCannoliFolder = value;
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl).setName("Language").addDropdown((dropdown) => {
    dropdown.addOption("typescript", "Typescript");
    dropdown.addOption("javascript", "Javascript");
    dropdown.setValue(plugin.settings.bakeLanguage);
    dropdown.onChange(async (value) => {
      plugin.settings.bakeLanguage = value as BakeLanguage;
      await plugin.saveSettings();
    });
  });

  new Setting(containerEl).setName("Runtime").addDropdown((dropdown) => {
    dropdown.addOption("node", "Node");
    dropdown.addOption("deno", "Deno");
    dropdown.addOption("bun", "Bun");
    dropdown.setValue(plugin.settings.bakeRuntime);
    dropdown.onChange(async (value) => {
      plugin.settings.bakeRuntime = value as BakeRuntime;
      await plugin.saveSettings();
    });
  });

  new Setting(containerEl).setName("Indent").addDropdown((dropdown) => {
    dropdown.addOption("2", "2");
    dropdown.addOption("4", "4");
    dropdown.setValue(plugin.settings.bakeIndent);
    dropdown.onChange(async (value) => {
      plugin.settings.bakeIndent = value as "2" | "4";
      await plugin.saveSettings();
    });
  });
}
