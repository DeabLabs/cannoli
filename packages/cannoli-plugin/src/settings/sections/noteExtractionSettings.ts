import { Setting } from "obsidian";
import Cannoli from "src/main";

export function createNoteExtractionSettings(
	containerEl: HTMLElement,
	plugin: Cannoli,
): void {
	// Put header here
	containerEl.createEl("h1", { text: "Note extraction" });

	// Toggle adding filenames as headers when extracting text from files
	new Setting(containerEl)
		.setName("Include filenames as headers in extracted notes by default")
		.setDesc(
			`When extracting a note in a cannoli, include the filename as a top-level header. This default can be overridden by adding "#" or "!#" after the note link in a reference like this: {{[[Stuff]]#}} or {{[[Stuff]]!#}}.`,
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.includeFilenameAsHeader || false)
				.onChange(async (value) => {
					plugin.settings.includeFilenameAsHeader = value;
					await plugin.saveSettings();
				}),
		);

	// Toggle including properties (YAML frontmatter) when extracting text from files
	new Setting(containerEl)
		.setName(
			"Include properties when extracting or editing notes by default",
		)
		.setDesc(
			`When extracting or editing a note in a cannoli, include the note's properties (YAML frontmatter). This default can be overridden by adding "^" or "!^" after the note link in a reference like this: {{[[Stuff]]^}} or {{[[Stuff]]!^}}.`,
		)
		.addToggle((toggle) =>
			toggle
				.setValue(
					plugin.settings.includePropertiesInExtractedNotes || false,
				)
				.onChange(async (value) => {
					plugin.settings.includePropertiesInExtractedNotes = value;
					await plugin.saveSettings();
				}),
		);

	// Toggle including markdown links when extracting text from files
	new Setting(containerEl)
		.setName(
			"Include markdown links when extracting or editing notes by default",
		)
		.setDesc(
			`When extracting or editing a note in a cannoli, include the note's markdown link above the content. This default can be overridden by adding "@" or "!@" after the note link in a reference like this: {{[[Stuff]]@}} or {{[[Stuff]]!@}}.`,
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.includeLinkInExtractedNotes || false)
				.onChange(async (value) => {
					plugin.settings.includeLinkInExtractedNotes = value;
					await plugin.saveSettings();
				}),
		);
}
