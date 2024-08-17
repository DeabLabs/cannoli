import { App, Modal, TextAreaComponent, DropdownComponent, TextComponent, ToggleComponent } from "obsidian";
import moment from 'moment';
import { Action } from "@deablabs/cannoli-core";

export const modalMaker: Action = {
    name: "modal",
    function: async ({
        layout,
        title = "Cannoli modal"
    }: {
        layout: string;
        title?: string;
    }): Promise<string | Error> => {
        return new Promise((resolve) => {
            try {
                new CustomModal(app, layout, (result) => {
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
        layout: {
            category: "arg",
            type: "string",
            description: "The layout of the modal",
        }
    }
}

interface ModalComponent {
    type: 'text' | 'input';
    content: string;
    name: string;
    fieldType: string;
    options?: string[];
    format: string;
}

interface ModalParagraph {
    components: ModalComponent[];
}

class CustomModal extends Modal {
    layout: string;
    callback: (result: Record<string, string> | Error) => void;
    title: string;
    paragraphs: ModalParagraph[];
    isSubmitted: boolean;
    values: Record<string, string>;

    constructor(app: App, layout: string, callback: (result: Record<string, string> | Error) => void, title: string) {
        super(app);
        this.layout = layout;
        this.callback = callback;
        this.title = title;
        this.paragraphs = this.parseLayout();
        this.isSubmitted = false;
        this.values = {};
    }

    parseLayout(): ModalParagraph[] {
        const regex = /(\s*)==([\s\S]+?)==|([^=]+)/g;
        const paragraphs: ModalParagraph[] = [{ components: [] }];
        let match;

        while ((match = regex.exec(this.layout)) !== null) {
            if (match[2]) { // Input component
                const trimmedContent = match[2].trim();
                let fieldContent: string | string[];

                // Check if content is a JSON array
                if (trimmedContent.startsWith('[') && trimmedContent.endsWith(']')) {
                    try {
                        // Attempt to parse as JSON, handling potential escaping issues
                        fieldContent = JSON.parse(trimmedContent.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
                    } catch (e) {
                        console.error('Failed to parse JSON options:', e);
                        // If parsing fails, treat it as a comma-separated list
                        fieldContent = trimmedContent.slice(1, -1).split(',').map(item =>
                            item.trim().replace(/^["']|["']$/g, '') // Remove surrounding quotes if present
                        );
                    }
                } else {
                    fieldContent = trimmedContent;
                }

                let fieldName: string, fieldType: string, options: string[] | undefined;

                if (Array.isArray(fieldContent)) {
                    // If fieldContent is an array, assume the first element is the field name and type
                    const [nameAndType, ...rest] = fieldContent;
                    [fieldName, fieldType] = this.parseNameAndType(nameAndType as string);
                    options = rest.map(String);
                } else {
                    // If fieldContent is a string, use parseField as before
                    [fieldName, fieldType, options] = this.parseField(fieldContent);
                }

                const format = this.parseField(Array.isArray(fieldContent) ? fieldContent[0] : fieldContent)[3] ||
                    (fieldType === 'date' ? 'YYYY-MM-DD' :
                        fieldType === 'time' ? 'YYYY-MM-DDTHH:mm' : '');

                if (match[1]) { // Preserve leading whitespace
                    paragraphs[paragraphs.length - 1].components.push({
                        type: 'text',
                        content: match[1],
                        name: "",
                        fieldType: "text",
                        format: format
                    });
                }
                paragraphs[paragraphs.length - 1].components.push({
                    type: 'input',
                    content: fieldName,
                    name: fieldName,
                    fieldType: fieldType,
                    options: options,
                    format: format
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
                        fieldType: "text",
                        format: ""
                    });
                });
            }
        }

        return paragraphs;
    }

    parseField(field: string): [string, string, string[] | undefined, string | undefined] {
        // Remove double equals signs
        const content = field.trim();

        // Find the index of the first opening parenthesis
        const openParenIndex = content.indexOf('(');

        let name: string;
        let type: string = 'text';  // Default type
        let optionsString: string = '';
        let format: string | undefined;

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
                const remainingContent = content.slice(closeParenIndex + 1).trim();

                // Check if there's content after the type declaration
                if (remainingContent) {
                    if (type === 'date' || type === 'time') {
                        format = remainingContent;
                    } else {
                        optionsString = remainingContent;
                    }
                }
            }
        }

        // Parse options if present
        let options: string[] | undefined;
        if (optionsString.startsWith('[') && optionsString.endsWith(']')) {
            try {
                // Attempt to parse as JSON, handling potential escaping issues
                options = JSON.parse(optionsString.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
            } catch (e) {
                // If parsing fails, treat it as a comma-separated list
                options = optionsString.slice(1, -1).split(',').map(item =>
                    item.trim().replace(/^["']|["']$/g, '') // Remove surrounding quotes if present
                );
            }

            // Ensure options is an array of strings
            if (Array.isArray(options)) {
                options = options.flat().map(String);
            } else {
                options = [String(options)];
            }
        } else {
            options = optionsString ? optionsString.split(',').map(o => o.trim()).filter(o => o !== '') : undefined;
        }

        return [name, type, options, format];
    }

    parseNameAndType(content: string): [string, string] {
        // Remove any leading or trailing whitespace
        content = content.trim();

        // Find the index of the last opening parenthesis
        const openParenIndex = content.lastIndexOf('(');

        if (openParenIndex === -1) {
            // If there's no parenthesis, assume it's all name and type is default
            return [content, 'text'];
        }

        // Find the matching closing parenthesis
        const closeParenIndex = content.indexOf(')', openParenIndex);

        if (closeParenIndex === -1) {
            // If there's no closing parenthesis, assume it's all name
            return [content, 'text'];
        }

        // Extract the name (everything before the last opening parenthesis)
        const name = content.slice(0, openParenIndex).trim();

        // Extract the type (everything between the parentheses)
        const type = content.slice(openParenIndex + 1, closeParenIndex).trim();

        return [name, type || 'text'];
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
            if (component.fieldType === 'date' || component.fieldType === 'time') {
                const formattedValue = moment(value, component.fieldType === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm').format(component.format);
                this.values[component.name] = formattedValue;
            } else {
                this.values[component.name] = value;
            }
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
                    .onChange((value) => {
                        updateValue(value);
                    });
                settingComponent.inputEl.type = 'date';
                const defaultDate = moment().format(component.format);
                settingComponent.inputEl.value = moment(defaultDate, component.format).format('YYYY-MM-DD');
                updateValue(settingComponent.inputEl.value);
                break;
            }
            case 'time': {
                settingComponent = new TextComponent(paragraph)
                    .setPlaceholder(component.content)
                    .onChange((value) => {
                        updateValue(value);
                    });
                settingComponent.inputEl.type = 'datetime-local';
                const defaultTime = moment().format(component.format);
                settingComponent.inputEl.value = moment(defaultTime, component.format).format('YYYY-MM-DDTHH:mm');
                updateValue(settingComponent.inputEl.value);
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
                        ((component.fieldType === 'text' || component.fieldType === 'textarea') && result[component.name].trim() === '')) {
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