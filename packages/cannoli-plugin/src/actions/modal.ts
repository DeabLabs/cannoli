import { Action } from "@deablabs/cannoli-core";
import { VaultInterface } from "src/vault_interface";

export const modalMaker: Action = {
  name: "modal",
  function: async ({
    layout,
    vault,
  }: {
    layout: string;
    vault: VaultInterface;
  }): Promise<string | Error> => {
    return vault.openCustomModal(layout);
  },
  argInfo: {
    layout: {
      category: "arg",
      type: "string",
      description: "The layout of the modal",
      prompt: `# Modal Layout Syntax

## Title
- First line: modal title (if not an input field)
- Default: "Cannoli modal"

## Structure
- Plain text: Rendered as-is
- Input fields: ==Field Name(field_type) options==
- Layout follows input string formatting
- Newlines create new paragraphs/lines in modal

## Input Fields
- Field Name: Required, used as placeholder text
- (field_type): Optional (default: text)
- options: For dropdowns/date formats

## Field Types
1. text: Single-line input
2. textarea: Multi-line input
3. toggle: Boolean switch (default: false)
4. dropdown: Option selection (first is default)
5. date: Date picker (default: today)
6. time: Time picker (default: now)
7. datetime: Date and time picker (default: now)

## Examples
Text input: ==User Name==
Textarea: ==Comments(textarea)==
Toggle: ==Enable Feature(toggle)==
Dropdown: ==Select Option(dropdown) Option1, Option2==
Date: ==Select Date(date) YYYY-MM-DD==

## Important Notes
- Field names not auto-displayed; add explicit labels
- Example:
  Enter your name: ==User Name==
  Select a color: ==Color(dropdown) Red, Green, Blue==
- Whitespace before == preserved in layout
- Modal layout mirrors input string formatting
- Inputs on same line as text appear inline
- Empty text inputs default to "No input"
- Date/time formats customizable (e.g., YYYY-MM-DD, HH:mm)
- Dropdown options: Comma-separated list or JSON array
- Markdown formatting not supported in modal`,
    },
    vault: {
      category: "fileManager",
    },
  },
};
