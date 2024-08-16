import { App, Modal, TextAreaComponent, DropdownComponent, TextComponent, ToggleComponent } from "obsidian";
import moment from 'moment';
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
    values: Record<string, string>;

    constructor(app: App, format: string, callback: (result: Record<string, string> | Error) => void, title: string) {
        super(app);
        this.format = format;
        this.callback = callback;
        this.title = title;
        this.paragraphs = this.parseFormat();
        this.isSubmitted = false;
        this.values = {};
    }

    parseFormat(): ModalParagraph[] {
        const regex = /(\s*)\[([^\]]+)\]|([^[]+)/g;
        const paragraphs: ModalParagraph[] = [{ components: [] }];
        let match;

        while ((match = regex.exec(this.format)) !== null) {
            if (match[2]) { // Input component
                const [fieldName, fieldType, options] = this.parseField(match[2]);
                if (match[1]) { // Preserve leading whitespace
                    paragraphs[paragraphs.length - 1].components.push({
                        type: 'text',
                        content: match[1],
                        name: "",
                        fieldType: "text"
                    });
                }
                paragraphs[paragraphs.length - 1].components.push({
                    type: 'input',
                    content: fieldName,
                    name: fieldName,
                    fieldType: fieldType,
                    options: options
                });
            } else if (match[3]) { // Text component
                const textParts = match[3].split('\n');
                textParts.forEach((part, index) => {
                    if (index > 0) {
                        paragraphs.push({ components: [] });
                    }
                    paragraphs[paragraphs.length - 1].components.push({
                        type: 'text',
                        content: part,
                        name: "",
                        fieldType: "text"
                    });
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
        this.addStyle();
    }

    addStyle() {
        const style = document.createElement('style');
        style.textContent = `
            .modal-content p {
                white-space: pre-wrap;
            }
        `;
        document.head.appendChild(style);
    }

    createInputComponent(paragraph: HTMLParagraphElement, component: ModalComponent) {
        let settingComponent;

        const updateValue = (value: string) => {
            this.values[component.name] = value;
        };

        switch (component.fieldType) {
            case 'textarea':
                settingComponent = new TextAreaComponent(paragraph)
                    .setPlaceholder(component.content)
                    .onChange(updateValue);
                updateValue('');
                break;
            case 'toggle': {
                const toggleWrapper = paragraph.createDiv({ cls: 'toggle-wrapper' });
                settingComponent = new ToggleComponent(toggleWrapper)
                    .setValue(false)
                    .onChange(value => updateValue(value ? "true" : "false"));
                updateValue("false");
                break;
            }
            case 'dropdown':
                if (component.options && component.options.length > 0) {
                    settingComponent = new DropdownComponent(paragraph)
                        .addOptions(Object.fromEntries(component.options.map(opt => [opt, opt])))
                        .onChange(updateValue);
                    updateValue(component.options[0]);
                }
                break;
            case 'date': {
                settingComponent = new TextComponent(paragraph)
                    .setPlaceholder(component.content)
                    .onChange(updateValue);
                settingComponent.inputEl.type = 'date';
                const defaultDate = moment().format('YYYY-MM-DD');
                settingComponent.inputEl.value = defaultDate;
                updateValue(defaultDate);
                break;
            }
            case 'time': {
                settingComponent = new TextComponent(paragraph)
                    .setPlaceholder(component.content)
                    .onChange(updateValue);
                settingComponent.inputEl.type = 'datetime-local';
                const defaultTime = moment().format('YYYY-MM-DDTHH:mm');
                settingComponent.inputEl.value = defaultTime;
                updateValue(defaultTime);
                break;
            }
            case 'text':
            case '':
            case undefined:
            default:
                settingComponent = new TextComponent(paragraph)
                    .setPlaceholder(component.content)
                    .onChange(updateValue);
                updateValue('');
                break;

        }

        if (settingComponent) {
            if (settingComponent instanceof ToggleComponent) {
                settingComponent.toggleEl.setAttribute('data-name', component.name);
                settingComponent.toggleEl.setAttribute('aria-label', component.content);
            } else if ('inputEl' in settingComponent) {
                settingComponent.inputEl.name = component.name;
                settingComponent.inputEl.setAttribute('aria-label', component.content);
            }
        }

        if (component.fieldType === 'toggle') {
            paragraph.addClass('toggle-paragraph');
        }
    }

    onClose() {
        if (!this.isSubmitted) {
            this.callback(new Error("Modal closed without submission"));
        }
    }

    handleSubmit() {
        const result = { ...this.values };

        this.paragraphs.forEach(paragraph => {
            paragraph.components.forEach(component => {
                if (component.type === 'input') {
                    if (!(component.name in result) ||
                        (component.fieldType === 'text' || component.fieldType === 'textarea') && result[component.name].trim() === '') {
                        result[component.name] = "No input";
                    }
                }
            });
        });

        this.isSubmitted = true;
        this.close();
        this.callback(result);
    }
}