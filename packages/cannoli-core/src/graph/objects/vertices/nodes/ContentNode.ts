import { CannoliObject } from "src/graph/CannoliObject";
import {
	ContentNodeType,
	GroupType,
	CannoliObjectStatus,
	EdgeType,
	EdgeModifier,
} from "src/graph";
import { CannoliEdge } from "../../CannoliEdge";
import { ChatResponseEdge } from "../../edges/ChatResponseEdge";
import { LoggingEdge } from "../../edges/LoggingEdge";
import { CannoliGroup } from "../CannoliGroup";
import { CannoliNode, VersionedContent } from "../CannoliNode";
import { parseNamedNode } from "src/utility";

export class ContentNode extends CannoliNode {
	reset(): void {
		// If it's a standard content node or output node, reset the text and then call the super
		if (
			this.type === ContentNodeType.StandardContent ||
			this.type === ContentNodeType.Output
		) {
			const name = this.getName();
			if (
				name !== null &&
				this.type !== ContentNodeType.StandardContent
			) {
				// Clear everything except the first line
				this.setText(this.text.split("\n")[0]);
			} else {
				// Clear everything
				this.setText("");
			}
		}

		super.reset();
	}

	getName(content?: string): string | null {
		const contentToCheck = content || this.text;

		if (this.type === ContentNodeType.StandardContent) {
			return null;
		}

		const { name } = parseNamedNode(contentToCheck);
		return name;
	}

	// Content is everything after the first line
	getContentCheckName(content?: string): string {
		const contentToCheck = content || this.text;
		const { name, content: parsedContent } = parseNamedNode(contentToCheck);

		if (name !== null) {
			return parsedContent;
		}
		return contentToCheck;
	}

	editContentCheckName(newContent: string): void {
		const name = this.getName();
		const firstLine = this.text.split("\n")[0];
		if (name !== null) {
			const newFirstLine = newContent.split("\n")[0].trim();
			// Check if the first line of the new content matches the current name line
			if (newFirstLine === firstLine.trim()) {
				// Discard the first line of the new content
				newContent = newContent.substring(newFirstLine.length).trim();
			}
			this.setText(`${firstLine}\n${newContent}`);
		} else {
			this.setText(newContent);
		}
	}

	filterName(content: string): string {
		const name = this.getName(content);
		if (name !== null) {
			const firstLine = content.split("\n")[0];
			return content.substring(firstLine.length + 1).trim();
		}
		return content;
	}

	async execute(): Promise<void> {
		this.executing();

		let content = this.getWriteOrLoggingContent();

		if (content === null) {
			const variableValues = this.getVariableValues(false);

			// Get first variable value
			if (variableValues.length > 0) {
				content = variableValues[0].content || "";
			}
		}

		if (content === null || content === undefined) {
			content = await this.processReferences();
		}

		content = this.filterName(content);

		if (
			this.type === ContentNodeType.Output ||
			this.type === ContentNodeType.Formatter ||
			this.type === ContentNodeType.StandardContent
		) {
			this.editContentCheckName(content);
			this.loadOutgoingEdges(content);
		} else {
			this.loadOutgoingEdges(content);
		}

		this.completed();
	}

	dependencyCompleted(dependency: CannoliObject): void {
		// If the dependency is a logging edge not crossing out of a forEach group or a chatResponse edge, execute regardless of this node's status
		if (
			(dependency instanceof LoggingEdge &&
				!dependency.crossingOutGroups.some((group) => {
					const groupObject = this.graph[group];
					if (!(groupObject instanceof CannoliGroup)) {
						throw new Error(
							`Error on object ${groupObject.id}: object is not a group.`,
						);
					}
					return groupObject.type === GroupType.ForEach;
				})) ||
			dependency instanceof ChatResponseEdge
		) {
			this.execute();
		} else if (
			this.allDependenciesComplete() &&
			this.status === CannoliObjectStatus.Pending
		) {
			this.execute();
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Content\n`;
	}

	getWriteOrLoggingContent(): string | null {
		// Get all incoming edges
		const incomingEdges = this.getIncomingEdges();

		// If there are multiple logging edges
		if (
			incomingEdges.filter((edge) => edge.type === EdgeType.Logging)
				.length > 1
		) {
			// Append the content of all logging edges
			let content = "";
			for (const edge of incomingEdges) {
				const edgeObject = this.graph[edge.id];
				if (edgeObject instanceof LoggingEdge) {
					if (edgeObject.content !== null) {
						content += edgeObject.content;
					}
				}
			}

			return content;
		}

		// Filter for incoming complete edges of type write, logging, or chatResponse, as well as edges with no text
		let filteredEdges = incomingEdges.filter(
			(edge) =>
				(edge.type === EdgeType.Write ||
					edge.type === EdgeType.Logging ||
					edge.type === EdgeType.ChatResponse ||
					edge.text.length === 0) &&
				this.graph[edge.id].status === CannoliObjectStatus.Complete,
		);

		// Remove all edges with a vault modifier of type folder or property
		filteredEdges = filteredEdges.filter(
			(edge) =>
				edge.edgeModifier !== EdgeModifier.Folder &&
				edge.edgeModifier !== EdgeModifier.Property,
		);

		if (filteredEdges.length === 0) {
			return null;
		}

		// Check for edges with versions
		const edgesWithVersions = filteredEdges.filter((edge) => {
			const edgeObject = this.graph[edge.id];
			return (
				edgeObject instanceof CannoliEdge &&
				edgeObject.versions &&
				edgeObject.versions.length > 0
			);
		});

		if (edgesWithVersions.length > 0) {
			const allVersions: VersionedContent[] = [];
			for (const edge of edgesWithVersions) {
				const edgeObject = this.graph[edge.id] as CannoliEdge;
				if (edgeObject.content !== null) {
					allVersions.push({
						content: edgeObject.content as string,
						versionArray: edgeObject.versions as {
							header: string | null;
							subHeader: string | null;
						}[],
					});
				}
			}

			const modifier = edgesWithVersions[0].edgeModifier;

			let fromFormatterNode = false;

			if (
				this.graph[edgesWithVersions[0].source].type ===
				ContentNodeType.Formatter
			) {
				fromFormatterNode = true;
			}

			const mergedContent = this.renderMergedContent(
				allVersions,
				modifier,
				fromFormatterNode,
				edgesWithVersions[0].text,
			);

			if (mergedContent) {
				return mergedContent;
			}
		}

		// If there are write or chatResponse edges, return the content of the first one
		const firstEdge = filteredEdges[0];
		const firstEdgeObject = this.graph[firstEdge.id];
		if (firstEdgeObject instanceof CannoliEdge) {
			if (
				firstEdgeObject.content !== null &&
				typeof firstEdgeObject.content === "string"
			) {
				return firstEdgeObject.content;
			}
		} else {
			throw new Error(
				`Error on object ${firstEdgeObject.id}: object is not an edge.`,
			);
		}

		return null;
	}

	isValidVariableName(name: string): boolean {
		// Regular expression to match valid JavaScript variable names
		const validNamePattern = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;
		// Check if the name matches the pattern
		return validNamePattern.test(name);
	}

	isReservedKeyword(name: string): boolean {
		const reservedKeywords = [
			"break",
			"case",
			"catch",
			"class",
			"const",
			"continue",
			"debugger",
			"default",
			"delete",
			"do",
			"else",
			"enum",
			"export",
			"extends",
			"false",
			"finally",
			"for",
			"function",
			"if",
			"import",
			"in",
			"instanceof",
			"new",
			"null",
			"return",
			"super",
			"switch",
			"this",
			"throw",
			"true",
			"try",
			"typeof",
			"var",
			"void",
			"while",
			"with",
			"yield",
			"let",
			"static",
			"implements",
			"interface",
			"package",
			"private",
			"protected",
			"public",
		];
		return reservedKeywords.includes(name);
	}

	validate(): void {
		super.validate();

		if (
			this.type === ContentNodeType.Input ||
			this.type === ContentNodeType.Output
		) {
			const name = this.getName();
			if (name !== null) {
				if (!this.isValidVariableName(name)) {
					this.error(
						`"${name}" is not a valid variable name. Input and output node names must start with a letter, underscore, or dollar sign, and can only contain letters, numbers, underscores, or dollar signs.`,
					);
				}
				if (this.isReservedKeyword(name)) {
					this.error(
						`"${name}" is a reserved keyword, and cannot be used as an input or output node name.`,
					);
				}

				if (this.type === ContentNodeType.Output) {
					if (this.getGroups().some((group) => group.fromForEach)) {
						this.error(
							`Named output nodes cannot be inside of parallel groups.`,
						);
					}
				}
			}
		}
	}
}
