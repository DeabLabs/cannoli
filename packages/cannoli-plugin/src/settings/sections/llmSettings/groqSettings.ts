import { Setting } from "obsidian";
import Cannoli from "src/main";
import { DEFAULT_SETTINGS } from "src/settings/settings";

export function createGroqSettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
): void {
  // groq api key setting
  new Setting(containerEl)
    .setName("Groq API key")
    .setDesc(
      "This key will be used to make all Groq LLM calls. Be aware that complex cannolis, can be expensive to run.",
    )
    .addText((text) =>
      text
        .setValue(plugin.settings.groqAPIKey)
        .setPlaceholder("sk-...")
        .onChange(async (value) => {
          plugin.settings.groqAPIKey = value;
          await plugin.saveSettings();
        })
        .inputEl.setAttribute("type", "password"),
    );
  // groq model setting
  new Setting(containerEl)
    .setName("Groq model")
    .setDesc(
      "This model will be used for all LLM nodes unless overridden with a config arrow.",
    )
    .addText((text) =>
      text.setValue(plugin.settings.groqModel).onChange(async (value) => {
        plugin.settings.groqModel = value;
        await plugin.saveSettings();
      }),
    );
  // Default LLM temperature setting
  new Setting(containerEl)
    .setName("Default LLM temperature")
    .setDesc(
      "This temperature will be used for all LLM nodes unless overridden with a config arrow.",
    )
    .addText((text) =>
      text
        .setValue(
          !isNaN(plugin.settings.groqTemperature) &&
            plugin.settings.groqTemperature
            ? plugin.settings.groqTemperature.toString()
            : DEFAULT_SETTINGS.groqTemperature.toString(),
        )
        .onChange(async (value) => {
          // If it's not empty and it's a number, save it
          if (!isNaN(parseFloat(value))) {
            plugin.settings.groqTemperature = parseFloat(value);
            await plugin.saveSettings();
          } else {
            // Otherwise, reset it to the default
            plugin.settings.groqTemperature = DEFAULT_SETTINGS.groqTemperature;
            await plugin.saveSettings();
          }
        }),
    );
}
