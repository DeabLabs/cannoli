import { Setting } from "obsidian";
import Cannoli from "src/main";
import { DEFAULT_SETTINGS } from "src/settings/settings";

export function createGeminiSettings(containerEl: HTMLElement, plugin: Cannoli): void {
    // gemini api key setting
    new Setting(containerEl)
        .setName("Gemini API key")
        .setDesc(
            "This key will be used to make all Gemini LLM calls. Be aware that complex cannolis, can be expensive to run."
        )
        .addText((text) =>
            text
                .setValue(plugin.settings.geminiAPIKey)
                .setPlaceholder("sk-...")
                .onChange(async (value) => {
                    plugin.settings.geminiAPIKey = value;
                    await plugin.saveSettings();
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
                .setValue(plugin.settings.geminiModel)
                .onChange(async (value) => {
                    plugin.settings.geminiModel = value;
                    await plugin.saveSettings();
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
                    !isNaN(plugin.settings.geminiTemperature) &&
                        plugin.settings.geminiTemperature
                        ? plugin.settings.geminiTemperature.toString()
                        : DEFAULT_SETTINGS.geminiTemperature.toString()
                )
                .onChange(async (value) => {
                    // If it's not empty and it's a number, save it
                    if (!isNaN(parseFloat(value))) {
                        plugin.settings.geminiTemperature =
                            parseFloat(value);
                        await plugin.saveSettings();
                    } else {
                        // Otherwise, reset it to the default
                        plugin.settings.geminiTemperature =
                            DEFAULT_SETTINGS.geminiTemperature;
                        await plugin.saveSettings();
                    }
                })
        );
}