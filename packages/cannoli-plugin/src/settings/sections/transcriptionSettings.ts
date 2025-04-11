import { Setting } from "obsidian";
import Cannoli from "src/main";

export function createTranscriptionSettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
  display: () => void,
): void {
  containerEl.createEl("h1", { text: "Transcription" });

  // Toggle voice recording triggered cannolis
  new Setting(containerEl)
    .setName("Enable audio recorder triggered cannolis")
    .setDesc(
      `Enable cannolis to be triggered by audio recordings. When you make a recording in a note with a cannoli property: (1) The audio file will be transcribed using Whisper. (2) The file reference will be replaced with the transcript. (3) The cannoli defined in the property will run.`,
    )
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.enableAudioTriggeredCannolis || false)
        .onChange(async (value) => {
          plugin.settings.enableAudioTriggeredCannolis = value;
          await plugin.saveSettings();
          display();
        }),
    );

  if (plugin.settings.enableAudioTriggeredCannolis) {
    // Transcription prompt
    new Setting(containerEl)
      .addTextArea((text) =>
        text
          .setPlaceholder("Enter prompt to improve transcription accuracy")
          .setValue(plugin.settings.transcriptionPrompt || "")
          .onChange(async (value) => {
            plugin.settings.transcriptionPrompt = value;
            await plugin.saveSettings();
          }),
      )
      .setName("Transcription prompt")
      .setDesc(
        "Use this prompt to guide the style and vocabulary of the transcription. (i.e. the level of punctuation, format and spelling of uncommon words in the prompt will be mimicked in the transcription)",
      );

    // Toggle deleting audio files after starting an audio triggered cannoli
    new Setting(containerEl)
      .setName("Delete audio files after transcription")
      .setDesc("After a recording is transcribed, delete the audio file.")
      .addToggle((toggle) =>
        toggle
          .setValue(
            plugin.settings.deleteAudioFilesAfterAudioTriggeredCannolis ||
              false,
          )
          .onChange(async (value) => {
            plugin.settings.deleteAudioFilesAfterAudioTriggeredCannolis = value;
            await plugin.saveSettings();
          }),
      );
  }
}
