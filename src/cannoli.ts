import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { ErrorModal } from "main";
import { Vault, TFile } from "obsidian";
import { CanvasData } from "obsidian/canvas.d";

export async function startCannoli(
	canvasFile: TFile,
	apiKey: string,
	vault: Vault
) {
	const configuration = new Configuration({ apiKey: apiKey });
	delete configuration.baseOptions.headers["User-Agent"];

	// Create an instance of OpenAI
	const openai = new OpenAIApi(configuration);

	// Read the content of the file
	const fileContent = await vault.read(canvasFile);

	const canvasData = JSON.parse(fileContent) as CanvasData;

	console.log(canvasData);

	let nodes: Record<string, CannoliNode>;

	try {
		nodes = await processCanvas(canvasData, vault, canvasFile, openai);

		// Rest of the logic goes here with the processed and validated nodes and groups
	} catch (error) {
		new ErrorModal(
			this.app,
			"Error processing canvas: " + error.message
		).open();
		return;
	}

	// Run the cannoli
	await runCannoli(nodes);
}

async function runCannoli(nodes: Record<string, CannoliNode>) {
	const nodeKeys = Object.keys(nodes);

	// Change all call nodes to color 0
	for (const key of nodeKeys) {
		if (nodes[key].type === "call") {
			await nodes[key].changeColor("0");
		}
	}

	// Create nodeCompleted callback, which will be called when a node is completed, and checks if all nodes are complete
	const nodeCompleted = () => {
		// Check if all nodes are complete
		if (nodeKeys.every((key) => nodes[key].status === "complete")) {
			console.log("All nodes complete");
			return;
		}
	};

	// Attempt to process all nodes with no incoming edges and at least one outgoing edge
	for (const key of nodeKeys) {
		if (
			nodes[key].incomingEdges.length === 0 &&
			nodes[key].outgoingEdges.length > 0
		) {
			await nodes[key].attemptProcess(nodeCompleted);
		}
	}
}

// Top-level function to process and validate the canvas data
async function processCanvas(
	canvasData: CanvasData,
	vault: Vault,
	canvasFile: TFile,
	openai: OpenAIApi
): Promise<Record<string, CannoliNode>> {
	// Process edges
	const edges = processEdges(canvasData);
	// Log out the edges with their properties, formatted nicely. Only using one log statement per edge to avoid cluttering the console
	console.log("Edges:");
	for (const edge of Object.values(edges)) {
		console.log(`
        Edge ${edge.id}
        Source: ${edge.sourceId}
        Target: ${edge.targetId}
        Label: ${edge.label}
        Type: ${edge.type}
        `);
	}

	// Process nodes
	const nodes = await processNodes(
		canvasData,
		edges,
		vault,
		canvasFile,
		openai
	);
	// Log out the properties of the nodes, formatted nicely
	console.log("Nodes:");
	for (const node of Object.values(nodes)) {
		console.log(`
        Node ${node.id}
        Content: ${node.content}
        Status: ${node.status}
        X: ${node.x}
        Y: ${node.y}
        Width: ${node.width}
        Height: ${node.height}
        Type: ${node.type}
        Outgoing Edges: ${node.outgoingEdges.map((edge) => edge.id)}
        Incoming Edges: ${node.incomingEdges.map((edge) => edge.id)}
        `);
	}

	// Process groups
	console.log("Processing groups");
	const groups = processGroups(canvasData, nodes);

	// Validation of structures
	for (const node of Object.values(nodes)) {
		// Check if the graph starting from each node is a DAG
		if (isDAG(node, new Set(), new Set(), nodes)) {
			throw new Error(
				`The call nodes form a cycle, starting from node with id ${node.id}`
			);
		}
	}

	for (const group of Object.values(groups)) {
		// Check if the nodes in the group form a tree structure
		const root = group.nodes.find(
			(node) =>
				node.incomingEdges.filter((edge) =>
					group.nodes.includes(edge.getSource(nodes))
				).length === 0
		);

		if (
			group.nodes.some(
				(node) =>
					node !== root &&
					node.incomingEdges.filter(
						(edge) =>
							group.nodes.includes(edge.getSource(nodes)) &&
							edge.type !== "variable"
					).length !== 1
			)
		) {
			throw new Error(
				`The group with id ${group.id} is not a tree structure`
			);
		}
	}

	// Final checks

	// Check if there are call nodes with outgoing blank edges to call nodes in other groups/non-grouped call nodes
	for (const node of Object.values(nodes)) {
		if (
			node.type === "call" &&
			node.outgoingEdges.some(
				(edge) =>
					edge.type === "blank" &&
					edge.getTarget(nodes).type === "call" &&
					edge.getTarget(nodes).groupId !== node.groupId
			)
		) {
			throw new Error(
				`Call node with id ${node.id} has an outgoing blank edge to a call node in another group`
			);
		}
	}

	return nodes;
}

// Processing function for nodes
async function processNodes(
	canvasData: CanvasData,
	edges: Record<string, CannoliEdge>,
	vault: Vault,
	canvasFile: TFile,
	openai: OpenAIApi
): Promise<Record<string, CannoliNode>> {
	const nodes: Record<string, CannoliNode> = {};
	const nodeTypes: NodeType[] = ["call", "content", "globalVar"];

	for (const nodeData of canvasData.nodes) {
		let nodeText = "";

		if (nodeData.type === "group") {
			continue;
		}

		if ("file" in nodeData) {
			const nodeFile = vault.getAbstractFileByPath(nodeData.file);
			if (nodeFile instanceof TFile) {
				nodeText = await vault.read(nodeFile);
			}
		} else if ("text" in nodeData) {
			nodeText = nodeData.text;
		} else if ("url" in nodeData) {
			nodeText = nodeData.url;
		}

		// Find the outgoing and incoming edge ids of the node in the canvas data
		const outgoingEdgeIds = canvasData.edges
			.filter((edge) => edge.fromNode === nodeData.id)
			.map((edge) => edge.id);
		const incomingEdgeIds = canvasData.edges
			.filter((edge) => edge.toNode === nodeData.id)
			.map((edge) => edge.id);

		// Find the outgoing and incoming edges in the edges object
		const outgoingEdges = Object.values(edges).filter((edge) =>
			outgoingEdgeIds.includes(edge.id)
		);

		const incomingEdges = Object.values(edges).filter((edge) =>
			incomingEdgeIds.includes(edge.id)
		);

		let nodeType: NodeType = "call";

		let content = "";
		let contentLines: string[] = [];

		// If text is given, parse it for a /type tag
		if (nodeText) {
			content = nodeText;
			contentLines = content.split("\n");
			const potentialTypeTag =
				contentLines[0].startsWith("/") && contentLines[0].slice(1);

			// Check if the type tag exists and is valid
			if (
				potentialTypeTag &&
				nodeTypes.includes(potentialTypeTag as NodeType)
			) {
				nodeType = potentialTypeTag as NodeType;
				contentLines.shift(); // Remove the type tag line
			}

			content = contentLines.join("\n");
		}

		// If there's no valid type tag, check for color mapping
		if (
			nodeType === "call" &&
			nodeData.color &&
			colorToNodeTypeMapping.hasOwnProperty(nodeData.color)
		) {
			nodeType = colorToNodeTypeMapping[nodeData.color];
		}

		// Check if the node is a global variable node
		if (outgoingEdges.length === 0 && incomingEdges.length === 0) {
			const firstLine = content.split("\n")[0];
			if (firstLine.startsWith("{") && firstLine.endsWith("}")) {
				nodeType = "globalVar";
			} else {
				console.log("Floating node that is not a global variable");
				continue;
			}
		}

		// After categorizing the node, ensure each node type fits the requirements

		// If the node is a call node, ensure it fits the requirements
		if (nodeType === "call") {
			// Disallow incoming debug edges
			if (incomingEdges.some((edge) => edge.type === "debug")) {
				throw new Error(
					"Error: Call nodes cannot have incoming edges of 'debug' type"
				);
			}
		}

		// If the node is a content node, ensure it fits the requirements
		if (nodeType === "content") {
			// If the node has more than one incoming edges, it must have 2 edges: one of them must be of type "blank", and the other must be of type "variable". It must also have content matching the form "{edgeLabel}"
			if (incomingEdges.length > 1) {
				if (
					incomingEdges.length === 2 &&
					incomingEdges.some((edge) => edge.type === "blank") &&
					incomingEdges.some((edge) => edge.type === "variable")
				) {
					if (
						content ===
						`{${
							incomingEdges.find(
								(edge) => edge.type === "variable"
							)?.label
						}}`
					) {
						/* empty */
					} else {
						throw new Error(
							"Error: Content nodes with an incoming variable edge must have content matching the form '{edgeLabel}'"
						);
					}
				} else {
					throw new Error(
						"Error: Content nodes with more than one incoming edge must have one of type 'blank' and one of type 'variable'"
					);
				}
			} else {
				// If the node has one incoming edge, it must be of type "blank" or "debug"
				if (
					incomingEdges.length === 1 &&
					incomingEdges[0].type !== "blank" &&
					incomingEdges[0].type !== "debug"
				) {
					throw new Error(
						"Error: Content nodes with one incoming edge must have an incoming edge of type 'blank' or 'debug'"
					);
				}
			}
		}

		const node = new CannoliNode(
			nodeData.id,
			content,
			nodeData.x,
			nodeData.y,
			nodeData.width,
			nodeData.height,
			nodeType,
			outgoingEdges,
			incomingEdges,
			vault,
			canvasFile,
			openai,
			nodes
		);
		nodes[node.id] = node;
	}

	return nodes;
}

// Function to process edges
function processEdges(canvasData: CanvasData): Record<string, CannoliEdge> {
	const edges: Record<string, CannoliEdge> = {};
	const edgeTypes: EdgeType[] = ["choice", "debug", "blank", "variable"];

	for (const edgeData of canvasData.edges) {
		let edgeType: EdgeType = "blank";

		// Initialize variables for the label and the parsed lines
		let label = "";
		let labelLines: string[] = [];

		// If a label is given, parse it for a /type tag
		if (edgeData.label) {
			label = edgeData.label;
			labelLines = label.split("\n");
			const potentialTypeTag =
				labelLines[0].startsWith("/") && labelLines[0].slice(1);

			// Check if the type tag exists and is valid
			if (
				potentialTypeTag &&
				edgeTypes.includes(potentialTypeTag as EdgeType)
			) {
				edgeType = potentialTypeTag as EdgeType;
				labelLines.shift(); // Remove the type tag line
			}

			label = labelLines.join("\n");
		}

		// If there's no valid type tag, check for color mapping
		if (
			edgeType === "blank" &&
			edgeData.color &&
			colorToEdgeTypeMapping.hasOwnProperty(edgeData.color)
		) {
			edgeType = colorToEdgeTypeMapping[edgeData.color];
		}
		// If there's no type tag and no color, but there's a label, it's a variable type and the label is the content
		else if (edgeType === "blank" && label) {
			edgeType = "variable";
		}

		const edge = new CannoliEdge(
			edgeData.id,
			edgeData.fromNode,
			edgeData.toNode,
			edgeType,
			label
		);

		edges[edge.id] = edge;
	}

	return edges;
}

function processGroups(
	canvasData: CanvasData,
	nodes: Record<string, CannoliNode>
): Record<string, CannoliGroup> {
	const groups: Record<string, CannoliGroup> = {};

	for (const nodeData of canvasData.nodes) {
		if (nodeData.type === "group") {
			const group = new CannoliGroup(nodeData.id);
			groups[nodeData.id] = group;
			for (const nodeId in nodes) {
				const node = nodes[nodeId];
				// Check if the node is within the group using the geometric properties
				if (
					nodeData.x <= node.x &&
					node.x <= nodeData.x + nodeData.width &&
					nodeData.y <= node.y &&
					node.y <= nodeData.y + nodeData.height
				) {
					group.addNode(node);
					node.groupId = group.id;
				}
			}
		}
	}

	return groups;
}

// Node Types
type NodeType = "call" | "content" | "globalVar";

const colorToNodeTypeMapping: Record<string, NodeType> = {
	"0": "call",
	"6": "content",
};

class CannoliNode {
	id: string;
	content: string;
	status: "pending" | "processing" | "complete" | "rejected";
	x: number;
	y: number;
	width: number;
	height: number;
	type: NodeType;
	outgoingEdges: CannoliEdge[];
	incomingEdges: CannoliEdge[];
	groupId: string | null;
	vault: Vault;
	canvasFile: TFile;
	openai: OpenAIApi;
	nodes: Record<string, CannoliNode>;

	constructor(
		id: string,
		content: string,
		x: number,
		y: number,
		width: number,
		height: number,
		type: NodeType,
		outgoingEdges: CannoliEdge[],
		incomingEdges: CannoliEdge[],
		vault: Vault,
		canvasFile: TFile,
		openai: OpenAIApi,
		nodes: Record<string, CannoliNode>
	) {
		this.id = id;
		this.content = content;
		this.status = "pending";
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
		this.type = type;
		this.outgoingEdges = outgoingEdges || [];
		this.incomingEdges = incomingEdges || [];
		this.vault = vault;
		this.canvasFile = canvasFile;
		this.openai = openai;
		this.nodes = nodes;
	}

	async process(nodeCompleted: () => void) {
		if (this.type === "content") {
			// Node is a content node.

			// Initialize debug variables
			let wroteToPage = false;
			let pageName = "";
			let writtenContent = "";
			let pageCreated = false;

			// If it has an incoming variable edge, replace the content with the label of the variable edge, and write it to the page with the same name as the label if it exists, and create it if it doesn't.
			if (this.incomingEdges.some((edge) => edge.type === "variable")) {
				// If the edge's payload is null, throw an error
				if (this.incomingEdges.some((edge) => edge.payload === null)) {
					// The error should look like: "No existing page could be parsed for the edge with id: 123"
					throw new Error(
						`No existing page could be parsed for the edge with id: ${
							this.incomingEdges.find(
								(edge) => edge.payload === null
							)?.id
						}`
					);
				}

				let varValue = this.incomingEdges
					.find((edge) => edge.type === "variable")
					?.getPayload() as string;

				// If the varValue is not surrounded by double braces, surround it with double braces
				if (varValue) {
					if (
						!varValue.startsWith("[[") &&
						!varValue.endsWith("]]")
					) {
						varValue = "[[" + varValue + "]]";
					}
				} else {
					throw new Error(
						`Variable name not found for edge ${
							this.incomingEdges.find(
								(edge) => edge.type === "variable"
							)?.id
						}`
					);
				}

				// Set pageContent variable to the payload of the incoming blank edge
				let pageContent = this.incomingEdges
					.find((edge) => edge.type === "blank")
					?.getPayload() as string;

				// If the first line of page content is "# " followed by the page name, regardless of case, remove the first line, because obsidian will add it automatically
				const pageContentLines = pageContent.split("\n");
				if (
					pageContentLines[0].toLowerCase() ===
					`# ${varValue.toLowerCase()}`
				) {
					pageContentLines.shift();
				}

				pageContent = pageContentLines.join("\n");

				// If the varValue without double-braces corresponds to a page (accounting for case), write the pageContent to the page
				pageName = varValue.slice(2, -2);
				const page = this.vault
					.getMarkdownFiles()
					.find(
						(file) =>
							file.basename.toLowerCase() ===
							pageName.toLowerCase()
					);

				if (page) {
					console.log("Page exists, editing");
					await this.vault.modify(page, pageContent);
					wroteToPage = true;
					writtenContent = pageContent;
				} else {
					console.log("Page doesn't exist, creating");
					await this.vault.create(pageName + ".md", pageContent);
					pageCreated = true;
					wroteToPage = true;
					writtenContent = pageContent;
				}

				this.content = varValue;
				await this.changeContent(this.content);
			}

			// If it has an incoming blank edge
			else if (this.incomingEdges.some((edge) => edge.type === "blank")) {
				// If the content of the node is a markdown page reference, write the payload of the blank edge to the page with the same name as the reference if it exists, and error if it doesn't
				if (
					this.content.startsWith("[[") &&
					this.content.endsWith("]]")
				) {
					pageName = this.content.slice(2, -2);
					const page = this.vault
						.getMarkdownFiles()
						.find(
							(file) =>
								file.basename.toLowerCase() ===
								pageName.toLowerCase()
						);

					if (page) {
						console.log("Page exists, editing");
						await this.vault.modify(
							page,
							this.incomingEdges
								.find((edge) => edge.type === "blank")
								?.getPayload() as string
						);
						wroteToPage = true;
						writtenContent = this.incomingEdges
							.find((edge) => edge.type === "blank")
							?.getPayload() as string;
					} else {
						throw new Error(
							`The page: "${pageName}" doesn't exist`
						);
					}
				} else {
					// If the content isn't a markdown page reference, set the content of the node to the payload of the blank edge
					this.content = this.incomingEdges
						.find((edge) => edge.type === "blank")
						?.getPayload() as string;
					await this.changeContent(this.content);
					writtenContent = this.content;
				}
			}

			// If it has an incoming debug edge, set the content of the node to the payload of the debug edge
			else if (this.incomingEdges.some((edge) => edge.type === "debug")) {
				this.content = this.incomingEdges
					.find((edge) => edge.type === "debug")
					?.getPayload() as string;
				await this.changeContent(this.content);
				writtenContent = this.content;
			}

			// Set the payload of all outgoing variable and blank edges to the content of the node
			for (const edge of this.outgoingEdges.filter(
				(edge) => edge.type === "variable" || edge.type === "blank"
			)) {
				edge.setPayload(this.content);
			}

			// Set the payload of all outgoing debug edges to a markdown string explaining what happened.
			// Say if the content was written to the node or a page, and show the content. If it was written to a page, say the name and mention if it was created.
			for (const edge of this.outgoingEdges.filter(
				(edge) => edge.type === "debug"
			)) {
				let debugContent = "";
				if (wroteToPage) {
					if (pageCreated) {
						debugContent = `[[${pageName}]] was created:`;
					} else {
						debugContent = `[[${pageName}]] was edited:`;
					}
					debugContent += `\n\n${writtenContent}`;
				} else {
					debugContent = `This was written to the content node:\n\n${writtenContent}`;
				}
				edge.setPayload(debugContent);
			}
		} else if (this.type === "call") {
			// Node is a call node, build its message
			let messageContent = this.content;

			// Process incoming variable and read type edges
			for (const edge of this.incomingEdges.filter(
				(edge) => edge.type === "variable"
			)) {
				const varName = edge.label;
				const varValue = edge.getPayload() as string;

				if (!varName) {
					throw new Error(
						`Variable name not found for edge ${edge.id}`
					);
				}

				if (!varValue) {
					throw new Error(`Variable ${varName} has not been set`);
				}
				messageContent = await this.processVariable(
					varName,
					varValue,
					messageContent,
					true
				);
			}

			// Process global variables
			const globalVars: Record<string, string> = {};
			for (const node of Object.values(this.nodes)) {
				if (node.type === "globalVar") {
					const [varName, varValue] = node.content.split("\n");
					globalVars[varName.slice(1, -1)] = varValue;
				}
			}

			for (const [varName, varValue] of Object.entries(globalVars)) {
				messageContent = await this.processVariable(
					varName,
					varValue,
					messageContent,
					false
				);
			}

			// Replace static page references with the content of the page
			const pageNameMatches =
				messageContent.match(/{\[\[(.*?)\]\]}/g) || [];
			for (const match of pageNameMatches) {
				const pageName = match.slice(3, -3); // Remove {[[ and ]]}

				const formattedPage = await this.getPageContent(pageName);
				if (formattedPage) {
					messageContent = messageContent.replace(
						match,
						formattedPage
					);
				} else {
					messageContent = messageContent.replace(
						match,
						`The page: "${pageName}" doesn't exist`
					);
				}
			}

			let messages: ChatCompletionRequestMessage[] = [];

			// For all incoming blank edges.
			for (const edge of this.incomingEdges.filter(
				(edge) => edge.type === "blank"
			)) {
				// If the edge is from a content node, the payload is a string. Turn it into a system chatMessage and push it to the messages array
				if (edge.getSource(this.nodes).type === "content") {
					messages.push({
						role: "system",
						content: edge.getPayload() as string,
					});
				}
				// If the edge is from a call node, the payload is an array of messages. Append them to the messages array
				else if (edge.getSource(this.nodes).type === "call") {
					messages =
						edge.getPayload() as ChatCompletionRequestMessage[];
				}
			}

			// Append the current message to the messages array
			messages.push({ role: "user", content: messageContent });

			// Send a request to OpenAI
			const chatResponse = await llmCall({
				messages,
				openai: this.openai,
				verbose: true,
			});

			if (!chatResponse) {
				throw new Error("Chat response is undefined");
			}

			if (chatResponse.content === undefined) {
				throw new Error("Chat response content is undefined");
			}

			// Load outgoing edges

			// For all outgoing variable edges
			for (const edge of this.outgoingEdges.filter(
				(edge) => edge.type === "variable"
			)) {
				// If the variable label is surrounded by double braces, call ensurePageExists on the payload of the variable edge
				if (edge.label?.startsWith("[[") && edge.label.endsWith("]]")) {
					const maybePageName = chatResponse.content;
					if (!maybePageName) {
						throw new Error("Chat response content is undefined");
					}
					const realPageName = await ensurePageExists(
						maybePageName,
						this.vault
					);
					edge.setPayload(realPageName);
				} else {
					// If the variable label is not surrounded by double braces, set the payload to the content of the response message
					edge.setPayload(chatResponse.content);
				}
			}

			// For all outgoing blank type edges
			for (const edge of this.outgoingEdges.filter(
				(edge) => edge.type === "blank"
			)) {
				// If the edge is to a call node
				if (edge.getTarget(this.nodes).type === "call") {
					// If the target node is within the same group, set the payload to the whole messages array with the response message appended
					if (edge.getTarget(this.nodes).groupId === this.groupId) {
						const payloadMessages = messages.slice();
						payloadMessages.push(chatResponse);
						edge.setPayload(payloadMessages);
					}
					// If the target node is not within the same group, set the payload to the response message
					else {
						edge.setPayload(chatResponse.content);
					}
				}
				// If the edge is to a content node, set the payload to the response message content
				else if (edge.getTarget(this.nodes).type === "content") {
					edge.setPayload(chatResponse.content);
				}
			}

			// For all outgoing debug type edges, set the payload to a markdown string containing the prompt messages and the response message formatted nicely
			for (const edge of this.outgoingEdges.filter(
				(edge) => edge.type === "debug"
			)) {
				const allMessages = messages
					.map(
						(m) =>
							`### ${
								m.role === "user" ? "USER" : "ASSISTANT"
							}:\n${m.content}`
					)
					.join("\n\n");
				const inputContent = `# <u>PROMPT</u>\n${allMessages}`;
				const outputContent = `# <u>RESPONSE</u>\n${chatResponse.content}`;
				const debugContent = `${inputContent}\n\n${outputContent}`;
				edge.setPayload(debugContent);
			}

			await this.showCompleted();
		}

		this.status = "complete";
		nodeCompleted();

		for (const edge of this.outgoingEdges) {
			await edge.getTarget(this.nodes).attemptProcess(nodeCompleted);
		}
	}

	// Process the node if all its dependencies are complete
	async attemptProcess(nodeCompleted: () => void) {
		if (this.allDependenciesComplete()) {
			// If the node is not a call node, await its process function
			if (this.type !== "call") {
				await this.process(nodeCompleted);
			}
			// If the node is a call node, show that it is processing and don't await its process function
			else {
				await this.showProcessing();
				this.process(nodeCompleted);
			}
		}
	}

	// Check if the node has all its dependencies complete
	allDependenciesComplete(): boolean {
		// Check if sources of all incoming edges have status "complete"
		return this.incomingEdges.every(
			(edge) => edge.getSource(this.nodes).status === "complete"
		);
	}

	// Helper function to get a page by its name and return its content
	async getPageContent(pageName: string) {
		// First, attempt to find the page with the original casing
		let page = this.vault
			.getMarkdownFiles()
			.find((file) => file.basename === pageName);

		// If the page isn't found, try again with all-lowercase version
		if (!page) {
			page = this.vault
				.getMarkdownFiles()
				.find(
					(file) =>
						file.basename.toLowerCase() === pageName.toLowerCase()
				);
		}

		if (page) {
			const pageContent = await this.vault.read(page);
			const renderedPage = "# " + page.basename + "\n" + pageContent; // Use the actual page name here to maintain original casing
			return renderedPage;
		}
		return null;
	}

	async processVariable(
		varName: string,
		varValue: string,
		messageContent: string,
		isRequired: boolean
	) {
		// Check if the variable name is within braces
		const varPattern = new RegExp(`{${varName}}`, "g");
		const isVarNamePresent = varPattern.test(messageContent);

		if (isVarNamePresent) {
			messageContent = messageContent.replace(varPattern, varValue);
		}

		// Check for variable names within double braces
		const varDoubleBracePattern = new RegExp(`{\\[${varName}\\]}`, "g");
		const isDoubleBraceVarNamePresent =
			varDoubleBracePattern.test(messageContent);

		if (isDoubleBraceVarNamePresent) {
			const pageName =
				varValue.startsWith("[[") && varValue.endsWith("]]")
					? varValue.slice(2, -2)
					: varValue;
			const pageContent = await this.getPageContent(pageName);

			if (pageContent) {
				messageContent = messageContent.replace(
					varDoubleBracePattern,
					pageContent
				);
			} else {
				messageContent = messageContent.replace(
					varDoubleBracePattern,
					`The page: "${pageName}" doesn't exist`
				);
			}
		} else if (isRequired && !isVarNamePresent) {
			throw new Error(
				`Content does not include an instance of variable ${varName}`
			);
		}

		return messageContent;
	}

	// Set the status of the node to complete, change its color to green, and call attemptProcess on target nodes of all outgoing edges
	async showCompleted() {
		this.status = "complete";
		await this.changeColor("4");
	}

	// Set the status of the node to rejected, change its color to "0", and call reject on target nodes of all outgoing edges
	async rejected() {
		this.status = "rejected";
		await this.changeColor("0");
		for (const edge of this.outgoingEdges) {
			await edge.getTarget(this.nodes).rejected();
		}
	}

	// Set the status of the node to processing, change its color to yellow
	async showProcessing() {
		this.status = "processing";
		await this.changeColor("3");
	}

	// Change the color of the node
	async changeColor(color: string) {
		const canvasData = JSON.parse(
			await this.vault.read(this.canvasFile)
		) as CanvasData;

		const node = canvasData.nodes.find((node) => node.id === this.id);
		if (node !== undefined) {
			node.color = color;
		} else {
			throw new Error(`Node with id ${this.id} not found`);
		}

		await this.vault.modify(this.canvasFile, JSON.stringify(canvasData));
	}

	// Change the content of the node
	async changeContent(content: string) {
		console.log("Changing content of node " + this.id + " to " + content);
		const canvasData = JSON.parse(
			await this.vault.read(this.canvasFile)
		) as CanvasData;

		const node = canvasData.nodes.find((node) => node.id === this.id);
		if (node !== undefined) {
			node.text = content;
		} else {
			throw new Error(`Node with id ${this.id} not found`);
		}

		await this.vault.modify(this.canvasFile, JSON.stringify(canvasData));
	}
}

// Edge Types
type EdgeType = "choice" | "debug" | "blank" | "variable";

const colorToEdgeTypeMapping: Record<string, EdgeType> = {
	"1": "choice",
	"6": "debug",
};

class CannoliEdge {
	id: string;
	sourceId: string;
	targetId: string;
	label: string | null;
	type: EdgeType;
	payload: ChatCompletionRequestMessage[] | string | null;

	constructor(
		id: string,
		sourceId: string,
		targetId: string,
		type: EdgeType,
		label: string | null
	) {
		this.id = id;
		this.sourceId = sourceId;
		this.targetId = targetId;
		this.type = type;
		this.payload = null;
		this.label = label;
	}

	getSource(nodes: Record<string, CannoliNode>): CannoliNode {
		return nodes[this.sourceId];
	}

	getTarget(nodes: Record<string, CannoliNode>): CannoliNode {
		return nodes[this.targetId];
	}

	setPayload(payload: ChatCompletionRequestMessage[] | string | null) {
		this.payload = payload;
	}

	getPayload(): ChatCompletionRequestMessage[] | string | null {
		return this.payload;
	}
}

class CannoliGroup {
	id: string;
	nodes: CannoliNode[];
	edges: CannoliEdge[];

	constructor(id: string) {
		this.id = id;
		this.nodes = [];
		this.edges = [];
	}

	addNode(node: CannoliNode): void {
		this.nodes.push(node);
	}

	hasNode(node: CannoliNode): boolean {
		return this.nodes.includes(node);
	}
}

function isDAG(
	node: CannoliNode,
	visited: Set<CannoliNode>,
	recursionStack: Set<CannoliNode>,
	nodes: Record<string, CannoliNode>
): boolean {
	visited.add(node);
	recursionStack.add(node);

	for (const edge of node.outgoingEdges) {
		const adjacentNode = edge.getTarget(nodes);
		if (!visited.has(adjacentNode)) {
			if (isDAG(adjacentNode, visited, recursionStack, nodes))
				return true;
		} else if (recursionStack.has(adjacentNode)) {
			return true;
		}
	}

	recursionStack.delete(node);
	return false;
}

// Search the input string for the first instance of a valid page name surrounded by braces, and return it, or return null if none is found
async function ensurePageExists(
	maybePageName: string,
	vault: Vault
): Promise<string | null> {
	// Look for instances of [[pageName]]
	const pageNameMatches = maybePageName.match(/\[\[.*?\]\]/g) || [];

	// Initialize a variable to hold the found page
	let foundPage = null;

	// Loop through each match
	for (const match of pageNameMatches) {
		// Remove [[ and ]]
		const pageName = match.slice(2, -2);

		// Look for a markdown file with a matching basename
		const page = vault
			.getMarkdownFiles()
			.find((file) => file.basename === pageName);

		// If a page was found, store its original name (with brackets) and break the loop
		if (page) {
			foundPage = match; // match still has the brackets
			break;
		}
	}

	// Return the found page's name (with brackets), or null if none was found
	return foundPage;
}

async function llmCall({
	messages,
	openai,
	model = "gpt-3.5-turbo",
	max_tokens = 300,
	n = 1,
	temperature = 0.8,
	verbose = false,
}: {
	messages: ChatCompletionRequestMessage[];
	openai: OpenAIApi;
	model?: string;
	max_tokens?: number;
	n?: number;
	temperature?: number;
	verbose?: boolean;
}) {
	if (verbose) {
		// Log out input chat messages raw, with good indentation
		console.log("Input Messages:\n" + JSON.stringify(messages, null, 2));
	}

	const chatResponse = await openai.createChatCompletion({
		messages,
		model,
		max_tokens,
		temperature,
		n,
	});

	if (verbose) {
		// Log out the response message raw, with good indentation
		console.log(
			"Response Message:\n" +
				JSON.stringify(chatResponse.data.choices[0].message, null, 2)
		);
	}

	return chatResponse.data.choices[0].message;
}
