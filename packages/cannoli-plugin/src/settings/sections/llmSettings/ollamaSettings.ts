import { Setting } from "obsidian";
import Cannoli from "src/main";
import { DEFAULT_SETTINGS } from "src/settings/settings";

export function createOllamaSettings(containerEl: HTMLElement, plugin: Cannoli): void {
    // ollama base url setting
    new Setting(containerEl)
        .setName("Ollama base url")
        .setDesc(
            "This url will be used to make all ollama LLM calls. Be aware that ollama models have different features and capabilities that may not be compatible with all features of cannoli."
        )
        .addText((text) =>
            text
                .setValue(plugin.settings.ollamaBaseUrl)
                .setPlaceholder("https://ollama.com")
                .onChange(async (value) => {
                    plugin.settings.ollamaBaseUrl = value;
                    await plugin.saveSettings();
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
                .setValue(plugin.settings.ollamaModel)
                .onChange(async (value) => {
                    plugin.settings.ollamaModel = value;
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
                    !isNaN(plugin.settings.ollamaTemperature) &&
                        plugin.settings.ollamaTemperature
                        ? plugin.settings.ollamaTemperature.toString()
                        : DEFAULT_SETTINGS.ollamaTemperature.toString()
                )
                .onChange(async (value) => {
                    // If it's not empty and it's a number, save it
                    if (!isNaN(parseFloat(value))) {
                        plugin.settings.ollamaTemperature =
                            parseFloat(value);
                        await plugin.saveSettings();
                    } else {
                        // Otherwise, reset it to the default
                        plugin.settings.ollamaTemperature =
                            DEFAULT_SETTINGS.ollamaTemperature;
                        await plugin.saveSettings();
                    }
                })
        );
}