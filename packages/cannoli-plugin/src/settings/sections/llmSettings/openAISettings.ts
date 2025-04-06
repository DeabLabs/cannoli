import { Setting } from "obsidian";
import Cannoli from "src/main";
import { DEFAULT_SETTINGS } from "src/settings/settings";

export function createOpenAISettings(
	containerEl: HTMLElement,
	plugin: Cannoli,
): void {
	new Setting(containerEl)
		.setName("OpenAI API key")
		.setDesc(
			"This key will be used to make all openai LLM calls. Be aware that complex cannolis, especially those with many GPT-4 calls, can be expensive to run.",
		)
		.addText((text) =>
			text
				.setValue(plugin.settings.openaiAPIKey)
				.setPlaceholder("sk-...")
				.onChange(async (value) => {
					plugin.settings.openaiAPIKey = value;
					await plugin.saveSettings();
				})
				.inputEl.setAttribute("type", "password"),
		);

	// Request threshold setting. This is the number of AI requests at which the user will be alerted before running a Cannoli
	new Setting(containerEl)
		.setName("AI requests threshold")
		.setDesc(
			"If the cannoli you are about to run is estimated to make more than this amount of AI requests, you will be alerted before running it.",
		)
		.addText((text) =>
			text
				.setValue(
					Number.isInteger(plugin.settings.requestThreshold)
						? plugin.settings.requestThreshold.toString()
						: DEFAULT_SETTINGS.requestThreshold.toString(),
				)
				.onChange(async (value) => {
					// If it's not empty and it's an integer, save it
					if (
						!isNaN(parseInt(value)) &&
						Number.isInteger(parseInt(value))
					) {
						plugin.settings.requestThreshold = parseInt(value);
						await plugin.saveSettings();
					} else {
						// Otherwise, reset it to the default
						plugin.settings.requestThreshold =
							DEFAULT_SETTINGS.requestThreshold;
						await plugin.saveSettings();
					}
				}),
		);

	// Default LLM model setting
	new Setting(containerEl)
		.setName("Default LLM model")
		.setDesc(
			"This model will be used for all LLM nodes unless overridden with a config arrow. (Note that special arrow types rely on function calling, which is not available in all models.)",
		)
		.addText((text) =>
			text
				.setValue(plugin.settings.defaultModel)
				.onChange(async (value) => {
					plugin.settings.defaultModel = value;
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
					!isNaN(plugin.settings.defaultTemperature) &&
						plugin.settings.defaultTemperature
						? plugin.settings.defaultTemperature.toString()
						: DEFAULT_SETTINGS.defaultTemperature.toString(),
				)
				.onChange(async (value) => {
					// If it's not empty and it's a number, save it
					if (!isNaN(parseFloat(value))) {
						plugin.settings.defaultTemperature = parseFloat(value);
						await plugin.saveSettings();
					} else {
						// Otherwise, reset it to the default
						plugin.settings.defaultTemperature =
							DEFAULT_SETTINGS.defaultTemperature;
						await plugin.saveSettings();
					}
				}),
		);
	// openai base url setting
	new Setting(containerEl)
		.setName("Openai base url")
		.setDesc(
			"This url will be used to make openai llm calls against a different endpoint. This is useful for switching to an azure enterprise endpoint, or, some other openai compatible service.",
		)
		.addText((text) =>
			text
				.setValue(plugin.settings.openaiBaseURL)
				.setPlaceholder("https://api.openai.com/v1/")
				.onChange(async (value) => {
					plugin.settings.openaiBaseURL = value;
					await plugin.saveSettings();
				}),
		);
}
