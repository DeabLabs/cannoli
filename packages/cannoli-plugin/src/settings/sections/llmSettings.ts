import { Setting } from "obsidian";
import Cannoli from "src/main";
import { DEFAULT_SETTINGS } from "../settings";
import { SupportedProviders } from "@deablabs/cannoli-core";
import { createAnthropicSettings } from "./llmSettings/anthropicSettings";
import { createAzureOpenAISettings } from "./llmSettings/azureOpenAISettings";
import { createGeminiSettings } from "./llmSettings/geminiSettings";
import { createGroqSettings } from "./llmSettings/groqSettings";
import { createOllamaSettings } from "./llmSettings/ollamaSettings";
import { createOpenAISettings } from "./llmSettings/openAISettings";

export function createLLMSettings(containerEl: HTMLElement, plugin: Cannoli, display: () => void): void {
    // Add dropdown for AI provider with options OpenAI and Ollama
    new Setting(containerEl)
        .setName("AI Provider")
        .setDesc(
            "Choose which provider settings to edit. This dropdown will also select your default provider, which can be overridden at the node level using config arrows."
        )
        .addDropdown((dropdown) => {
            dropdown.addOption("openai", "OpenAI");
            dropdown.addOption("azure_openai", "Azure OpenAI");
            dropdown.addOption("ollama", "Ollama");
            dropdown.addOption("gemini", "Gemini");
            dropdown.addOption("anthropic", "Anthropic");
            dropdown.addOption("groq", "Groq");
            dropdown.setValue(
                plugin.settings.llmProvider ??
                DEFAULT_SETTINGS.llmProvider
            );
            dropdown.onChange(async (value) => {
                plugin.settings.llmProvider = value as SupportedProviders;
                await plugin.saveSettings();
                display();
            });
        });

    containerEl.createEl("h1", { text: "LLM" });

    if (plugin.settings.llmProvider === "openai") {
        createOpenAISettings(containerEl, plugin);
    } else if (plugin.settings.llmProvider === "azure_openai") {
        createAzureOpenAISettings(containerEl, plugin);
    } else if (plugin.settings.llmProvider === "ollama") {
        createOllamaSettings(containerEl, plugin);
    } else if (plugin.settings.llmProvider === "gemini") {
        createGeminiSettings(containerEl, plugin);
    } else if (plugin.settings.llmProvider === "anthropic") {
        createAnthropicSettings(containerEl, plugin, display);
    } else if (plugin.settings.llmProvider === "groq") {
        createGroqSettings(containerEl, plugin);
    }

    new Setting(containerEl)
        .setName("LLM call concurrency limit (pLimit)")
        .setDesc(
            "The maximum number of LLM calls that can be made at once. Decrease this if you are running into rate limiting issues."
        )
        .addText((text) =>
            text
                .setValue(
                    Number.isInteger(plugin.settings.pLimit)
                        ? plugin.settings.pLimit.toString()
                        : DEFAULT_SETTINGS.pLimit.toString()
                )
                .onChange(async (value) => {
                    // If it's not empty and it's a positive integer, save it
                    if (!isNaN(parseInt(value)) && parseInt(value) > 0) {
                        plugin.settings.pLimit = parseInt(value);
                        await plugin.saveSettings();
                    } else {
                        // Otherwise, reset it to the default
                        plugin.settings.pLimit =
                            DEFAULT_SETTINGS.pLimit;
                        await plugin.saveSettings();
                    }
                })
        );
}