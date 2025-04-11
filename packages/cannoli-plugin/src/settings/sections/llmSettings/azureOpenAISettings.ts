import { Setting } from "obsidian";
import Cannoli from "src/main";
import { DEFAULT_SETTINGS } from "src/settings/settings";

export function createAzureOpenAISettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
): void {
  // azure openai api key setting
  new Setting(containerEl)
    .setName("Azure OpenAI API key")
    .setDesc(
      "This key will be used to make all Azure OpenAI LLM calls. Be aware that complex cannolis, can be expensive to run.",
    )
    .addText((text) =>
      text
        .setValue(plugin.settings.azureAPIKey)
        .setPlaceholder("sk-...")
        .onChange(async (value) => {
          plugin.settings.azureAPIKey = value;
          await plugin.saveSettings();
        })
        .inputEl.setAttribute("type", "password"),
    );
  // azure openai model setting
  new Setting(containerEl)
    .setName("Azure OpenAI model")
    .setDesc(
      "This model will be used for all LLM nodes unless overridden with a config arrow.",
    )
    .addText((text) =>
      text.setValue(plugin.settings.azureModel).onChange(async (value) => {
        plugin.settings.azureModel = value;
        await plugin.saveSettings();
      }),
    );
  // Default LLM temperature setting
  new Setting(containerEl)
    .setName("LLM temperature")
    .setDesc(
      "This temperature will be used for all LLM nodes unless overridden with a config arrow.",
    )
    .addText((text) =>
      text
        .setValue(
          !isNaN(plugin.settings.azureTemperature) &&
            plugin.settings.azureTemperature
            ? plugin.settings.azureTemperature.toString()
            : DEFAULT_SETTINGS.azureTemperature.toString(),
        )
        .onChange(async (value) => {
          // If it's not empty and it's a number, save it
          if (!isNaN(parseFloat(value))) {
            plugin.settings.azureTemperature = parseFloat(value);
            await plugin.saveSettings();
          } else {
            // Otherwise, reset it to the default
            plugin.settings.azureTemperature =
              DEFAULT_SETTINGS.azureTemperature;
            await plugin.saveSettings();
          }
        }),
    );
  // azure openai api deployment name setting
  new Setting(containerEl)
    .setName("Azure OpenAI API deployment name")
    .setDesc("This deployment will be used to make all Azure OpenAI LLM calls.")
    .addText((text) =>
      text
        .setValue(plugin.settings.azureOpenAIApiDeploymentName)
        .setPlaceholder("deployment-name")
        .onChange(async (value) => {
          plugin.settings.azureOpenAIApiDeploymentName = value;
          await plugin.saveSettings();
        }),
    );

  // azure openai api instance name setting
  new Setting(containerEl)
    .setName("Azure OpenAI API instance name")
    .setDesc("This instance will be used to make all Azure OpenAI LLM calls.")
    .addText((text) =>
      text
        .setValue(plugin.settings.azureOpenAIApiInstanceName)
        .setPlaceholder("instance-name")
        .onChange(async (value) => {
          plugin.settings.azureOpenAIApiInstanceName = value;
          await plugin.saveSettings();
        }),
    );

  // azure openai api version setting
  new Setting(containerEl)
    .setName("Azure OpenAI API version")
    .setDesc(
      "This version will be used to make all Azure OpenAI LLM calls. Be aware that complex cannolis, can be expensive to run.",
    )
    .addText((text) =>
      text
        .setValue(plugin.settings.azureOpenAIApiVersion)
        .setPlaceholder("xxxx-xx-xx")
        .onChange(async (value) => {
          plugin.settings.azureOpenAIApiVersion = value;
          await plugin.saveSettings();
        }),
    );

  // azure base url setting
  new Setting(containerEl)
    .setName("Azure base url")
    .setDesc(
      "This url will be used to make azure openai llm calls against a different endpoint. This is useful for switching to an azure enterprise endpoint, or, some other openai compatible service.",
    )
    .addText((text) =>
      text
        .setValue(plugin.settings.azureBaseURL)
        .setPlaceholder("https://api.openai.com/v1/")
        .onChange(async (value) => {
          plugin.settings.azureBaseURL = value;
          await plugin.saveSettings();
        }),
    );
}
