import { Setting } from "obsidian";
import Cannoli from "src/main";

export function createChatCannoliSettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
): void {
  containerEl.createEl("h1", { text: "Chat cannolis" });

  // Chat format string setting, error if invalid
  new Setting(containerEl)
    .setName("Chat format string")
    .setDesc(
      "This string will be used to format chat messages when using chat arrows. This string must contain the placeholders {{role}} and {{content}}, which will be replaced with the role and content of the message, respectively.",
    )
    .addTextArea((text) =>
      text
        .setValue(plugin.settings.chatFormatString)
        .onChange(async (value) => {
          // Check if the format string is valid
          const rolePlaceholder = "{{role}}";
          const contentPlaceholder = "{{content}}";
          if (
            !value.includes(rolePlaceholder) ||
            !value.includes(contentPlaceholder)
          ) {
            alert(
              `Invalid format string. Please include both ${rolePlaceholder} and ${contentPlaceholder}.`,
            );
            return;
          }

          plugin.settings.chatFormatString = value;
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl)
    .setName("Auto-scroll with token stream")
    .setDesc(
      "Move the cursor forward every time a token is streamed in from a chat arrow. This will lock the scroll position to the bottom of the note.",
    )
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.autoScrollWithTokenStream || false)
        .onChange(async (value) => {
          plugin.settings.autoScrollWithTokenStream = value;
          await plugin.saveSettings();
        }),
    );
}
