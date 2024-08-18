import { HttpTemplate } from "@deablabs/cannoli-core";
import { Setting } from "obsidian";
import Cannoli from "src/main";
import { HttpTemplateEditorModal } from "src/modals/httpTemplateEditor";

export function createActionSettings(containerEl: HTMLElement, plugin: Cannoli, display: () => void): void {
    containerEl.createEl("h1", { text: "Action nodes" });

    new Setting(containerEl)
        .setName("Action node templates")
        .setDesc("Manage default HTTP templates for action nodes.")
        .addButton((button) =>
            button.setButtonText("+ Template").onClick(async () => {
                // Create a new command object to pass to the modal
                const newCommand: HttpTemplate = {
                    name: "",
                    url: "",
                    headers: `{ "Content-Type": "application/json" }`,
                    id: "",
                    method: "GET",
                };

                // Open the modal to edit the new template
                new HttpTemplateEditorModal(
                    plugin.app,
                    newCommand,
                    async (command) => {
                        plugin.settings.httpTemplates.push(command);
                        await plugin.saveSettings();
                        // Refresh the settings pane to reflect the changes
                        display();
                    },
                    () => { }
                ).open();
            })
        );

    // Iterate through saved templates and display them
    for (const template of plugin.settings.httpTemplates) {
        new Setting(containerEl)
            .setName(template.name)
            .addButton((button) =>
                button.setButtonText("Edit").onClick(() => {
                    // Open the modal to edit the existing template
                    new HttpTemplateEditorModal(
                        plugin.app,
                        template,
                        async (updatedTemplate) => {
                            Object.assign(template, updatedTemplate);
                            await plugin.saveSettings();
                            // Refresh the settings pane to reflect the changes
                            display();
                        },
                        () => { }
                    ).open();
                })
            )
            .addButton((button) =>
                button.setButtonText("Delete").onClick(async () => {
                    const index =
                        plugin.settings.httpTemplates.indexOf(
                            template
                        );
                    if (index > -1) {
                        plugin.settings.httpTemplates.splice(index, 1);
                        await plugin.saveSettings();
                        // Refresh the settings pane to reflect the changes
                        display();
                    }
                })
            );
    }
}