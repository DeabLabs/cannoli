import { CannoliGraph } from "./cannoli";
import { CannoliEdge } from "./edge";
import { CannoliGroup } from "./group";

// Node Types
export type NodeType = "call" | "content" | "floating";

export type CallSubtype = "list" | "select" | "choice" | "normal";

export type ContentSubtype = "reference" | "vault" | "formatter" | "normal";

export type FloatingSubtype = "";

export class CannoliNode {
	id: string;
	content: string;
	status: "pending" | "processing" | "complete" | "rejected";
	type: NodeType;
	subtype: CallSubtype | ContentSubtype | FloatingSubtype;
	outgoingEdges: CannoliEdge[];
	incomingEdges: CannoliEdge[];
	group: CannoliGroup;
	cannoli: CannoliGraph;
	copies: CannoliNode[];

	constructor({
		id,
		content,
		type,
		outgoingEdges,
		incomingEdges,
		cannoli,
	}: {
		id: string;
		content: string;
		type: NodeType;
		outgoingEdges: CannoliEdge[];
		incomingEdges: CannoliEdge[];
		cannoli: CannoliGraph;
	}) {
		this.id = id;
		this.content = content;
		this.type = type;
		this.outgoingEdges = outgoingEdges;
		this.incomingEdges = incomingEdges;
		this.cannoli = cannoli;

		this.status = "pending";
	}

	logNodeDetails() {
		const contentFormat = `"${this.content.substring(0, 20)}..."`;
		const outgoingEdgesFormat =
			this.outgoingEdges.length > 0
				? this.outgoingEdges
						.map(
							(edge) =>
								`\n\tOutgoing Edge: "${
									edge.label
										? edge.label.substring(0, 20)
										: "No Label"
								}..."`
						)
						.join("")
				: "\n\tOutgoing Edges: None";
		const incomingEdgesFormat =
			this.incomingEdges.length > 0
				? this.incomingEdges
						.map(
							(edge) =>
								`\n\tIncoming Edge: "${
									edge.label
										? edge.label.substring(0, 20)
										: "No Label"
								}..."`
						)
						.join("")
				: "\n\tIncoming Edges: None";
		const groupFormat = this.group
			? `\n\tGroup: "${
					this.group.label
						? this.group.label.substring(0, 20)
						: "No Label"
					// eslint-disable-next-line no-mixed-spaces-and-tabs
			  }..."`
			: "\n\tGroup: None";

		const logString = `Node: ${contentFormat} (Type: ${this.type}, Subtype: ${this.subtype}),${outgoingEdgesFormat},${incomingEdgesFormat},${groupFormat}`;

		console.log(logString);
	}

	setGroup(group: CannoliGroup) {
		this.group = group;
	}

	validate() {
		// Do global validation first

		// Do type-specific validation by calling the validate function for the type
		switch (this.type) {
			case "call":
				this.validateCall();
				break;
			case "content":
				this.validateContent();
				break;
			case "floating":
				this.validateFloating();
				break;
			default:
				throw new Error(`Node type ${this.type} not recognized`);
		}
	}

	validateCall() {}

	validateContent() {}

	validateFloating() {}

	// async process(nodeCompleted: () => void) {
	// 	if (this.type === "content") {
	// 		// Node is a content node.

	// 		// Initialize debug variables
	// 		let wroteToPage = false;
	// 		let pageName = "";
	// 		let writtenContent = "";
	// 		let pageCreated = false;

	// 		// If it has an incoming variable edge, replace the content with the label of the variable edge, and write it to the page with the same name as the label if it exists, and create it if it doesn't.
	// 		if (this.incomingEdges.some((edge) => edge.type === "variable")) {
	// 			// If the edge's payload is null, throw an error
	// 			if (this.incomingEdges.some((edge) => edge.payload === null)) {
	// 				// The error should look like: "No existing page could be parsed for the edge with id: 123"
	// 				throw new Error(
	// 					`No existing page could be parsed for the edge with id: ${
	// 						this.incomingEdges.find(
	// 							(edge) => edge.payload === null
	// 						)?.id
	// 					}`
	// 				);
	// 			}

	// 			let varValue = this.incomingEdges
	// 				.find((edge) => edge.type === "variable")
	// 				?.getPayload() as string;

	// 			// If the varValue is not surrounded by double braces, surround it with double braces
	// 			if (varValue) {
	// 				if (
	// 					!varValue.startsWith("[[") &&
	// 					!varValue.endsWith("]]")
	// 				) {
	// 					varValue = "[[" + varValue + "]]";
	// 				}
	// 			} else {
	// 				throw new Error(
	// 					`Variable name not found for edge ${
	// 						this.incomingEdges.find(
	// 							(edge) => edge.type === "variable"
	// 						)?.id
	// 					}`
	// 				);
	// 			}

	// 			// Set pageContent variable to the payload of the incoming blank edge
	// 			let pageContent = this.incomingEdges
	// 				.find((edge) => edge.type === "blank")
	// 				?.getPayload() as string;

	// 			// If the first line of page content is "# " followed by the page name, regardless of case, remove the first line, because obsidian will add it automatically
	// 			const pageContentLines = pageContent.split("\n");
	// 			if (
	// 				pageContentLines[0].toLowerCase() ===
	// 				`# ${varValue.toLowerCase()}`
	// 			) {
	// 				pageContentLines.shift();
	// 			}

	// 			pageContent = pageContentLines.join("\n");

	// 			// If the varValue without double-braces corresponds to a page (accounting for case), write the pageContent to the page
	// 			pageName = varValue.slice(2, -2);
	// 			const page = this.vault
	// 				.getMarkdownFiles()
	// 				.find(
	// 					(file) =>
	// 						file.basename.toLowerCase() ===
	// 						pageName.toLowerCase()
	// 				);

	// 			if (page) {
	// 				console.log("Page exists, editing");
	// 				await this.vault.modify(page, pageContent);
	// 				wroteToPage = true;
	// 				writtenContent = pageContent;
	// 			} else {
	// 				console.log("Page doesn't exist, creating");
	// 				await this.vault.create(pageName + ".md", pageContent);
	// 				pageCreated = true;
	// 				wroteToPage = true;
	// 				writtenContent = pageContent;
	// 			}

	// 			this.content = varValue;
	// 			await this.changeContent(this.content);
	// 		}

	// 		// If it has an incoming blank edge
	// 		else if (this.incomingEdges.some((edge) => edge.type === "blank")) {
	// 			// If the content of the node is a markdown page reference, write the payload of the blank edge to the page with the same name as the reference if it exists, and error if it doesn't
	// 			if (
	// 				this.content.startsWith("[[") &&
	// 				this.content.endsWith("]]")
	// 			) {
	// 				pageName = this.content.slice(2, -2);
	// 				const page = this.vault
	// 					.getMarkdownFiles()
	// 					.find(
	// 						(file) =>
	// 							file.basename.toLowerCase() ===
	// 							pageName.toLowerCase()
	// 					);

	// 				if (page) {
	// 					console.log("Page exists, editing");
	// 					await this.vault.modify(
	// 						page,
	// 						this.incomingEdges
	// 							.find((edge) => edge.type === "blank")
	// 							?.getPayload() as string
	// 					);
	// 					wroteToPage = true;
	// 					writtenContent = this.incomingEdges
	// 						.find((edge) => edge.type === "blank")
	// 						?.getPayload() as string;
	// 				} else {
	// 					throw new Error(
	// 						`The page: "${pageName}" doesn't exist`
	// 					);
	// 				}
	// 			} else {
	// 				// If the content isn't a markdown page reference, set the content of the node to the payload of the blank edge
	// 				this.content = this.incomingEdges
	// 					.find((edge) => edge.type === "blank")
	// 					?.getPayload() as string;
	// 				await this.changeContent(this.content);
	// 				writtenContent = this.content;
	// 			}
	// 		}

	// 		// If it has an incoming debug edge, set the content of the node to the payload of the debug edge
	// 		else if (this.incomingEdges.some((edge) => edge.type === "debug")) {
	// 			this.content = this.incomingEdges
	// 				.find((edge) => edge.type === "debug")
	// 				?.getPayload() as string;
	// 			await this.changeContent(this.content);
	// 			writtenContent = this.content;
	// 		}

	// 		// Set the payload of all outgoing variable and blank edges to the content of the node
	// 		for (const edge of this.outgoingEdges.filter(
	// 			(edge) => edge.type === "variable" || edge.type === "blank"
	// 		)) {
	// 			edge.setPayload(this.content);
	// 		}

	// 		// Set the payload of all outgoing debug edges to a markdown string explaining what happened.
	// 		// Say if the content was written to the node or a page, and show the content. If it was written to a page, say the name and mention if it was created.
	// 		for (const edge of this.outgoingEdges.filter(
	// 			(edge) => edge.type === "debug"
	// 		)) {
	// 			let debugContent = "";
	// 			if (wroteToPage) {
	// 				if (pageCreated) {
	// 					debugContent = `[[${pageName}]] was created:`;
	// 				} else {
	// 					debugContent = `[[${pageName}]] was edited:`;
	// 				}
	// 				debugContent += `\n\n${writtenContent}`;
	// 			} else {
	// 				debugContent = `This was written to the content node:\n\n${writtenContent}`;
	// 			}
	// 			edge.setPayload(debugContent);
	// 		}
	// 	} else if (this.type === "call") {
	// 		// Node is a call node, build its message
	// 		let messageContent = this.content;

	// 		// Process incoming variable and read type edges
	// 		for (const edge of this.incomingEdges.filter(
	// 			(edge) => edge.type === "variable"
	// 		)) {
	// 			const varName = edge.label;
	// 			const varValue = edge.getPayload() as string;

	// 			if (!varName) {
	// 				throw new Error(
	// 					`Variable name not found for edge ${edge.id}`
	// 				);
	// 			}

	// 			if (!varValue) {
	// 				throw new Error(`Variable ${varName} has not been set`);
	// 			}
	// 			messageContent = await this.processVariable(
	// 				varName,
	// 				varValue,
	// 				messageContent,
	// 				true
	// 			);
	// 		}

	// 		// Process global variables
	// 		const globalVars: Record<string, string> = {};
	// 		for (const node of Object.values(this.nodes)) {
	// 			if (node.type === "globalVar") {
	// 				const [varName, varValue] = node.content.split("\n");
	// 				globalVars[varName.slice(1, -1)] = varValue;
	// 			}
	// 		}

	// 		for (const [varName, varValue] of Object.entries(globalVars)) {
	// 			messageContent = await this.processVariable(
	// 				varName,
	// 				varValue,
	// 				messageContent,
	// 				false
	// 			);
	// 		}

	// 		// Replace static page references with the content of the page
	// 		const pageNameMatches =
	// 			messageContent.match(/{\[\[(.*?)\]\]}/g) || [];
	// 		for (const match of pageNameMatches) {
	// 			const pageName = match.slice(3, -3); // Remove {[[ and ]]}

	// 			const formattedPage = await this.getPageContent(pageName);
	// 			if (formattedPage) {
	// 				messageContent = messageContent.replace(
	// 					match,
	// 					formattedPage
	// 				);
	// 			} else {
	// 				messageContent = messageContent.replace(
	// 					match,
	// 					`The page: "${pageName}" doesn't exist`
	// 				);
	// 			}
	// 		}

	// 		let messages: ChatCompletionRequestMessage[] = [];

	// 		// For all incoming blank edges.
	// 		for (const edge of this.incomingEdges.filter(
	// 			(edge) => edge.type === "blank"
	// 		)) {
	// 			// If the edge is from a content node, the payload is a string. Turn it into a system chatMessage and push it to the messages array
	// 			if (edge.getSource(this.nodes).type === "content") {
	// 				messages.push({
	// 					role: "system",
	// 					content: edge.getPayload() as string,
	// 				});
	// 			}
	// 			// If the edge is from a call node, the payload is an array of messages. Append them to the messages array
	// 			else if (edge.getSource(this.nodes).type === "call") {
	// 				messages =
	// 					edge.getPayload() as ChatCompletionRequestMessage[];
	// 			}
	// 		}

	// 		// Append the current message to the messages array
	// 		messages.push({ role: "user", content: messageContent });

	// 		// Send a request to OpenAI
	// 		const chatResponse = await llmCall({
	// 			messages,
	// 			openai: this.openai,
	// 			verbose: true,
	// 		});

	// 		if (!chatResponse) {
	// 			throw new Error("Chat response is undefined");
	// 		}

	// 		if (chatResponse.content === undefined) {
	// 			throw new Error("Chat response content is undefined");
	// 		}

	// 		// Load outgoing edges

	// 		// For all outgoing variable edges
	// 		for (const edge of this.outgoingEdges.filter(
	// 			(edge) => edge.type === "variable"
	// 		)) {
	// 			// If the variable label is surrounded by double braces, call ensurePageExists on the payload of the variable edge
	// 			if (edge.label?.startsWith("[[") && edge.label.endsWith("]]")) {
	// 				const maybePageName = chatResponse.content;
	// 				if (!maybePageName) {
	// 					throw new Error("Chat response content is undefined");
	// 				}
	// 				const realPageName = await ensurePageExists(
	// 					maybePageName,
	// 					this.vault
	// 				);
	// 				edge.setPayload(realPageName);
	// 			} else {
	// 				// If the variable label is not surrounded by double braces, set the payload to the content of the response message
	// 				edge.setPayload(chatResponse.content);
	// 			}
	// 		}

	// 		// For all outgoing blank type edges
	// 		for (const edge of this.outgoingEdges.filter(
	// 			(edge) => edge.type === "blank"
	// 		)) {
	// 			// If the edge is to a call node
	// 			if (edge.getTarget(this.nodes).type === "call") {
	// 				// If the target node is within the same group, set the payload to the whole messages array with the response message appended
	// 				const payloadMessages = messages.slice();
	// 				payloadMessages.push(chatResponse);
	// 				edge.setPayload(payloadMessages);
	// 			}
	// 			// If the edge is to a content node, set the payload to the response message content
	// 			else if (edge.getTarget(this.nodes).type === "content") {
	// 				edge.setPayload(chatResponse.content);
	// 			}
	// 		}

	// 		// For all outgoing debug type edges, set the payload to a markdown string containing the prompt messages and the response message formatted nicely
	// 		for (const edge of this.outgoingEdges.filter(
	// 			(edge) => edge.type === "debug"
	// 		)) {
	// 			const allMessages = messages
	// 				.map(
	// 					(m) =>
	// 						`### ${
	// 							m.role === "user" ? "USER" : "ASSISTANT"
	// 						}:\n${m.content}`
	// 				)
	// 				.join("\n\n");
	// 			const inputContent = `# <u>PROMPT</u>\n${allMessages}`;
	// 			const outputContent = `# <u>RESPONSE</u>\n${chatResponse.content}`;
	// 			const debugContent = `${inputContent}\n\n${outputContent}`;
	// 			edge.setPayload(debugContent);
	// 		}

	// 		await this.showCompleted();
	// 	}

	// 	this.status = "complete";
	// 	nodeCompleted();

	// 	for (const edge of this.outgoingEdges) {
	// 		await edge.getTarget(this.nodes).attemptProcess(nodeCompleted);
	// 	}
	// }

	// // Process the node if all its dependencies are complete
	// async attemptProcess(nodeCompleted: () => void) {
	// 	if (this.allDependenciesComplete()) {
	// 		// If the node is not a call node, await its process function
	// 		if (this.type !== "call") {
	// 			await this.process(nodeCompleted);
	// 		}
	// 		// If the node is a call node, show that it is processing and don't await its process function
	// 		else {
	// 			await this.showProcessing();
	// 			this.process(nodeCompleted);
	// 		}
	// 	}
	// }

	// Check if the node has all its dependencies complete
	allDependenciesComplete(): boolean {
		// Check if sources of all incoming edges have status "complete"
		return this.incomingEdges.every(
			(edge) => edge.source.status === "complete"
		);
	}

	// // Helper function to get a page by its name and return its content
	// async getPageContent(pageName: string) {
	// 	// First, attempt to find the page with the original casing
	// 	let page = this.vault
	// 		.getMarkdownFiles()
	// 		.find((file) => file.basename === pageName);

	// 	// If the page isn't found, try again with all-lowercase version
	// 	if (!page) {
	// 		page = this.vault
	// 			.getMarkdownFiles()
	// 			.find(
	// 				(file) =>
	// 					file.basename.toLowerCase() === pageName.toLowerCase()
	// 			);
	// 	}

	// 	if (page) {
	// 		const pageContent = await this.vault.read(page);
	// 		const renderedPage = "# " + page.basename + "\n" + pageContent; // Use the actual page name here to maintain original casing
	// 		return renderedPage;
	// 	}
	// 	return null;
	// }

	// async processVariable(
	// 	varName: string,
	// 	varValue: string,
	// 	messageContent: string,
	// 	isRequired: boolean
	// ) {
	// 	// Check if the variable name is within braces
	// 	const varPattern = new RegExp(`{${varName}}`, "g");
	// 	const isVarNamePresent = varPattern.test(messageContent);

	// 	if (isVarNamePresent) {
	// 		messageContent = messageContent.replace(varPattern, varValue);
	// 	}

	// 	// Check for variable names within double braces
	// 	const varDoubleBracePattern = new RegExp(`{\\[${varName}\\]}`, "g");
	// 	const isDoubleBraceVarNamePresent =
	// 		varDoubleBracePattern.test(messageContent);

	// 	if (isDoubleBraceVarNamePresent) {
	// 		const pageName =
	// 			varValue.startsWith("[[") && varValue.endsWith("]]")
	// 				? varValue.slice(2, -2)
	// 				: varValue;
	// 		const pageContent = await this.getPageContent(pageName);

	// 		if (pageContent) {
	// 			messageContent = messageContent.replace(
	// 				varDoubleBracePattern,
	// 				pageContent
	// 			);
	// 		} else {
	// 			messageContent = messageContent.replace(
	// 				varDoubleBracePattern,
	// 				`The page: "${pageName}" doesn't exist`
	// 			);
	// 		}
	// 	} else if (isRequired && !isVarNamePresent) {
	// 		throw new Error(
	// 			`Content does not include an instance of variable ${varName}`
	// 		);
	// 	}

	// 	return messageContent;
	// }

	// // Set the status of the node to complete, change its color to green, and call attemptProcess on target nodes of all outgoing edges
	// async showCompleted() {
	// 	this.status = "complete";
	// 	await this.changeColor("4");
	// }

	// // Set the status of the node to rejected, change its color to "0", and call reject on target nodes of all outgoing edges
	// async rejected() {
	// 	this.status = "rejected";
	// 	await this.changeColor("0");
	// 	for (const edge of this.outgoingEdges) {
	// 		await edge.getTarget(this.nodes).rejected();
	// 	}
	// }

	// // Set the status of the node to processing, change its color to yellow
	// async showProcessing() {
	// 	this.status = "processing";
	// 	await this.changeColor("3");
	// }

	// // Change the color of the node
	// async changeColor(color: string) {
	// 	const canvasData = JSON.parse(
	// 		await this.vault.read(this.canvasFile)
	// 	) as CanvasData;

	// 	const node = canvasData.nodes.find((node) => node.id === this.id);
	// 	if (node !== undefined) {
	// 		node.color = color;
	// 	} else {
	// 		throw new Error(`Node with id ${this.id} not found`);
	// 	}

	// 	await this.vault.modify(this.canvasFile, JSON.stringify(canvasData));
	// }

	// // Change the content of the node
	// async changeContent(content: string) {
	// 	console.log("Changing content of node " + this.id + " to " + content);
	// 	const canvasData = JSON.parse(
	// 		await this.vault.read(this.canvasFile)
	// 	) as CanvasData;

	// 	const node = canvasData.nodes.find((node) => node.id === this.id);
	// 	if (node !== undefined) {
	// 		node.text = content;
	// 	} else {
	// 		throw new Error(`Node with id ${this.id} not found`);
	// 	}

	// 	await this.vault.modify(this.canvasFile, JSON.stringify(canvasData));
	// }
}
