import { Setting } from "obsidian";
import Cannoli from "src/main";
import { TracingConfig } from "@deablabs/cannoli-core";
import { DEFAULT_SETTINGS } from "src/settings/settings";

const defaultPhoenixTracingConfig: NonNullable<TracingConfig["phoenix"]> = DEFAULT_SETTINGS.tracingConfig.phoenix!

export function createTracingSettings(containerEl: HTMLElement, plugin: Cannoli, display: () => void): void {
	// heading
	containerEl.createEl("h1", { text: "Tracing" });

	new Setting(containerEl)
		.setName("Phoenix Tracing")
		.setDesc("Enable Phoenix tracing for your Cannoli runs. Phoenix is a data tracing system that allows you to observe the history of your runs, and optimize your prompts over time.")
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.tracingConfig.phoenix?.enabled ?? false);
			toggle.onChange(async (value) => {
				if (plugin.settings.tracingConfig.phoenix) {
					plugin.settings.tracingConfig.phoenix.enabled = value;
				} else {
					plugin.settings.tracingConfig.phoenix = {
						...defaultPhoenixTracingConfig,
						enabled: value,
					}
				}
				await plugin.saveSettings();
				display();
			});
		});

	new Setting(containerEl)
		.setName("Phoenix Project Name")
		.setDesc("The name of the project to use for your Phoenix tracing. This is used to identify the project in the Phoenix console.")
		.addText((text) => {
			text.setValue(plugin.settings.tracingConfig.phoenix?.projectName ?? defaultPhoenixTracingConfig.projectName);
			text.onChange(async (value) => {
				if (plugin.settings.tracingConfig.phoenix) {
					plugin.settings.tracingConfig.phoenix.projectName = value;
				} else {
					plugin.settings.tracingConfig.phoenix = {
						...defaultPhoenixTracingConfig,
						projectName: value,
					}
				}
				await plugin.saveSettings();
			});
		});

	new Setting(containerEl)
		.setName("Phoenix Base URL")
		.setDesc("The base URL for your Phoenix tracing. This is used to send your tracing data to the Phoenix server.")
		.addText((text) => {
			text.setValue(plugin.settings.tracingConfig.phoenix?.baseUrl ?? defaultPhoenixTracingConfig.baseUrl);
			text.onChange(async (value) => {
				if (plugin.settings.tracingConfig.phoenix) {
					plugin.settings.tracingConfig.phoenix.baseUrl = value;
				} else {
					plugin.settings.tracingConfig.phoenix = {
						...defaultPhoenixTracingConfig,
						baseUrl: value,
					}
				}
				await plugin.saveSettings();
			});
		});

	new Setting(containerEl)
		.setName("Phoenix API Key")
		.setDesc("The API key to use for your Phoenix tracing. This is used to authenticate your tracing data to the Phoenix server.")
		.addText((text) => {
			text.setValue(plugin.settings.tracingConfig.phoenix?.apiKey ?? defaultPhoenixTracingConfig.apiKey ?? "");
			text.onChange(async (value) => {
				if (plugin.settings.tracingConfig.phoenix) {
					plugin.settings.tracingConfig.phoenix.apiKey = value;
				} else {
					plugin.settings.tracingConfig.phoenix = {
						...defaultPhoenixTracingConfig,
						apiKey: value,
					}
				}
				await plugin.saveSettings();
			});
		});
}
