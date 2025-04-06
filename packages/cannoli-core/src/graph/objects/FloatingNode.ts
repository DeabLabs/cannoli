import { CannoliObject } from "src/graph/CannoliObject";
import {
	VerifiedCannoliCanvasTextData,
	VerifiedCannoliCanvasLinkData,
	VerifiedCannoliCanvasFileData,
	VerifiedCannoliCanvasData,
	CannoliObjectStatus,
} from "src/graph";
import * as yaml from "js-yaml";

export class FloatingNode extends CannoliObject {
	constructor(
		nodeData:
			| VerifiedCannoliCanvasTextData
			| VerifiedCannoliCanvasLinkData
			| VerifiedCannoliCanvasFileData,
		fullCanvasData: VerifiedCannoliCanvasData,
	) {
		super(nodeData, fullCanvasData);
		this.setStatus(CannoliObjectStatus.Complete);
	}

	dependencyCompleted(dependency: CannoliObject): void {
		return;
	}

	dependencyRejected(dependency: CannoliObject): void {
		return;
	}

	async execute() {
		this.completed();
	}

	getName(): string {
		const firstLine = this.text.split("\n")[0].trim();
		// Take the first and last characters off the first line
		return firstLine.substring(1, firstLine.length - 1);
	}

	// Content is everything after the first line
	getContent(): string {
		const firstLine = this.text.split("\n")[0];
		return this.text.substring(firstLine.length + 1);
	}

	editContent(newContent: string): void {
		const firstLine = this.text.split("\n")[0];
		this.setText(`${firstLine}\n${newContent}`);

		const event = new CustomEvent("update", {
			detail: { obj: this, status: this.status },
		});
		this.dispatchEvent(event);
	}

	editProperty(propertyName: string, newContent: string): void {
		// Find the frontmatter from the content
		const frontmatter = this.getContent().split("---")[1];

		if (!frontmatter) {
			return;
		}

		const parsedFrontmatter: Record<string, string> = yaml.load(
			frontmatter,
		) as Record<string, string>;

		// If the parsed frontmatter is null, return
		if (!parsedFrontmatter) {
			return;
		}

		// Set the property to the new content
		parsedFrontmatter[propertyName] = newContent;

		// Stringify the frontmatter and add it back to the content
		const newFrontmatter = yaml.dump(parsedFrontmatter);

		const newProps = `---\n${newFrontmatter}---\n${
			this.getContent().split("---")[2]
		}`;

		this.editContent(newProps);
	}

	getProperty(propertyName: string): string {
		// If property name is empty, return the entire frontmatter
		if (propertyName.length === 0) {
			return this.getContent().split("---")[1];
		}

		// Find the frontmatter from the content
		const frontmatter = this.getContent().split("---")[1];

		if (!frontmatter) {
			return "";
		}

		const parsedFrontmatter: Record<string, string> = yaml.load(
			frontmatter,
		) as Record<string, string>;

		// If the parsed frontmatter is null, return
		if (!parsedFrontmatter) {
			return "";
		}

		return parsedFrontmatter[propertyName];
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: Floating\nName: ${this.getName()}\nContent: ${this.getContent()}\n`
		);
	}
}
