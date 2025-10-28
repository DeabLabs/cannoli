import { Notice, Setting } from "obsidian";
import Cannoli from "src/main";
import {
  CannoliServerClient,
  makeCannoliServerClient,
  serverSchemas,
} from "@deablabs/cannoli-core";
export async function createServerSettings(
  containerEl: HTMLElement,
  plugin: Cannoli,
  display: () => void,
): Promise<void> {
  containerEl.createEl("h1", { text: "Cannoli Server" });
  containerEl.createEl("p", {
    text: `Cannoli Server is a standalone program that you can run alongside Cannoli in Obsidian.

It allows extended Cannoli functionality by offloading long-running tasks, like MCP servers, to a separate process.
`,
    attr: {
      style: "white-space: pre-wrap;",
    },
  });
  containerEl.createEl("a", {
    text: "See the docs here for more information.",
    attr: {
      href: "https://docs.cannoli.website/Reference/Node+types/Goal+nodes",
      target: "_blank",
    },
  });
  containerEl.createEl("p", {
    text: `
You can run the latest version of Cannoli Server by running the command below:`,
    attr: {
      style: "white-space: pre-wrap;",
    },
  });

  // Create a copy-on-click command box
  const commandBox = containerEl.createDiv({
    attr: {
      style: `
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 12px 0;
        padding: 12px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        font-family: var(--font-monospace);
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
      `,
    },
  });

  commandBox.createEl("span", {
    text: "npx -y @deablabs/cannoli-server@latest",
    attr: {
      style: `
        flex: 1;
        color: var(--text-normal);
        user-select: all;
      `,
    },
  });

  const copyButton = commandBox.createEl("button", {
    text: "Copy",
    attr: {
      style: `
        padding: 4px 8px;
        border: 1px solid var(--interactive-accent);
        border-radius: 4px;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s ease;
      `,
    },
  });

  // Add hover effects
  commandBox.addEventListener("mouseenter", () => {
    commandBox.style.background = "var(--background-modifier-hover)";
    commandBox.style.borderColor = "var(--interactive-accent)";
  });

  commandBox.addEventListener("mouseleave", () => {
    commandBox.style.background = "var(--background-secondary)";
    commandBox.style.borderColor = "var(--background-modifier-border)";
  });

  // Copy functionality
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(
        "npx -y @deablabs/cannoli-server@latest",
      );
      new Notice("Command copied to clipboard!");

      // Visual feedback
      const originalText = copyButton.textContent;
      copyButton.textContent = "Copied!";
      copyButton.style.background = "var(--color-green)";
      copyButton.style.borderColor = "var(--color-green)";

      setTimeout(() => {
        copyButton.textContent = originalText;
        copyButton.style.background = "var(--interactive-accent)";
        copyButton.style.borderColor = "var(--interactive-accent)";
      }, 2000);
    } catch (err) {
      new Notice("Failed to copy command to clipboard");
      console.error("Failed to copy to clipboard:", err);
    }
  };

  // Add click handlers
  commandBox.addEventListener("click", copyToClipboard);
  copyButton.addEventListener("click", (e) => {
    e.stopPropagation();
    copyToClipboard();
  });

  new Setting(containerEl)
    .setName("Server Enabled")
    .setDesc("Whether connection to a Cannoli server is enabled.")
    .addToggle((toggle) => {
      toggle.setValue(plugin.settings.cannoliServerEnabled);
      toggle.onChange(async (value) => {
        plugin.settings.cannoliServerEnabled = value;
        await plugin.saveSettings();
        display();
      });
    });

  new Setting(containerEl)
    .setName("Server Secret")
    .setDesc("The secret of your Cannoli server.")
    .addText((text) => {
      text.inputEl.setAttribute("type", "password");
      text.setValue(plugin.settings.cannoliServerSecret);
      text.onChange(async (value) => {
        plugin.settings.cannoliServerSecret = value;
        await plugin.saveSettings();
        display();
      });
    });

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

  if (plugin.settings.cannoliServerEnabled) {
    const serverClient = makeCannoliServerClient(
      plugin.settings.cannoliServerSecret,
      plugin.settings.cannoliServerUrl,
    );
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
      // Create a nicer settings display
      const settingsContainer = containerEl.createDiv({
        attr: {
          style:
            "margin-top: 20px; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 16px; background: var(--background-secondary);",
        },
      });

      settingsContainer.createEl("h3", { text: "Server Settings" });
      settingsContainer.createEl("p", {
        text: "Current configuration of your Cannoli server.",
        attr: {
          style: "color: var(--text-muted); margin-bottom: 16px;",
        },
      });

      // Server info section
      const serverInfoContainer = settingsContainer.createDiv({
        attr: {
          style: "margin-bottom: 16px;",
        },
      });

      // MCP Servers count
      const mcpServersRow = serverInfoContainer.createDiv({
        attr: {
          style:
            "display: flex; justify-content: space-between; align-items: center; padding: 8px 0;",
        },
      });
      mcpServersRow.createEl("span", {
        text: "MCP Servers:",
        attr: {
          style: "font-weight: 500; color: var(--text-normal);",
        },
      });
      const mcpCount = status.settings.mcpServers?.length || 0;
      mcpServersRow.createEl("span", {
        text: `${mcpCount} configured`,
        attr: {
          style: "color: var(--text-muted);",
        },
      });

      // Created/Updated timestamps
      const timestampsContainer = settingsContainer.createDiv({
        attr: {
          style:
            "margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--background-modifier-border);",
        },
      });

      const createdRow = timestampsContainer.createDiv({
        attr: {
          style:
            "display: flex; justify-content: space-between; align-items: center; padding: 4px 0;",
        },
      });
      createdRow.createEl("span", {
        text: "Created:",
        attr: {
          style: "font-size: 12px; color: var(--text-muted);",
        },
      });
      createdRow.createEl("span", {
        text: new Date(status.settings.createdAt).toLocaleString(),
        attr: {
          style:
            "font-size: 12px; color: var(--text-muted); font-family: var(--font-monospace);",
        },
      });

      const updatedRow = timestampsContainer.createDiv({
        attr: {
          style:
            "display: flex; justify-content: space-between; align-items: center; padding: 4px 0;",
        },
      });
      updatedRow.createEl("span", {
        text: "Updated:",
        attr: {
          style: "font-size: 12px; color: var(--text-muted);",
        },
      });
      updatedRow.createEl("span", {
        text: new Date(status.settings.updatedAt).toLocaleString(),
        attr: {
          style:
            "font-size: 12px; color: var(--text-muted); font-family: var(--font-monospace);",
        },
      });

      // Add the MCP Editor component
      createMCPEditor(containerEl, serverClient);
    } else {
      containerEl.createEl("p", {
        text: `Cannot connect to server.`,
        attr: {
          style: "color: var(--color-red)",
        },
      });
    }
  }
}

function createMCPEditor(
  containerEl: HTMLElement,
  serverClient: CannoliServerClient,
) {
  // Create a container for the MCP editor
  const mcpEditorContainer = containerEl.createDiv({
    attr: {
      style:
        "margin-top: 20px; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 16px;",
    },
  });

  mcpEditorContainer.createEl("h3", { text: "Edit MCP Servers" });
  mcpEditorContainer.createEl("p", {
    text: "Edit your MCP server configurations. Each row represents one server configuration.",
    attr: {
      style: "color: var(--text-muted); margin-bottom: 16px;",
    },
  });

  // Container for server rows
  const serversContainer = mcpEditorContainer.createDiv({
    attr: {
      style: "margin-bottom: 16px;",
    },
  });

  // Store server configurations
  let serverConfigs: Record<string, unknown> = {};

  // Function to create a server row
  const createServerRow = (serverName: string, serverConfig: unknown) => {
    const rowContainer = serversContainer.createDiv({
      attr: {
        style:
          "border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 12px; margin-bottom: 8px; background: var(--background-secondary);",
      },
    });

    // Server name input
    const nameContainer = rowContainer.createDiv({
      attr: {
        style:
          "display: flex; align-items: center; margin-bottom: 8px; gap: 8px;",
      },
    });

    nameContainer.createEl("label", {
      text: "Server Name:",
      attr: {
        style: "font-weight: 500; min-width: 100px;",
      },
    });

    const nameInput = nameContainer.createEl("input", {
      value: serverName,
      attr: {
        style:
          "flex: 1; padding: 4px 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal);",
        placeholder: "Enter server name",
      },
    }) as HTMLInputElement;

    // Delete button
    const deleteButton = nameContainer.createEl("button", {
      text: "Delete",
      attr: {
        style:
          "padding: 4px 8px; border: 1px solid var(--text-error); border-radius: 4px; background: var(--background-primary); color: var(--text-error); cursor: pointer; font-size: 12px;",
      },
    });

    // Store the current server name for updates
    let currentServerName = serverName;

    deleteButton.addEventListener("click", () => {
      rowContainer.remove();
      delete serverConfigs[currentServerName];
    });

    // Server configuration textarea
    const placeholder =
      '{\n  "id": "server-id",\n  "name": "Server Name",\n  "type": "stdio",\n  "enabled": true,\n  "command": "node",\n  "args": ["/path/to/server.js"]\n}';
    const configTextarea = rowContainer.createEl("textarea", {
      text: JSON.stringify(serverConfig, null, 2) || placeholder,
      placeholder,
      attr: {
        style:
          "width: 100%; min-height: 120px; font-family: var(--font-monospace); font-size: 12px; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal);",
      },
    }) as HTMLTextAreaElement;

    // Update server configs when inputs change
    const updateConfig = () => {
      const newName = nameInput.value.trim();

      // Handle name changes
      if (newName && newName !== currentServerName) {
        // Update the server configs object
        if (serverConfigs[currentServerName]) {
          serverConfigs[newName] = serverConfigs[currentServerName];
          delete serverConfigs[currentServerName];
        }
        currentServerName = newName;
      }

      // Update the configuration
      try {
        const parsedConfig = JSON.parse(configTextarea.value);
        serverConfigs[currentServerName] = parsedConfig;
      } catch (e) {
        // Invalid JSON, keep the text but don't update the config
      }
    };

    nameInput.addEventListener("input", updateConfig);
    configTextarea.addEventListener("input", updateConfig);
  };

  // Function to add a new server row
  const addNewServer = () => {
    const newServerName = `server-${Date.now()}`;
    const defaultConfig = {
      id: newServerName,
      name: newServerName,
      type: "stdio",
      enabled: true,
      command: "node",
      args: ["/path/to/server.js"],
    };
    serverConfigs[newServerName] = defaultConfig;
    createServerRow(newServerName, defaultConfig);
  };

  // Load current settings and create rows
  const loadCurrentSettings = async () => {
    try {
      const response = await serverClient.settings.raw.$get();
      if (response.ok) {
        const settings = await response.json();
        const mcpServers = settings.mcpServers || [];

        // Clear existing rows
        serversContainer.empty();
        serverConfigs = {};

        // Convert array to object format and create rows
        mcpServers.forEach((server: unknown) => {
          if (
            typeof server === "object" &&
            server !== null &&
            "name" in server
          ) {
            const serverName = server.name as string;
            serverConfigs[serverName] = server;
            createServerRow(serverName, server);
          }
        });
      }
    } catch (error) {
      console.error("Failed to load current settings:", error);
    }
  };

  // Create button container
  const buttonContainer = mcpEditorContainer.createDiv({
    attr: {
      style: "display: flex; gap: 8px; justify-content: space-between;",
    },
  });

  // Add MCP Server button
  const addButton = buttonContainer.createEl("button", {
    text: "Add MCP Server",
    attr: {
      style:
        "padding: 6px 12px; border: 1px solid var(--interactive-accent); border-radius: 4px; background: var(--interactive-accent); color: var(--text-on-accent); cursor: pointer;",
    },
  });

  addButton.addEventListener("click", addNewServer);

  // Right side buttons
  const rightButtons = buttonContainer.createDiv({
    attr: {
      style: "display: flex; gap: 8px;",
    },
  });

  // Refresh button
  const resetButton = rightButtons.createEl("button", {
    text: "Refresh",
    attr: {
      style:
        "padding: 6px 12px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal); cursor: pointer;",
    },
  });

  resetButton.addEventListener("click", loadCurrentSettings);

  // Save button
  const saveButton = rightButtons.createEl("button", {
    text: "Save",
    attr: {
      style:
        "padding: 6px 12px; border: 1px solid var(--interactive-accent); border-radius: 4px; background: var(--interactive-accent); color: var(--text-on-accent); cursor: pointer;",
    },
  });

  saveButton.addEventListener("click", async () => {
    await saveMCPSettings(serverClient, serverConfigs);
  });

  // Load initial settings
  loadCurrentSettings();
}

async function saveMCPSettings(
  serverClient: CannoliServerClient,
  serverConfigs: Record<string, unknown>,
) {
  try {
    // Convert object to array format
    const mcpServers = Object.values(serverConfigs);

    // Validate each server configuration
    for (const server of mcpServers) {
      try {
        serverSchemas.McpServerSchema.parse(server);
      } catch (validationError) {
        new Notice(`Invalid server configuration: ${validationError}`);
        return;
      }
    }

    // Update settings via API
    const response = await serverClient.settings.$patch({
      json: {
        mcpServers: mcpServers as Parameters<
          typeof serverClient.settings.$patch
        >[0]["json"]["mcpServers"],
      },
    });

    if (response.ok) {
      new Notice("MCP server settings saved successfully!");
    } else {
      const errorData = (await response.json()) as { message?: string };
      new Notice(
        `Failed to save settings: ${errorData.message || "Unknown error"}`,
      );
    }
  } catch (error) {
    console.error("Failed to save MCP settings:", error);
    if (error instanceof SyntaxError) {
      new Notice("Invalid JSON format. Please check your syntax.");
    } else {
      new Notice(`Failed to save settings: ${error}`);
    }
  }
}
