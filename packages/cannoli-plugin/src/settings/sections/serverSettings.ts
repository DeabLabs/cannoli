import { Setting } from "obsidian";
import Cannoli from "src/main";
import { makeCannoliServerClient } from "@deablabs/cannoli-core";
export async function createServerSettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
  display: () => void,
): Promise<void> {
  containerEl.createEl("h1", { text: "Cannoli Server" });
  containerEl.createEl("p", {
    text: `Cannoli Server is a standalone program that you can run alongside Cannoli in Obsidian.

It allows extended Cannoli functionality by offloading long-running tasks, like MCP servers, to a separate process.

You can run the latest version of Cannoli Server by running \`npx -y @deablabs/cannoli-server\`.
    `,
    attr: {
      style: "white-space: pre-wrap;",
    },
  });

  const serverClient = makeCannoliServerClient(
    plugin.settings.cannoliServerUrl,
  );

  const serverUrlSetting = new Setting(containerEl)
    .setName("Server URL")
    .setDesc("The URL of your Cannoli server.")
    .addText((text) => {
      text.setValue(plugin.settings.cannoliServerUrl);
    });

  serverUrlSetting.addButton((button) => {
    button.setButtonText("Save").onClick(async () => {
      plugin.settings.cannoliServerUrl =
        serverUrlSetting.controlEl.querySelector("input")!.value;
      await plugin.saveSettings();
      display();
    });
  });

  const status = await serverClient.status
    .$get()
    .then(async (res) => res.json())
    .catch(() => {
      return {
        status: "error",
      };
    });

  new Setting(containerEl)
    .setName("Status")
    .setDesc("Check the status of your Cannoli server.")
    .addButton((button) => {
      button.setButtonText("Check status").onClick(async () => {
        display();
      });
    });

  if ("version" in status) {
    const row = containerEl.createDiv({
      attr: {
        style:
          "display: flex; flex-direction: row-reverse; width: 100%; justify-content: space-between;",
      },
    });
    row.createEl("p", {
      text: `Connected!`,
      attr: {
        style: "color: var(--color-green)",
      },
    });
    row.createEl("p", {
      text: `Server version: ${status.version}`,
      attr: {
        style: "color: var(--color-purple)",
      },
    });
    new Setting(containerEl)
      .setName("Server Settings")
      .setDesc("The settings of your Cannoli server.")
      .addTextArea((text) => {
        text.setValue(JSON.stringify(status.settings, null, 2));
        text.setDisabled(true);
        text.inputEl.style.width = "100%";
        text.inputEl.rows = 10;
      });
  } else {
    containerEl.createEl("p", {
      text: `Cannot connect to server.`,
      attr: {
        style: "color: var(--color-red)",
      },
    });
  }
}
