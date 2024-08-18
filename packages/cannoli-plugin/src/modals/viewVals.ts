import { CannoliFunctionInfo } from "@deablabs/cannoli-core";
import { App, Modal, Notice } from "obsidian";

export class ValTownModal extends Modal {
    cannoliFunctions: Array<{ link: string; moduleUrl: string; httpEndpointUrl: string; cannoliFunctionInfo: CannoliFunctionInfo, identicalToLocal: boolean, localExists: boolean }>;
    openCanvas: (canvasName: string) => boolean;
    valtownApiKey: string;
    bakeToValTown: (canvasName: string) => Promise<void>;
    getCannoliFunctions: () => Promise<Array<{ link: string; moduleUrl: string; httpEndpointUrl: string; cannoliFunctionInfo: CannoliFunctionInfo, identicalToLocal: boolean, localExists: boolean }>>;
    createCanvas: (name: string, canvas: string) => void;

    constructor(app: App, cannoliFunctions: Array<{ link: string; moduleUrl: string; httpEndpointUrl: string; cannoliFunctionInfo: CannoliFunctionInfo, identicalToLocal: boolean, localExists: boolean }>, getCannoliFunctions: () => Promise<Array<{ link: string; moduleUrl: string; httpEndpointUrl: string; cannoliFunctionInfo: CannoliFunctionInfo, identicalToLocal: boolean, localExists: boolean }>>, openCanvas: (canvasName: string) => boolean, valtownApiKey: string, bakeToValTown: (canvasName: string) => Promise<void>, createCanvas: (name: string, canvas: string) => void) {
        super(app);
        this.cannoliFunctions = cannoliFunctions;
        this.openCanvas = openCanvas;
        this.valtownApiKey = valtownApiKey;
        this.bakeToValTown = bakeToValTown;
        this.getCannoliFunctions = getCannoliFunctions;
        this.createCanvas = createCanvas;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h1", { text: "Cannoli Vals" });

        // Add CSS styles for table borders
        const style = document.createElement('style');
        style.textContent = `
			.cannoli-table, .cannoli-table th, .cannoli-table td {
				border: 1px solid grey;
				border-collapse: collapse;
			}
			.cannoli-table th, .cannoli-table td {
				padding: 8px;
			}
			.synced {
				color: green;
			}
		`;
        document.head.appendChild(style);

        const table = contentEl.createEl("table", { cls: "cannoli-table" });
        const tbody = table.createEl("tbody");

        this.cannoliFunctions.forEach((func) => {
            const { canvasName } = func.cannoliFunctionInfo;
            const displayName = canvasName.replace(/\.canvas|\.cno/g, "");

            const row = tbody.createEl("tr");

            row.createEl("td", { text: displayName });

            const canvasCell = row.createEl("td");
            const openCanvasButton = canvasCell.createEl("button", { text: "Canvas" });
            openCanvasButton.addEventListener("click", () => {
                const found = this.openCanvas(canvasName);
                if (found) {
                    this.close();
                }
            });

            const valCell = row.createEl("td");
            const openValButton = valCell.createEl("button", { text: "Val" });
            openValButton.addEventListener("click", () => {
                window.open(func.link, "_blank");
            });

            const copyUrlCell = row.createEl("td");
            const copyButton = copyUrlCell.createEl("button", { text: "📋 URL" });
            copyButton.addEventListener("click", () => {
                navigator.clipboard.writeText(func.httpEndpointUrl).then(() => {
                    new Notice("HTTP Endpoint URL copied to clipboard");
                }).catch((err) => {
                    console.error("Failed to copy text: ", err);
                });
            });

            const copyCurlCell = row.createEl("td");
            const copyCurlButton = copyCurlCell.createEl("button", { text: "📋 cURL" });
            copyCurlButton.addEventListener("click", () => {
                const curlCommand = `curl -X POST ${func.httpEndpointUrl} \\
-H "Authorization: Bearer ${this.valtownApiKey}" \\
-H "Content-Type: application/json" \\
${Object.keys(func.cannoliFunctionInfo.params).length > 0 ? `-d '${JSON.stringify(Object.fromEntries(Object.keys(func.cannoliFunctionInfo.params).map(param => [param, "value"])), null, 2)}'` : ''}`;
                navigator.clipboard.writeText(curlCommand).then(() => {
                    new Notice("cURL command copied to clipboard");
                }).catch((err) => {
                    console.error("Failed to copy text: ", err);
                });
            });

            const syncStatusCell = row.createEl("td");

            if (!func.localExists) {
                const syncButton = syncStatusCell.createEl("button", { text: "Download" });
                syncButton.addEventListener("click", async () => {
                    this.createCanvas(func.cannoliFunctionInfo.canvasName, JSON.stringify(func.cannoliFunctionInfo.cannoli));
                    new Notice(`Copied ${func.cannoliFunctionInfo.canvasName} to vault`);
                    const newCannoliFunctions = await this.getCannoliFunctions();
                    const newModal = new ValTownModal(this.app, newCannoliFunctions, this.getCannoliFunctions, this.openCanvas, this.valtownApiKey, this.bakeToValTown, this.createCanvas);
                    this.close();
                    newModal.open();
                });
            } else if (func.identicalToLocal) {
                syncStatusCell.createEl("span", { text: "Synced", cls: "synced" });
            } else {
                const syncButton = syncStatusCell.createEl("button", { text: "Upload" });
                syncButton.addEventListener("click", async () => {
                    await this.bakeToValTown(canvasName);
                    const newCannoliFunctions = await this.getCannoliFunctions();
                    const newModal = new ValTownModal(this.app, newCannoliFunctions, this.getCannoliFunctions, this.openCanvas, this.valtownApiKey, this.bakeToValTown, this.createCanvas);
                    this.close();
                    newModal.open();
                });
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}