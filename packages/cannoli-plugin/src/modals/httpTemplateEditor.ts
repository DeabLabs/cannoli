import { HttpTemplate } from "@deablabs/cannoli-core";
import { App, Modal, Setting } from "obsidian";

export class HttpTemplateEditorModal extends Modal {
  template: HttpTemplate;
  onSave: (template: HttpTemplate) => void;
  onCancel: () => void;

  constructor(
    app: App,
    template: HttpTemplate,
    onSave: (template: HttpTemplate) => void,
    onCancel: () => void,
  ) {
    super(app);
    this.template = template;
    this.onSave = onSave;
    this.onCancel = onCancel;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.addClass("http-template-editor");
    contentEl.createEl("h1", { text: "Edit action node template" });

    // Add some space between the header and the description
    contentEl.createEl("div", { cls: "spacer" });

    // Insert a spacer element
    contentEl.createEl("div", {
      cls: "spacer",
      attr: { style: "height: 20px;" },
    });

    const createDescription = (text: string) => {
      const p = contentEl.createEl("p", {
        cls: "http-template-description",
      });
      // Allow newlines in the description
      p.innerHTML = text.replace(/\n/g, "<br>");
      return p;
    };

    // Brief description of what this modal does
    createDescription(
      `This modal allows you to edit the template for an action node. You can use this template to predefine the structure of http requests.\n\nUse {{variableName}} syntax to insert variables anywhere in the request. If there's only one variable, it will be replaced with whatever is written to the action node. If there are multiple variables, the action node will look for the variables in the available named arrows.`,
    );

    const createInputGroup = (
      labelText: string,
      inputElement: HTMLElement,
      id: string,
    ) => {
      const div = contentEl.createEl("div", {
        cls: "http-template-group",
      });
      const label = div.createEl("label", { text: labelText });
      label.htmlFor = id;
      inputElement.setAttribute("id", id);
      div.appendChild(inputElement);
    };

    const nameInput = contentEl.createEl("input", {
      type: "text",
      value: this.template.name || "",
    }) as HTMLInputElement;
    nameInput.setAttribute("id", "name-input");
    createInputGroup("Name:", nameInput, "name-input");

    const urlInput = contentEl.createEl("input", {
      type: "text",
      value: this.template.url || "",
    }) as HTMLInputElement;
    urlInput.setAttribute("id", "url-input");
    urlInput.setAttribute("placeholder", "https://example.com/{{path}}");
    createInputGroup("URL:", urlInput, "url-input");

    // Create a select element for HTTP methods
    const methodSelect = contentEl.createEl("select") as HTMLSelectElement;
    const methods = ["GET", "POST", "PUT", "DELETE"];
    methods.forEach((method) => {
      const option = methodSelect.createEl("option", {
        text: method,
        value: method,
      });
      // If the current template's method matches, select this option
      if (this.template.method === method) {
        option.selected = true;
      }
    });
    createInputGroup("Method:", methodSelect, "method-select");

    const headersValue =
      this.template.headers && this.template.headers.length > 0
        ? this.template.headers
        : `{ "Content-Type": "application/json" }`;

    const headersInput = contentEl.createEl("textarea") as HTMLTextAreaElement;

    headersInput.value = headersValue;
    headersInput.setAttribute("rows", "3");
    headersInput.setAttribute(
      "placeholder",
      `{ "Content-Type": "application/json" }`,
    );

    createInputGroup("Headers: (optional)", headersInput, "headers-input");

    // Body template input
    const bodyInput = contentEl.createEl("textarea", {
      placeholder: "Enter body. Use {{variableName}} for variables.",
    }) as HTMLTextAreaElement;

    const bodyValue = this.template.body ?? this.template.bodyTemplate ?? "";

    const formattedBody = this.formatBody(bodyValue);
    bodyInput.value = formattedBody;
    bodyInput.setAttribute("rows", "3");
    bodyInput.setAttribute(
      "placeholder",
      "Enter body template. Use {{variableName}} for variables.",
    );
    createInputGroup("Body: (optional)", bodyInput, "body-input");

    const panel = new Setting(contentEl);

    panel.addButton((btn) =>
      btn.setButtonText("Cancel").onClick(() => {
        this.close();
        this.onCancel();
      }),
    );

    panel.addButton((btn) =>
      btn
        .setButtonText("Save")
        .setCta()
        .onClick(() => {
          if (!urlInput.value) {
            alert("URL is required");
            return;
          }

          try {
            JSON.parse(headersInput.value || "{}");
          } catch (error) {
            alert(
              "Invalid JSON format for headers. Please correct and try again.",
            );
            return;
          }

          // Updating template object
          this.template.name = nameInput.value;
          this.template.url = urlInput.value;
          this.template.headers = headersInput.value;
          this.template.method = methodSelect.value;
          this.template.body = bodyInput.value;

          // Delete deprecated bodyTemplate
          delete this.template.bodyTemplate;

          this.close();
          this.onSave(this.template);
        }),
    );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  formatBody(body: string): string {
    try {
      // Try to parse the body as JSON
      const parsedBody = JSON.parse(body);

      // If successful, stringify it with proper formatting
      return JSON.stringify(parsedBody, null, 2);
    } catch (error) {
      // If parsing failed, return the body as-is
      return body;
    }
  }
}
