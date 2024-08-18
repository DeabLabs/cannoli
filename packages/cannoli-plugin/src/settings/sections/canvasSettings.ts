import { Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import Cannoli from "src/main";

export function createCanvasSettings(containerEl: HTMLElement, plugin: Cannoli): void {
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
                    plugin.settings.contentIsColorless ??
                    DEFAULT_SETTINGS.contentIsColorless
                )
                .onChange(async (value) => {
                    plugin.settings.contentIsColorless = value;
                    await plugin.saveSettings();
                })
        );
}