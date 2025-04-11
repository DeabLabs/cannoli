import { Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import Cannoli from "src/main";

export function createCanvasSettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
): void {
  containerEl.createEl("h1", { text: "Canvas preferences" });

  // Add toggle for contentIsColorless
  new Setting(containerEl)
    .setName("Parse colorless nodes as content nodes")
    .setDesc(
      "Toggle this if you'd like colorless (grey) nodes to be interpreted as content nodes rather than call nodes. Purple nodes will then be interpreted as call nodes.",
    )
    .addToggle((toggle) =>
      toggle
        .setValue(
          plugin.settings.contentIsColorless ??
            DEFAULT_SETTINGS.contentIsColorless,
        )
        .onChange(async (value) => {
          plugin.settings.contentIsColorless = value;
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl)
    .setName("Only run canvases with a 'cannoli' group")
    .setDesc(
      "Toggle this if you'd like to only run canvases that have one or more 'cannoli' labeled groups. Use this if you want to ensure you never run a canvas as a cannoli unless you've explicitly defined the parts of the canvas you want to be interpreted as a cannoli.",
    )
    .addToggle((toggle) =>
      toggle
        .setValue(
          plugin.settings.onlyRunCannoliGroups ??
            DEFAULT_SETTINGS.onlyRunCannoliGroups,
        )
        .onChange(async (value) => {
          plugin.settings.onlyRunCannoliGroups = value;
          await plugin.saveSettings();
        }),
    );
}
