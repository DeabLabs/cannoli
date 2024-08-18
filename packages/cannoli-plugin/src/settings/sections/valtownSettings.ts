import { Notice, Setting } from "obsidian";
import Cannoli from "src/main";
import { ValTownModal } from "src/modals/viewVals";

export function createValTownSettings(containerEl: HTMLElement, plugin: Cannoli): void {
    // ValTown section
    containerEl.createEl("h1", { text: "ValTown" });

    new Setting(containerEl)
        .setName("ValTown API key")
        .setDesc(
            `This key will be used to create Vals on your Val Town account when you run the "Create Val" command.`
        )
        .addText((text) =>
            text
                .setValue(plugin.settings.valTownAPIKey)
                .setPlaceholder("...")
                .onChange(async (value) => {
                    plugin.settings.valTownAPIKey = value;
                    await plugin.saveSettings();
                }).inputEl.setAttribute("type", "password")
        );

    new Setting(containerEl)
        .setName("View vals")
        .setDesc(`View information about your Cannoli Vals. This modal can also be opened using the "View vals" command.`)
        .addButton((button) =>
            button.setButtonText("Open").onClick(async () => {
                // new Notice("Fetching all your Cannolis...");
                try {
                    const modal = new ValTownModal(plugin.app, await plugin.getAllCannoliFunctions(), plugin.getAllCannoliFunctions, plugin.openCanvas, plugin.settings.valTownAPIKey, plugin.bakeToValTown, plugin.createCanvas);
                    modal.open();
                } catch (error) {
                    new Notice("Failed to fetch Cannoli functions.");
                    console.error(error);
                }
            })
        );
}