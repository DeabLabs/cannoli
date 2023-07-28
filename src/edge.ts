import { ChatCompletionRequestMessage } from "openai";
import { CannoliGroup } from "./group";
import { CannoliNode } from "./node";

// Edge Types
export type EdgeType =
	| "blank"
	| "variable"
	| "utility"
	| "function"
	| "choice"
	| "list";

export type BlankSubtype = "continueChat" | "systemMessage" | "write";

export type VariableSubtype = "";

export type UtilitySubtype = "logging" | "config";

export type ListSubtype = "list" | "listGroup" | "select";

export type FunctionSubtype = "";

export type ChoiceSubtype = "normal" | "outOfGroup";

export type EdgeTag = "continueChat";

export type Variable = {
	name: string;
	type: VariableType;
	value?: string;
};

export type VariableType =
	| "existingLink"
	| "existingPath"
	| "newLink"
	| "newPath"
	| "choiceOption"
	| "regular"
	| "config";

export class CannoliEdge {
	id: string;
	label: string;
	sourceId: string;
	targetId: string;
	source: CannoliNode;
	target: CannoliNode;
	crossingGroups: { group: CannoliGroup; isEntering: boolean }[];
	variables: Variable[];
	tags: EdgeTag[];
	type: EdgeType;
	subtype:
		| UtilitySubtype
		| FunctionSubtype
		| ChoiceSubtype
		| ListSubtype
		| BlankSubtype
		| VariableSubtype;
	chatHistory: ChatCompletionRequestMessage[];
	copies: CannoliEdge[];

	constructor({
		id,
		label,
		sourceId,
		targetId,
		type,
		variables,
		tags,
	}: {
		id: string;
		label: string;
		sourceId: string;
		targetId: string;
		type: EdgeType;
		variables: Variable[];
		tags: EdgeTag[];
	}) {
		this.id = id;
		this.label = label;
		this.sourceId = sourceId;
		this.targetId = targetId;
		this.type = type;
		this.tags = tags;
		this.variables = variables;
	}

	logEdgeDetails() {
		const sourceFormat = this.source
			? `"${this.source.content.substring(0, 20)}..."`
			: "None";
		const targetFormat = this.target
			? `"${this.target.content.substring(0, 20)}..."`
			: "None";
		const crossingGroupsFormat =
			this.crossingGroups.length > 0
				? this.crossingGroups
						.map(
							(group) =>
								`\n\tCrossing Group: "${
									group.group.label
										? group.group.label.substring(0, 20)
										: "No Label"
								}..."`
						)
						.join("")
				: "\n\tCrossing Groups: None";
		const variablesFormat =
			this.variables.length > 0
				? this.variables
						.map(
							(variable) =>
								`\n\tVariable: "${variable.name}", Type: ${variable.type}`
						)
						.join("")
				: "\n\tVariables: None";
		const tagsFormat =
			this.tags.length > 0
				? this.tags.map((tag) => `\n\tTag: ${tag}`).join("")
				: "\n\tTags: None";

		const logString = `Edge: ${sourceFormat}----${this.label}---->${targetFormat} (Type: ${this.type}, Subtype: ${this.subtype}), ${variablesFormat}, ${crossingGroupsFormat} , ${tagsFormat}`;

		console.log(logString);
	}

	setSourceAndTarget(nodes: Record<string, CannoliNode>) {
		this.source = nodes[this.sourceId];
		this.target = nodes[this.targetId];
	}

	validate() {
		// Do global validation first

		// Do type-specific validation by calling the validate function for the type
		switch (this.type) {
			case "blank":
				this.validateBlank();
				break;
			case "variable":
				this.validateVariable();
				break;
			case "utility":
				this.validateUtility();
				break;
			case "function":
				this.validateFunction();
				break;
			case "choice":
				this.validateChoice();
				break;
			case "list":
				this.validateList();
				break;

			default:
				throw new Error(
					`Edge ${this.id} has an invalid type: ${this.type}`
				);
		}
	}

	validateBlank() {}

	validateVariable() {}

	validateUtility() {}

	validateFunction() {}

	validateChoice() {}

	validateList() {}
}
