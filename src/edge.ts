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
	crossingGroups: {
		group: CannoliGroup;
		isEntering: boolean;
	}[];
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
		// If there's an edge tag, the source node must be a call node and the target node must be a call node
		if (this.tags.length > 0) {
			if (this.source.type !== "call") {
				throw new Error(
					`Edge ${this.id} has an edge tag but the source node is not a call node`
				);
			}
			if (this.target.type !== "call") {
				throw new Error(
					`Edge ${this.id} has an edge tag but the target node is not a call node`
				);
			}
		}

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

	validateBlank() {
		switch (this.subtype) {
			case "continueChat":
				// The source node must be a call node
				if (this.source.type !== "call") {
					throw new Error(
						`Edge ${this.id} is a continueChat edge but the source node is not a call node`
					);
				}

				// The target node must be a call node
				if (this.target.type !== "call") {
					throw new Error(
						`Edge ${this.id} is a continueChat edge but the target node is not a call node`
					);
				}
				break;
			case "systemMessage":
				// The source node must be a content node
				if (this.source.type !== "content") {
					throw new Error(
						`Edge ${this.id} is a systemMessage edge but the source node is not a content node`
					);
				}
				// The target node must be a call node
				if (this.target.type !== "call") {
					throw new Error(
						`Edge ${this.id} is a systemMessage edge but the target node is not a call node`
					);
				}
				break;
			case "write":
				// The target node must be a content node
				if (this.target.type !== "content") {
					throw new Error(
						`Edge ${this.id} is a write edge but the target node is not a content node`
					);
				}
				break;
			default:
				throw new Error(
					`Edge ${this.id} has an invalid subtype: ${this.subtype}`
				);
		}
	}

	validateVariable() {
		switch (this.subtype) {
			case "":
				// There must be only one variable
				if (this.variables.length !== 1) {
					throw new Error(
						`Edge ${this.id} is a variable edge but has ${this.variables.length} variables`
					);
				}
				// The variable must not be a choice option or config variable
				if (
					this.variables[0].type === "choiceOption" ||
					this.variables[0].type === "config"
				) {
					throw new Error(
						`Edge ${this.id} is a variable edge but has a choice option or config variable`
					);
				}

				break;
			default:
				throw new Error(
					`Edge ${this.id} has an invalid subtype: ${this.subtype}`
				);
		}
	}

	validateUtility() {
		switch (this.subtype) {
			case "logging":
				// There must be no variables
				if (this.variables.length !== 0) {
					throw new Error(
						`Edge ${this.id} is a logging edge but has ${this.variables.length} variables`
					);
				}
				break;
			case "config":
				// All variables must be config variables
				if (
					this.variables.some(
						(variable) => variable.type !== "config"
					)
				) {
					throw new Error(
						`Edge ${this.id} is a config edge but has a non-config variable`
					);
				}
				break;
			default:
				throw new Error(
					`Edge ${this.id} has an invalid subtype: ${this.subtype}`
				);
		}
	}

	validateFunction() {
		switch (this.subtype) {
			case "":
				// There must be some variables
				if (this.variables.length === 0) {
					throw new Error(
						`Edge ${this.id} is a function edge but has no variables`
					);
				}
				// No variables can be choice options
				if (
					this.variables.some(
						(variable) => variable.type === "choiceOption"
					)
				) {
					throw new Error(
						`Edge ${this.id} is a function edge but has a choice option variable`
					);
				}
				break;
			default:
				throw new Error(
					`Edge ${this.id} has an invalid subtype: ${this.subtype}`
				);
		}
	}

	validateChoice() {
		// The first variable must be a choice option
		if (this.variables[0].type !== "choiceOption") {
			throw new Error(
				`Edge ${this.id} is a choice edge but the first variable is not a choice option`
			);
		}
		// No other variables can be choice options
		if (
			this.variables
				.slice(1)
				.some((variable) => variable.type === "choiceOption")
		) {
			throw new Error(
				`Edge ${this.id} is a choice edge but a non-first variable is a choice option`
			);
		}

		switch (this.subtype) {
			case "normal":
				// It must not be leaving a group
				if (
					this.crossingGroups.some(
						(crossingGroup) => !crossingGroup.isEntering
					)
				) {
					throw new Error(
						`Edge ${this.id} is a normal choice edge but is leaving a group`
					);
				}
				break;
			case "outOfGroup":
				// It must be leaving a group
				if (
					this.crossingGroups.every(
						(crossingGroup) => crossingGroup.isEntering
					)
				) {
					throw new Error(
						`Edge ${this.id} is an outOfGroup choice edge but is not leaving a group`
					);
				}
				break;
			default:
				throw new Error(
					`Edge ${this.id} has an invalid subtype: ${this.subtype}`
				);
		}
	}

	validateList() {
		// It must only have one variable
		if (this.variables.length !== 1) {
			throw new Error(
				`Edge ${this.id} is a list edge but has ${this.variables.length} variables`
			);
		}

		// It's source must be a call node
		if (this.source.type !== "call") {
			throw new Error(
				`Edge ${this.id} is a list edge but the source node is not a call node`
			);
		}

		switch (this.subtype) {
			case "list":
				break;
			case "listGroup": {
				// All of its source node's outgoing list edges must be listGroup edges
				if (
					this.source.outgoingEdges
						.filter((edge) => edge.subtype === "list")
						.some((edge) => edge.subtype !== "listGroup")
				) {
					throw new Error(
						`Edge ${this.id} is a listGroup edge but its source node has a list edge that is not a listGroup edge`
					);
				}

				// At least one of its source node's outgoing edges must be a listGroup edge that crosses a listGroup and no other groups
				if (
					!this.source.outgoingEdges
						.filter((edge) => edge.subtype === "listGroup")
						.some(
							(edge) =>
								edge.crossingGroups.length === 1 &&
								edge.crossingGroups[0].group.type === "list"
						)
				) {
					throw new Error(
						`Edge ${this.id} is a listGroup edge but its source node has no listGroup edges that cross a listGroup`
					);
				}

				// All of its source node's outgoing edges that are listGroup edges that cross groups must have the same first crossing group
				const firstCrossingGroups = this.source.outgoingEdges
					.filter((edge) => edge.subtype === "listGroup")
					.map((edge) => edge.crossingGroups[0].group);
				if (
					!firstCrossingGroups.every(
						(group) => group === firstCrossingGroups[0]
					)
				) {
					throw new Error(
						`Edge ${this.id} is a listGroup edge but its source node has listGroup edges that cross different groups`
					);
				}

				// Its first variable must be the only variable coming out of its source node
				if (
					// Of the source node's outgoing edges, the ones that are listGroup edges must have the same first variable as this edge
					this.source.outgoingEdges
						.filter((edge) => edge.subtype === "listGroup")
						.some(
							(edge) =>
								edge.variables[0].name !==
								this.variables[0].name
						)
				) {
					throw new Error(
						`Edge ${this.id} is a listGroup edge but its first variable is not the only variable coming out of its source node`
					);
				}
				break;
			}
			case "select":
				// It must be exiting a group
				if (
					this.crossingGroups.some(
						(crossingGroup) => crossingGroup.isEntering
					)
				) {
					throw new Error(
						`Edge ${this.id} is a select edge but is entering a group`
					);
				}

				break;
			default:
				throw new Error(
					`Edge ${this.id} has an invalid subtype: ${this.subtype}`
				);
		}
	}
}
