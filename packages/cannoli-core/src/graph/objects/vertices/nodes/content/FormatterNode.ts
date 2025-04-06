import { ContentNode } from "../ContentNode";

export class FormatterNode extends ContentNode {
	logDetails(): string {
		return super.logDetails() + `Subtype: Formatter\n`;
	}

	async execute(): Promise<void> {
		this.executing();

		const content = await this.processReferences();

		// Take off the first 2 and last 2 characters (the double double quotes)
		const processedContent = content.slice(2, -2);

		// Load all outgoing edges
		this.loadOutgoingEdges(processedContent);

		this.completed();
	}
}
