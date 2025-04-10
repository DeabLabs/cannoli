import { CannoliObject } from "src/graph/CannoliObject";
import { CannoliObjectStatus } from "src/graph";
import {
	GenericCompletionParams,
	GenericCompletionResponse,
} from "src/providers";
import { CannoliEdge } from "../CannoliEdge";
import { CannoliGroup } from "../vertices/CannoliGroup";
import { RepeatGroup } from "../vertices/groups/RepeatGroup";

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
				"Logging edge was loaded without a request, this should never happen",
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

		// Extract imageReferences separately
		const imageReferences = request.imageReferences;

		// Loop through all the properties of the request except for messages and imageReferences
		for (const key in request) {
			if (
				key !== "messages" &&
				key !== "imageReferences" &&
				request[key as keyof typeof request]
			) {
				// If its apiKey, don't log the value
				if (key === "apiKey") {
					continue;
				}

				configString += `${key}: ${request[key as keyof typeof request]}\n`;
			}
		}

		// Check for imageReferences and log the size of the array if it has elements
		if (Array.isArray(imageReferences) && imageReferences.length > 0) {
			configString += `images: ${imageReferences.length}\n`;
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
		// Get the current loop number of any repeat type groups that the edge is crossing out of
		const forEachVersionNumbers: number[] = [];

		this.crossingOutGroups.forEach((group) => {
			const groupObject = this.graph[group] as CannoliGroup;
			if (groupObject.originalObject) {
				forEachVersionNumbers.push(groupObject.currentLoop);
			}
		});

		// Reverse the array
		forEachVersionNumbers.reverse();

		return forEachVersionNumbers;
	}

	formatInteractionHeaders(messages: GenericCompletionResponse[]): string {
		let formattedString = "";
		messages.forEach((message) => {
			const role = message.role || "user";
			let content = message.content;
			if ("function_call" in message && message.function_call) {
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
		if (this.getSource().status === CannoliObjectStatus.Complete) {
			this.execute();
		}
	}
}
