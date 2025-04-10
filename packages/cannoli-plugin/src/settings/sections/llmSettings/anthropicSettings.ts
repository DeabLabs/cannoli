import { Setting } from "obsidian";
import Cannoli from "src/main";
import { DEFAULT_SETTINGS } from "src/settings/settings";

export function createAnthropicSettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
  display: () => void,
): void {
  new Setting(containerEl)
    .setName("Anthropic base URL")
    .setDesc(
      "(Optional) This base URL will be used to make all Anthropic LLM calls. If you are using the former ValTown proxy workaround, please clear this field.",
    )
    .addText((text) =>
      text
        .setValue(plugin.settings.anthropicBaseURL)
        .setPlaceholder("https://api.anthropic.com/v1/")
        .onChange(async (value) => {
          plugin.settings.anthropicBaseURL = value;
          await plugin.saveSettings();
        }),
    );
  // anthropic api key setting
  new Setting(containerEl)
    .setName("Anthropic API key")
    .setDesc(
      "This key will be used to make all Anthropic LLM calls. Be aware that complex cannolis, can be expensive to run.",
    )
    .addText((text) =>
      text
        .setValue(plugin.settings.anthropicAPIKey)
        .setPlaceholder("sk-...")
        .onChange(async (value) => {
          plugin.settings.anthropicAPIKey = value;
          await plugin.saveSettings();
        })
        .inputEl.setAttribute("type", "password"),
    );
  // anthropic model setting
  new Setting(containerEl)
    .setName("Anthropic model")
    .setDesc(
      "This model will be used for all LLM nodes unless overridden with a config arrow.",
    )
    .addText((text) =>
      text
        .setValue(plugin.settings.anthropicModel)
        .setPlaceholder("claude-3-5-sonnet-20240620")
        .onChange(async (value) => {
          plugin.settings.anthropicModel = value;
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
          !isNaN(plugin.settings.anthropicTemperature) &&
            plugin.settings.anthropicTemperature
            ? plugin.settings.anthropicTemperature.toString()
            : DEFAULT_SETTINGS.anthropicTemperature.toString(),
        )
        .onChange(async (value) => {
          // If it's not empty and it's a number, save it
          if (!isNaN(parseFloat(value))) {
            plugin.settings.anthropicTemperature = parseFloat(value);
            await plugin.saveSettings();
          } else {
            // Otherwise, reset it to the default
            plugin.settings.anthropicTemperature =
              DEFAULT_SETTINGS.anthropicTemperature;
            await plugin.saveSettings();
          }
        }),
    );
}
