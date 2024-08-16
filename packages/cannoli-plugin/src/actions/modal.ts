import { App, Modal } from "obsidian";
import { Action } from "@deablabs/cannoli-core";

export const modalMaker: Action = {
    name: "modal",
    function: async ({
        format,
        title = "Cannoli Modal"
    }: {
        format: string;
        title?: string;
    }): Promise<string | Error> => {
        return new Promise((resolve) => {
            try {
                new CustomModal(app, format, (result) => {
                    if (result instanceof Error) {
                        resolve(result);
                    } else {
                        resolve(JSON.stringify(result, null, 2));
                    }
                }, title).open();
            } catch (error) {
                resolve(error instanceof Error ? error : new Error(String(error)));
            }
        });
    },
    argInfo: {
        format: {
            category: "arg",
            type: "string",
            description: "The format of the modal",
        }
    }
}

interface ModalComponent {
    type: 'text' | 'input';
    content: string;
    name: string;
    fieldType: string;
    options?: string[];
}

interface ModalParagraph {
    components: ModalComponent[];
}

class CustomModal extends Modal {
    format: string;
    callback: (result: Record<string, string> | Error) => void;
    title: string;
    paragraphs: ModalParagraph[];
    isSubmitted: boolean;

    constructor(app: App, format: string, callback: (result: Record<string, string> | Error) => void, title: string) {
        super(app);
        this.format = format;
        this.callback = callback;
        this.title = title;
        this.paragraphs = this.parseFormat();
        this.isSubmitted = false;
    }

    parseFormat(): ModalParagraph[] {
        const regex = /\[([^\]]+)\]|([^[]+)/g;
        const paragraphs: ModalParagraph[] = [{ components: [] }];
        let match;

        while ((match = regex.exec(this.format)) !== null) {
            if (match[1]) { // Input component
                const [fieldName, fieldType, options] = this.parseField(match[1]);
                paragraphs[paragraphs.length - 1].components.push({
                    type: 'input',
                    content: fieldName,
                    name: fieldName,
                    fieldType: fieldType,
                    options: options
                });
            } else if (match[2]) { // Text component
                const textParts = match[2].split('\n');
                textParts.forEach((part, index) => {
                    if (index > 0) {
                        paragraphs.push({ components: [] });
                    }
                    if (part.trim()) {
                        paragraphs[paragraphs.length - 1].components.push({
                            type: 'text',
                            content: part,
                            name: "",
                            fieldType: "text"
                        });
                    }
                });
            }
        }

        return paragraphs;
    }

    parseField(field: string): [string, string, string[] | undefined] {
        // Remove square brackets
        const content = field.trim();

        // Find the index of the first opening parenthesis
        const openParenIndex = content.indexOf('(');

        let name: string;
        let type: string = 'text';  // Default type
        let optionsString: string = '';

        if (openParenIndex === -1) {
            // No parentheses found, everything is the name
            name = content;
        } else {
            // Find the matching closing parenthesis
            const closeParenIndex = content.indexOf(')', openParenIndex);
            if (closeParenIndex === -1) {
                // Mismatched parentheses, treat everything as name
                name = content;
            } else {
                name = content.slice(0, openParenIndex).trim();
                type = content.slice(openParenIndex + 1, closeParenIndex).trim();
                optionsString = content.slice(closeParenIndex + 1).trim();
            }
        }

        // Parse options if present
        const options = optionsString ? optionsString.split(',').map(o => o.trim()).filter(o => o !== '') : undefined;

        return [name, type, options];
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h1", { text: this.title });
        const form = contentEl.createEl("form");
        form.onsubmit = (e) => {
            e.preventDefault();
            this.handleSubmit();
        };

        this.paragraphs.forEach(paragraph => {
            const p = form.createEl("p");
            paragraph.components.forEach(component => {
                if (component.type === 'text') {
                    p.appendText(component.content);
                } else {
                    this.createInputComponent(p, component);
                }
            });
        });

        form.createEl("button", { text: "Submit", type: "submit" });
    }

    createInputComponent(paragraph: HTMLParagraphElement, component: ModalComponent) {
        switch (component.fieldType) {
            case 'textarea':
                paragraph.createEl("textarea", {
                    attr: {
                        name: component.name,
                        placeholder: component.content,
                        'aria-label': component.content
                    },
                });
                break;
            case 'checkbox': {
                const checkboxLabel = paragraph.createEl("label");
                checkboxLabel.createEl("input", {
                    type: "checkbox",
                    attr: { name: component.name }
                });
                checkboxLabel.appendText(component.content);
                break;
            }
            case 'radio':
                if (component.options) {
                    component.options.forEach((option, index) => {
                        const radioLabel = paragraph.createEl("label");
                        radioLabel.createEl("input", {
                            type: "radio",
                            attr: {
                                name: component.name,
                                value: option,
                                id: `${component.name}-${index}`
                            }
                        });
                        radioLabel.appendText(option);
                    });
                }
                break;
            case 'select':
                if (component.options) {
                    const select = paragraph.createEl("select", {
                        attr: { name: component.name }
                    });
                    component.options.forEach(option => {
                        select.createEl("option", {
                            text: option,
                            value: option
                        });
                    });
                }
                break;
            case 'text':
            case '':
            case undefined:
                paragraph.createEl("input", {
                    type: "text",
                    attr: {
                        name: component.name,
                        placeholder: component.content,
                        'aria-label': component.content
                    },
                });
                break;
            default:
                paragraph.createEl("input", {
                    type: component.fieldType,
                    attr: {
                        name: component.name,
                        placeholder: component.content,
                        'aria-label': component.content
                    },
                });
                break;
        }
    }

    onClose() {
        if (!this.isSubmitted) {
            this.callback(new Error("Modal closed without submission"));
        }
    }

    handleSubmit() {
        const inputs = this.contentEl.querySelectorAll("input, textarea, select");
        const result: Record<string, string> = {};

        inputs.forEach((input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
            if (input.name) {
                if (input instanceof HTMLInputElement && input.type === 'checkbox') {
                    result[input.name] = input.checked ? "true" : "false";
                } else if (input instanceof HTMLSelectElement) {
                    result[input.name] = input.value;
                } else {
                    result[input.name] = input.value.trim() || "No input";
                }
            }
        });

        this.isSubmitted = true;
        this.close();
        this.callback(result);
    }
}