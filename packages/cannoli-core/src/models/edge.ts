import { CannoliObject, CannoliVertex } from "./object";
import { CannoliGroup, RepeatGroup } from "./group";
import {
	CannoliObjectStatus,
	EdgeType,
	VaultModifier,
	VerifiedCannoliCanvasData,
	VerifiedCannoliCanvasEdgeData,
} from "./graph";
import { ChatRole } from "../run";
import {
	GenericCompletionParams,
	GenericCompletionResponse,
} from "../providers";

const chatFormatString = `---
# <u>{{role}}</u>

{{content}}`

export class CannoliEdge extends CannoliObject {
	canvasData: VerifiedCannoliCanvasEdgeData;
	source: string;
	target: string;
	crossingInGroups: string[];
	crossingOutGroups: string[];
	isReflexive: boolean;
	addMessages: boolean;
	vaultModifier: VaultModifier | null;
	content: string | Record<string, string> | null;
	messages: GenericCompletionResponse[] | null;
	versions: {
		header: string | null,
		subHeader: string | null,
	}[] | null;

	constructor(edgeData: VerifiedCannoliCanvasEdgeData, fullCanvasData: VerifiedCannoliCanvasData) {
		super(edgeData, fullCanvasData);
		this.canvasData = edgeData;
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
		this.versions = edgeData.cannoliData.versions
			? edgeData.cannoliData.versions
			: null;

		// Overrwite the addMessages for certain types of edges
		if (
			this.type === EdgeType.Chat ||
			this.type === EdgeType.SystemMessage ||
			this.type === EdgeType.ChatResponse ||
			this.type === EdgeType.ChatConverter
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

	setContent(content: string | Record<string, string> | undefined) {
		this.run.editGraphData(this.id, "content", content);
		this.content = content ?? null;
	}

	setMessages(messages: GenericCompletionResponse[] | undefined) {
		this.run.editGraphData(this.id, "messages", messages);
		this.messages = messages ?? null;
	}

	setVersionHeaders(index: number, header: string, subheader: string) {
		this.run.editGraphData(this.id, "versions", {
			index,
			header,
			subHeader: subheader
		});
		if (this.versions) {
			this.versions[index].header = header;
			this.versions[index].subHeader = subheader;
		}

	}

	load({
		content,
		request,
	}: {
		content?: string | Record<string, string>;
		request?: GenericCompletionParams;
	}): void {
		// If there is a versions array
		if (this.versions) {
			let versionCount = 0;
			for (const group of this.crossingOutGroups) {
				const groupObject = this.graph[group] as CannoliGroup;
				// Get the incoming item edge, if there is one
				const itemEdge = groupObject.incomingEdges.find((edge) => this.graph[edge].type === EdgeType.Item);
				if (itemEdge) {
					// Get the item edge object
					const itemEdgeObject = this.graph[itemEdge] as CannoliEdge;

					// Set the version header to the name of the list edge
					this.setVersionHeaders(versionCount, itemEdgeObject.text, itemEdgeObject.content as string);

					versionCount++;
				}
			}

		}

		this.content =
			content !== null && content !== undefined ? content : null;

		if (this.addMessages) {
			this.setMessages(
				request && request.messages ? request.messages : undefined);
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
			// console.log(
			// 	`Executing edge with loaded content: ${
			// 		this.content
			// 	} and messages:\n${JSON.stringify(this.messages, null, 2)}`
			// );
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
			`--> Edge ${this.id} Text: "${this.text ?? "undefined string"
			}"\n"${this.ensureStringLength(
				this.getSource().text ?? "undefined string",
				15
			)}--->"${this.ensureStringLength(
				this.getTarget().text ?? "undefined string",
				15
			)}"\n${crossingGroupsString}\nisReflexive: ${this.isReflexive
			}\nType: ${this.type}\n` + super.logDetails()
		);
	}

	reset() {
		if (!this.isReflexive) {
			super.reset();
		}
	}
}

export class ChatConverterEdge extends CannoliEdge {
	load({
		content,
		request,
	}: {
		content?: string | Record<string, string>;
		request?: GenericCompletionParams;
	}): void {
		const format = this.run.settings?.chatFormatString?.toString() ?? chatFormatString;
		const messageString = "";
		let messages: GenericCompletionResponse[] = [];

		if (content && format) {
			// Convert content to messages using the format
			messages = this.stringToArray(content as string, format);
		} else {
			throw new Error(
				"Chat converter edge was loaded without a content or messages"
			);
		}

		this.setContent(messageString);
		this.setMessages(messages);
	}

	stringToArray(str: string, format: string): GenericCompletionResponse[] {
		const rolePattern = format
			.replace("{{role}}", "(System|User|Assistant)")
			.replace("{{content}}", "")
			.trim();
		const regex = new RegExp(rolePattern, "g");

		let match;
		let messages: GenericCompletionResponse[] = [];
		let lastIndex = 0;

		let firstMatch = true;

		while ((match = regex.exec(str)) !== null) {
			const [, role] = match;

			// If this is the first match and there's text before it, add that text as a 'user' message
			if (firstMatch && match.index > 0) {
				messages.push({
					role: "user" as const,
					content: str.substring(0, match.index).trim(),
				});
			}
			firstMatch = false;

			const start = regex.lastIndex;
			let end;
			const nextMatch = regex.exec(str);
			if (nextMatch) {
				end = nextMatch.index;
			} else {
				end = str.length;
			}
			regex.lastIndex = start;

			const content = str.substring(start, end).trim();
			const uncapRole = role.charAt(0).toLowerCase() + role.slice(1);

			messages.push({
				role: uncapRole as ChatRole,
				content,
			});

			lastIndex = end;
		}

		if (messages.length === 0) {
			messages.push({
				role: "user" as ChatRole,
				content: str.trim(),
			});
			return messages;
		}

		if (lastIndex < str.length - 1) {
			messages.push({
				role: "user" as ChatRole,
				content: str.substring(lastIndex).trim(),
			});
		}

		if (this.text.length > 0) {
			messages = this.limitMessages(messages);
		}

		return messages;
	}

	limitMessages(
		messages: GenericCompletionResponse[]
	): GenericCompletionResponse[] {
		let isTokenBased = false;
		let originalText = this.text;

		if (originalText.startsWith("#")) {
			isTokenBased = true;
			originalText = originalText.substring(1);
		}

		const limitValue = Number(originalText);

		if (isNaN(limitValue) || limitValue < 0) {
			return messages;
		}

		let outputMessages: GenericCompletionResponse[];

		if (isTokenBased) {
			const maxCharacters = limitValue * 4;
			let totalCharacters = 0;
			let index = 0;

			for (let i = messages.length - 1; i >= 0; i--) {
				const message = messages[i];
				if (message.content) {
					totalCharacters += message.content.length;
				}

				if (totalCharacters > maxCharacters) {
					index = i + 1;
					break;
				}
			}
			outputMessages = messages.slice(index);
		} else {
			outputMessages = messages.slice(-Math.max(limitValue, 1));
		}

		// Safeguard to always include at least one message
		if (outputMessages.length === 0 && messages.length > 0) {
			outputMessages = [messages[messages.length - 1]];
		}

		return outputMessages;
	}
}

export class ChatResponseEdge extends CannoliEdge {
	beginningOfStream = true;

	load({
		content,
		request,
	}: {
		content?: string | Record<string, string>;
		request?: GenericCompletionParams;
	}): void {
		const format = this.run.settings?.chatFormatString?.toString() ?? chatFormatString;

		if (!format) {
			throw new Error(
				"Chat response edge was loaded without a format string"
			);
		}

		if (content && typeof content === "string") {
			if (!this.beginningOfStream) {
				// If the content is the string "END OF STREAM"
				if (content === "END OF STREAM") {
					// Create a user template for the next message
					const userTemplate = format
						.replace("{{role}}", "User")
						.replace("{{content}}", "");

					this.setContent("\n\n" + userTemplate);
				} else {
					this.setContent(content);
				}
			} else {
				const assistantTemplate = format
					.replace("{{role}}", "Assistant")
					.replace("{{content}}", content);

				this.setContent("\n\n" + assistantTemplate);

				this.beginningOfStream = false;
			}

			this.execute();
		}
	}
}

export class SystemMessageEdge extends CannoliEdge {
	load({
		content,
		request,
	}: {
		content?: string | Record<string, string>;
		request?: GenericCompletionParams;
	}): void {
		if (content) {
			this.setMessages([
				{
					role: "system",
					content: content as string,
				},
			]);
		}
	}
}

export class LoggingEdge extends CannoliEdge {
	load({
		content,
		request,
	}: {
		content?: string | Record<string, string>;
		request?: GenericCompletionParams;
	}): void {
		// If content exists, save it as the configString
		let configString = null;

		let messages: GenericCompletionResponse[] = [];

		if (request) {
			configString = this.getConfigString(request);
			messages = request.messages ? request.messages : [];
		} else {
			throw new Error(
				"Logging edge was loaded without a request, this should never happen"
			);
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

		// Append the logs to the content
		if (this.content !== null) {
			this.setContent(`${this.content}\n${logs}`);
		} else {
			this.setContent(logs);
		}
	}

	getConfigString(request: GenericCompletionParams) {
		let configString = "";

		// Loop through all the properties of the request except for messages, and if they aren't undefined add them to the config string formatted nicely
		for (const key in request) {
			if (key !== "messages" && request[key as keyof typeof request]) {
				// If its apiKey, don't log the value
				if (key === "apiKey") {
					continue;
				}

				configString += `${key}: ${request[key as keyof typeof request]
					}\n`;
			}
		}

		return configString;
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
		// TODO
		return [123]

		// // Get the current loop number of any repeat type groups that the edge is crossing out of
		// const forEachVersionNumbers: number[] = [];

		// this.crossingOutGroups.forEach((group) => {
		// 	const groupObject = this.graph[group];
		// 	if (this.groupObject.canvasData.cannoliData.originalObject) {
		// 		forEachVersionNumbers.push(groupObject.currentLoop);
		// 	}
		// });

		// // Reverse the array
		// forEachVersionNumbers.reverse();

		// return forEachVersionNumbers;
	}

	formatInteractionHeaders(messages: GenericCompletionResponse[]): string {
		let formattedString = "";
		messages.forEach((message) => {
			const role = message.role || "user";
			let content = message.content;
			if ("function_call" in message && message.function_call) {
				content = `Function Call: **${message.function_call.name}**\nArguments:\n\`\`\`json\n${message.function_call.arguments}\n\`\`\``;
			}
			formattedString += `#### <u>${role.charAt(0).toUpperCase() + role.slice(1)
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
					this.graph[group].status === CannoliObjectStatus.Complete
			)
		) {
			this.execute();
		}
	}
}
