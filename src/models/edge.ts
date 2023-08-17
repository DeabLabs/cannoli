import { CannoliObject, CannoliVertex } from "./object";
import { ChatCompletionRequestMessage } from "openai";
import { ForEachGroup, RepeatGroup } from "./group";
import {
	CannoliObjectStatus,
	EdgeType,
	VaultModifier,
	VerifiedCannoliCanvasEdgeData,
} from "./graph";

export class CannoliEdge extends CannoliObject {
	source: string;
	target: string;
	crossingInGroups: string[];
	crossingOutGroups: string[];
	isReflexive: boolean;
	addMessages: boolean;
	vaultModifier: VaultModifier | null;
	content: string | Record<string, string> | null;
	messages: ChatCompletionRequestMessage[] | null;

	constructor(edgeData: VerifiedCannoliCanvasEdgeData) {
		super(edgeData);
		this.source = edgeData.fromNode;
		this.target = edgeData.toNode;
		this.crossingInGroups = edgeData.cannoliData.crossingInGroups;
		this.crossingOutGroups = edgeData.cannoliData.crossingOutGroups;
		this.isReflexive = edgeData.cannoliData.isReflexive;
		this.addMessages = edgeData.cannoliData.addMessages;
		this.vaultModifier = edgeData.cannoliData.vaultModifier
			? edgeData.cannoliData.vaultModifier
			: null;
		this.content = edgeData.cannoliData.content
			? edgeData.cannoliData.content
			: null;
		this.messages = edgeData.cannoliData.messages
			? edgeData.cannoliData.messages
			: null;

		// Overrwite the addMessages for certain types of edges
		if (
			this.type === EdgeType.Chat ||
			this.type === EdgeType.SystemMessage
		) {
			this.addMessages = true;
		}
	}

	getSource(): CannoliVertex {
		return this.graph[this.source] as CannoliVertex;
	}

	getTarget(): CannoliVertex {
		return this.graph[this.target] as CannoliVertex;
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		this.content = content ? content : null;

		if (this.addMessages) {
			this.messages = messages ? messages : null;
		}
	}

	async execute(): Promise<void> {
		this.completed();
	}

	dependencyCompleted(dependency: CannoliObject): void {
		if (
			this.allDependenciesComplete() &&
			this.status === CannoliObjectStatus.Pending
		) {
			//console.log(`Executing edge with loaded content: ${this.content}`);
			this.execute();
		}
	}

	logDetails(): string {
		// Build crossing groups string of the text of the crossing groups
		let crossingGroupsString = "";
		crossingGroupsString += `Crossing Out Groups: `;
		for (const group of this.crossingOutGroups) {
			crossingGroupsString += `\n\t-"${this.ensureStringLength(
				this.graph[group].text,
				15
			)}"`;
		}
		crossingGroupsString += `\nCrossing In Groups: `;
		for (const group of this.crossingInGroups) {
			crossingGroupsString += `\n\t-"${this.ensureStringLength(
				this.graph[group].text,
				15
			)}"`;
		}

		return (
			`--> Edge ${this.id} Text: "${
				this.text ?? "undefined string"
			}"\n"${this.ensureStringLength(
				this.getSource().text ?? "undefined string",
				15
			)}--->"${this.ensureStringLength(
				this.getTarget().text ?? "undefined string",
				15
			)}"\n${crossingGroupsString}\nisReflexive: ${
				this.isReflexive
			}\nType: ${this.type}\n` + super.logDetails()
		);
	}

	reset() {
		super.reset();
		this.content = null;
		this.messages = null;
	}
}

export class SystemMessageEdge extends CannoliEdge {
	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (content) {
			this.messages = [
				{
					role: "system",
					content: content as string,
				},
			];
		}
	}
}

export class LoggingEdge extends CannoliEdge {
	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		// If content exists, save it as the configString
		let configString = null;

		if (content) {
			configString = this.content as string;
		}

		let logs = "";

		// Get the current loop number of any repeat type groups that the edge is crossing out of
		const repeatLoopNumbers = this.getLoopNumbers();

		const loopHeader = this.formatLoopHeader(repeatLoopNumbers);

		// Get the version header
		const forEachVersionNumbers = this.getForEachVersionNumbers();

		const versionHeader = this.formatVersionHeader(forEachVersionNumbers);

		if (repeatLoopNumbers.length > 0) {
			logs = `${loopHeader}\n`;
		}

		if (forEachVersionNumbers.length > 0) {
			logs = `${logs}${versionHeader}\n`;
		}

		if (messages !== undefined) {
			logs = `${logs}${this.formatInteractionHeaders(messages)}`;
		}

		// If there is a configString, add it to the logs
		if (configString !== null) {
			logs = `${logs}\n#### Config\n${configString}\n`;
		}

		this.content = logs;
	}

	getLoopNumbers(): number[] {
		// Get the current loop number of any repeat type groups that the edge is crossing out of
		const repeatLoopNumbers: number[] = [];

		this.crossingOutGroups.forEach((group) => {
			const groupObject = this.graph[group];
			if (groupObject instanceof RepeatGroup) {
				repeatLoopNumbers.push(groupObject.currentLoop);
			}
		});

		// Reverse the array
		repeatLoopNumbers.reverse();

		return repeatLoopNumbers;
	}

	getForEachVersionNumbers(): number[] {
		// Get the current loop number of any repeat type groups that the edge is crossing out of
		const forEachVersionNumbers: number[] = [];

		this.crossingOutGroups.forEach((group) => {
			const groupObject = this.graph[group];
			if (groupObject instanceof ForEachGroup) {
				forEachVersionNumbers.push(groupObject.currentLoop);
			}
		});

		// Reverse the array
		forEachVersionNumbers.reverse();

		return forEachVersionNumbers;
	}

	formatInteractionHeaders(messages: ChatCompletionRequestMessage[]): string {
		let formattedString = "";
		messages.forEach((message) => {
			const role = message.role;
			let content = message.content;
			if (message.function_call) {
				content = `Function Call: **${message.function_call.name}**\nArguments:\n\`\`\`json\n${message.function_call.arguments}\n\`\`\``;
			}
			formattedString += `#### <u>${
				role.charAt(0).toUpperCase() + role.slice(1)
			}</u>:\n${content}\n`;
		});
		return formattedString.trim();
	}

	formatLoopHeader(loopNumbers: number[]): string {
		let loopString = "# Loop ";
		loopNumbers.forEach((loopNumber) => {
			loopString += `${loopNumber + 1}.`;
		});
		return loopString.slice(0, -1);
	}

	formatVersionHeader(versionNumbers: number[]): string {
		let versionString = "# Version ";
		versionNumbers.forEach((versionNumber) => {
			versionString += `${versionNumber}.`;
		});
		return versionString.slice(0, -1);
	}

	dependencyCompleted(dependency: CannoliObject): void {
		// If the dependency is the source node and all forEach groups being crossed are complete, execute the edge
		if (
			this.getSource().status === CannoliObjectStatus.Complete &&
			// If all forEach type groups being crossed are complete
			this.crossingOutGroups.every(
				(group) =>
					!(this.graph[group] instanceof ForEachGroup) ||
					this.graph[group].status === CannoliObjectStatus.Complete
			)
		) {
			this.execute();
		}
	}
}
