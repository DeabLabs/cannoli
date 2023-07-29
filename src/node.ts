import { CannoliGraph } from "./cannoli";
import { CannoliEdge, Variable } from "./edge";
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

		// Put variables from all incoming edges into an array. Edges have the property "variables" which is an array of variables
		const incomingVariables = this.incomingEdges.flatMap(
			(edge) => edge.variables
		);

		// Disallow multiple non-choiceOption variables with the same name
		const variableNames = incomingVariables
			.filter((v) => v.type !== "choiceOption")
			.map((v) => v.name);
		const duplicateVariableNames = variableNames.filter(
			(name, index) => variableNames.indexOf(name) !== index
		);
		if (duplicateVariableNames.length > 0) {
			throw new Error(
				`Invalid Cannoli layout: Node with id ${
					this.id
				} has multiple incoming variables with the same name: ${duplicateVariableNames.join(
					", "
				)}`
			);
		}

		// Do type-specific validation by calling the validate function for the type
		switch (this.type) {
			case "call":
				this.validateCall(incomingVariables);
				break;
			case "content":
				this.validateContent(incomingVariables);
				break;
			case "floating":
				this.validateFloating();
				break;
			default:
				throw new Error(`Node type ${this.type} not recognized`);
		}
	}

	validateCall(incomingVariables: Variable[]) {
		// Disallow incoming edges of subtype write
		if (this.incomingEdges.some((edge) => edge.subtype === "write")) {
			throw new Error(
				`Invalid Cannoli layout: Node with id ${this.id} has incoming edges of subtype "write"`
			);
		}

		// Disallow incoming edges of subtype logging
		if (this.incomingEdges.some((edge) => edge.subtype === "logging")) {
			throw new Error(
				`Invalid Cannoli layout: Node with id ${this.id} has incoming edges of subtype "logging"`
			);
		}

		// Disallow multiple incoming edges of subtype continueChat or have the continueChat tag
		if (
			this.incomingEdges.filter(
				(edge) =>
					edge.subtype === "continueChat" ||
					edge.tags.includes("continueChat")
			).length > 1
		) {
			throw new Error(
				`Invalid Cannoli layout: Node with id ${this.id} has multiple incoming edges of subtype "continueChat"`
			);
		}

		checkVariablesInContent(
			this.content,
			incomingVariables,
			this.cannoli.nodes,
			this.cannoli
		);

		switch (this.subtype) {
			case "list": {
				// If there's any outgoing list type edges with subtype listGroup, they must all have the same variable name
				const listGroupEdges = this.outgoingEdges.filter(
					(edge) =>
						edge.type === "list" && edge.subtype === "listGroup"
				);
				if (listGroupEdges.length > 0) {
					const variableNames = listGroupEdges.map(
						(edge) => edge.label
					);
					const uniqueVariableNames = new Set(variableNames);
					if (uniqueVariableNames.size > 1) {
						throw new Error(
							`Invalid Cannoli layout: Node with id ${
								this.id
							} has outgoing listGroup edges with different variable names: ${Array.from(
								uniqueVariableNames
							).join(", ")}`
						);
					}
				}

				// If there are any outgoing list type edges with subtype list, there must be at least two
				const listEdges = this.outgoingEdges.filter(
					(edge) => edge.type === "list" && edge.subtype === "list"
				);
				if (listEdges.length > 0 && listEdges.length < 2) {
					throw new Error(
						`Invalid Cannoli layout: Node with id ${this.id} has outgoing list edges with subtype list, but there are less than two`
					);
				}

				break;
			}
			case "select": {
				// There must be no outgoing choice type edges
				if (this.outgoingEdges.some((edge) => edge.type === "choice")) {
					throw new Error(
						`Invalid Cannoli layout: Node with id ${this.id} has outgoing choice edges`
					);
				}

				// There must be at least one outgoing list type edge with subtype select
				const selectEdges = this.outgoingEdges.filter(
					(edge) => edge.type === "list" && edge.subtype === "select"
				);
				if (selectEdges.length === 0) {
					throw new Error(
						`Invalid Cannoli layout: Node with id ${this.id} has no outgoing list edges with subtype select`
					);
				}

				// If there are any outgoing list type edges with subtype select, they must all have the same variable name
				if (selectEdges.length > 0) {
					const variableNames = selectEdges.map((edge) => edge.label);
					const duplicateVariableNames = variableNames.filter(
						(name, index) => variableNames.indexOf(name) !== index
					);
					if (duplicateVariableNames.length > 0) {
						throw new Error(
							`Invalid Cannoli layout: Node with id ${
								this.id
							} has multiple outgoing select edges with different variable names: ${duplicateVariableNames.join(
								", "
							)}`
						);
					}
				}
				break;
			}
			case "choice": {
				// There must be no outgoing list type edges
				if (this.outgoingEdges.some((edge) => edge.type === "list")) {
					throw new Error(
						`Invalid Cannoli layout: Node with id ${this.id} has outgoing list edges`
					);
				}

				// There must be at least one outgoing choice type edge
				const choiceEdges = this.outgoingEdges.filter(
					(edge) => edge.type === "choice"
				);
				if (choiceEdges.length === 0) {
					throw new Error(
						`Invalid Cannoli layout: Node with id ${this.id} has no outgoing choice edges`
					);
				}

				break;
			}
			case "normal": {
				// There must be no outgoing list or choice type edges
				if (
					this.outgoingEdges.some(
						(edge) => edge.type === "list" || edge.type === "choice"
					)
				) {
					throw new Error(
						`Invalid Cannoli layout: Node with id ${this.id} has outgoing list or choice edges`
					);
				}

				break;
			}

			default:
				throw new Error(
					`Call node subtype ${this.subtype} not recognized`
				);
		}
	}

	validateContent(incomingVariables: Variable[]) {
		switch (this.subtype) {
			case "reference":
				// If the content is a note reference (starts with [[ and ends with ]]), check if the note exists
				if (
					this.content.startsWith("[[") &&
					this.content.endsWith("]]")
				) {
					// If it has an incoming list edge with the subtype listGroup, error
					if (
						this.incomingEdges.some(
							(edge) => edge.subtype === "listGroup"
						)
					) {
						throw new Error(
							`Reference node ${this.id} cannot have an incoming list edge with subtype listGroup`
						);
					}

					const noteName = this.content.slice(2, -2);
					const note = this.cannoli.vault
						.getMarkdownFiles()
						.find((file) => file.basename === noteName);
					if (!note) {
						throw new Error(`Note ${noteName} not found`);
					}
				}
				// If the content is a floating node reference (starts with [ and ends with ]), check if the floating node exists
				else if (
					this.content.startsWith("[") &&
					this.content.endsWith("]")
				) {
					const floatingNodeId = this.content.slice(1, -1);
					const floatingNode = this.cannoli.nodes[floatingNodeId];
					if (!floatingNode) {
						throw new Error(
							`Floating node ${floatingNodeId} not found`
						);
					}
				}
				// Reference nodes must have a valid reference
				else {
					throw new Error(
						`Content of reference node ${this.id} is not a valid reference`
					);
				}
				break;

			case "vault": {
				// Check variables array for valid variable combinations
				const newLinkCount = incomingVariables.filter(
					(v) => v.type === "newLink"
				).length;
				const newPathCount = incomingVariables.filter(
					(v) => v.type === "newPath"
				).length;
				const existingLinkCount = incomingVariables.filter(
					(v) => v.type === "existingLink"
				).length;
				const existingPathCount = incomingVariables.filter(
					(v) => v.type === "existingPath"
				).length;

				const totalLinkCount = newLinkCount + existingLinkCount;
				const totalPathCount = newPathCount + existingPathCount;

				if (totalLinkCount > 1) {
					throw new Error(
						"Invalid combination: Multiple link variables are not allowed in a vault node"
					);
				}

				if (totalPathCount > 1) {
					throw new Error(
						"Invalid combination: Multiple path variables are not allowed in a vault node"
					);
				}

				if (existingPathCount > 0 && totalLinkCount === 0) {
					throw new Error(
						"Invalid combination: Existing path variables are not allowed without any link variables in a vault node"
					);
				}

				// Disallow multiple variables of type "regular"
				if (
					incomingVariables.filter((v) => v.type === "regular")
						.length > 1
				) {
					throw new Error(
						"Invalid combination: Multiple regular variables are not allowed in a vault node"
					);
				}

				const regularVariableCount = incomingVariables.filter(
					(v) => v.type === "regular"
				).length;
				const writeEdgeCount = this.outgoingEdges.filter(
					(e) => e.subtype === "write"
				).length;
				const loggingEdgeCount = this.outgoingEdges.filter(
					(e) => e.subtype === "logging"
				).length;

				const totalContentSources =
					regularVariableCount + writeEdgeCount + loggingEdgeCount;

				if (totalContentSources > 1) {
					throw new Error(
						"Invalid combination: Multiple content sources are not allowed in a vault node"
					);
				}

				if (
					totalContentSources === 1 &&
					newPathCount === 1 &&
					totalLinkCount === 0
				) {
					throw new Error(
						"Invalid combination: A content source is specified, but there is no note to write to in a vault node"
					);
				}
				break;
			}

			case "formatter": {
				checkVariablesInContent(
					this.content,
					incomingVariables,
					this.cannoli.nodes,
					this.cannoli
				);

				// Disallow incoming edges of type "blank"
				if (this.incomingEdges.some((edge) => edge.type === "blank")) {
					throw new Error(
						`Invalid Cannoli layout: Node with id ${this.id} has incoming edges of type "blank"`
					);
				}

				// Disallow incoming edges of subtype "logging"
				if (
					this.incomingEdges.some(
						(edge) => edge.subtype === "logging"
					)
				) {
					throw new Error(
						`Invalid Cannoli layout: Node with id ${this.id} has incoming edges of subtype "logging"`
					);
				}

				break;
			}

			case "normal": {
				// Disallow multiple incoming variables that aren't of type "choiceOption"
				if (
					incomingVariables.filter((v) => v.type !== "choiceOption")
						.length > 1
				) {
					throw new Error(
						"Invalid combination: Multiple incoming variables that aren't of type choiceOption are not allowed in a normal node"
					);
				}

				// Disallow multiple incoming edges of type "blank" or subtype "logging"
				if (
					this.incomingEdges.filter(
						(e) => e.type === "blank" || e.subtype === "logging"
					).length > 1
				) {
					throw new Error(
						"Invalid combination: Multiple incoming edges of type blank or subtype logging are not allowed in a normal content node"
					);
				}
			}
		}
	}

	validateFloating() {
		// The first line of a floating node's content must have the format: [variable name]
		const firstLine = this.content.split("\n")[0];
		if (!firstLine.startsWith("[") || !firstLine.endsWith("]")) {
			throw new Error(
				`Floating node ${this.id} has invalid content: ${this.content}`
			);
		}
	}

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

export function checkVariablesInContent(
	content: string,
	variables: Variable[],
	nodes: Record<string, CannoliNode>,
	cannoli: CannoliGraph,
	suppressErrors = false // new parameter
): number | void {
	const regex = /\{\[\[(.+?)\]\]\}|\{\[(.+?)\]\}|{{(.+?)}}|{(.+?)}/g;

	let match: RegExpExecArray | null;
	const variablesNotFound = [];

	let validReferencesCount = 0; // new variable

	while ((match = regex.exec(content)) !== null) {
		if (match[1]) {
			// Note reference
			const noteName = match[1];
			const note = cannoli.vault
				.getMarkdownFiles()
				.find((file) => file.basename === noteName);
			if (!note) {
				if (suppressErrors) {
					variablesNotFound.push(noteName);
					continue;
				} else {
					throw new Error(`Note ${noteName} not found`);
				}
			}
			validReferencesCount++;
		} else if (match[2]) {
			// Floating variable reference
			const varName = match[2];
			const floatingNodes = Object.values(nodes).filter(
				(node) => node.type === "floating"
			);
			const floatingNode = floatingNodes.find((node) =>
				node.content.startsWith(`[${varName}]`)
			);
			if (!floatingNode) {
				if (suppressErrors) {
					variablesNotFound.push(varName);
					continue;
				} else {
					throw new Error(`Floating variable ${varName} not found`);
				}
			}
			validReferencesCount++;
		} else if (match[3] || match[4]) {
			// Regular variable
			const variableName = match[3] || match[4];
			const variableExists = variables.some(
				(variable) =>
					variable.name === variableName &&
					variable.type !== "choiceOption" &&
					variable.type !== "config"
			);

			if (variableExists) {
				validReferencesCount++; // Increment the count for valid reference
			} else if (!suppressErrors) {
				variablesNotFound.push(variableName);
				throw new Error(
					`Invalid Cannoli layout: Node has missing variables in incoming edges: ${variableName}`
				);
			}
		}
	}

	if (suppressErrors) {
		return validReferencesCount; // Return the count for valid references if suppressErrors is true
	} else if (variablesNotFound.length > 0) {
		throw new Error(
			`Invalid Cannoli layout: Node has missing variables in incoming edges: ${variablesNotFound.join(
				", "
			)}`
		);
	}
}
