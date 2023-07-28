import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
// import { ErrorModal } from "main";
import { Vault, TFile } from "obsidian";
import {
	CanvasData,
	CanvasEdgeData,
	CanvasGroupData,
	CanvasNodeData,
} from "obsidian/canvas.d";

class Canvas {
	canvasFile: TFile;
	canvasData: CanvasData;
	subCanvasGroupId?: string;
	cannoli: CannoliGraph;

	constructor(
		canvasFile: TFile,
		cannoli: CannoliGraph,
		subCanvasGroupId?: string
	) {
		this.canvasFile = canvasFile;
		this.subCanvasGroupId = subCanvasGroupId;
		this.cannoli = cannoli;
	}

	async fetchData() {
		const fileContent = await this.canvasFile.vault.read(this.canvasFile);

		console.log(fileContent);
		this.canvasData = JSON.parse(fileContent);
	}

	parse(): {
		groups: Record<string, CannoliGroup>;
		nodes: Record<string, CannoliNode>;
		edges: Record<string, CannoliEdge>;
	} {
		const groups: Record<string, CannoliGroup> = {};
		const nodes: Record<string, CannoliNode> = {};
		const edges: Record<string, CannoliEdge> = {};

		console.log(this.canvasData);

		// For each edge in the canvas data, create a CannoliEdge object and add it to the edges object
		for (const edgeData of this.canvasData.edges) {
			const edgeInfo = this.parseEdge(edgeData);

			if (!edgeInfo) continue;

			const { edgeType, edgeTags, edgeVariables } = edgeInfo;

			const edge = new CannoliEdge({
				id: edgeData.id,
				label: edgeData.label || "",
				sourceId: edgeData.fromNode,
				targetId: edgeData.toNode,
				type: edgeType,
				tags: edgeTags,
				variables: edgeVariables,
			});

			edges[edge.id] = edge;
		}

		// For each node in the canvas data, create a CannoliNode object and add it to the nodes object
		for (const nodeData of this.canvasData.nodes) {
			const nodeInfo = this.parseNode(nodeData, edges);

			if (!nodeInfo) continue;

			const { nodeType, incomingEdges, outgoingEdges } = nodeInfo;

			const node = new CannoliNode({
				id: nodeData.id,
				content: nodeData.text,
				incomingEdges,
				outgoingEdges,
				type: nodeType,
				cannoli: this.cannoli,
			});

			nodes[node.id] = node;
		}

		// Set the source and target nodes for each edge
		for (const edge of Object.values(edges)) {
			edge.setSourceAndTarget(nodes);
		}

		// For each group in the canvas data, get the arguments for the CannoliGroup constructor, create it, and add it to the groups object
		for (const groupData of this.canvasData.nodes.filter(
			(node) => node.type === "group"
		)) {
			// Get the children of the group
			const { cannoliNodes, groupIds } = this.parseGroupChildren(
				groupData as CanvasGroupData,
				nodes
			);

			// Get group edges
			const { incomingEdges, outgoingEdges } = this.parseGroupEdges(
				cannoliNodes,
				edges
			);

			// Parse the group
			const { maxLoops, type } = this.parseGroup(
				groupData as CanvasGroupData,
				incomingEdges
			);

			// Create the group
			const group = new CannoliGroup({
				id: groupData.id,
				label: groupData.label || "",
				nodes: cannoliNodes,
				incomingEdges,
				outgoingEdges,
				maxLoops,
				type,
				childGroupIds: groupIds,
			});

			groups[group.id] = group;
		}

		// Cannoli objects have been set, do second pass of groups, nodes and edges to further validate and fill in missing information

		// For each group in the groups object, set the parent groups, a hierarchical list of all groups the group is in, and child groups
		for (const group of Object.values(groups)) {
			group.setParentGroups(groups);
			group.setChildGroups(groups);
		}

		// For each node in the nodes object
		for (const node of Object.values(nodes)) {
			// Find the direct parent group of the node
			this.setDirectParentGroup(node, groups);
		}

		// For each edge in the edges object, set the leaving and entering groups and the subtype
		for (const edge of Object.values(edges)) {
			edge.crossingGroups = this.computeCrossingGroups(edge, groups);
			edge.subtype = this.findEdgeSubtype(edge);
		}

		// For each node in the nodes object, set the subtype
		for (const node of Object.values(nodes)) {
			node.subtype = this.findNodeSubtype(node);
		}

		// Return the groups, nodes, and edges objects
		return { groups, nodes, edges };
	}

	setDirectParentGroup(
		node: CannoliNode,
		groups: Record<string, CannoliGroup>
	) {
		// Find the direct parent group of the node
		for (const groupId in groups) {
			const group = groups[groupId];
			if (group.nodes.some((groupNode) => groupNode.id === node.id)) {
				// Check if the node is not present in any of its child groups
				if (
					group.childGroups.every(
						(childGroup) =>
							!childGroup.nodes.some(
								(groupNode) => groupNode.id === node.id
							)
					)
				) {
					node.setGroup(group);
				}
			}
		}
	}

	parseGroupChildren(
		group: CanvasGroupData,
		validNodes: Record<string, CannoliNode>
	): { cannoliNodes: CannoliNode[]; groupIds: string[] } {
		// Initialize the array of nodes and groups
		const cannoliNodes: CannoliNode[] = [];
		const groupIds: string[] = [];

		// For each node in the canvas data
		for (const node of this.canvasData.nodes) {
			// Skip the group itself
			if (node.id === group.id) continue;

			// Check if node is fully enclosed by group
			const isInside =
				node.x >= group.x &&
				node.y >= group.y &&
				node.x + node.width <= group.x + group.width &&
				node.y + node.height <= group.y + group.height;

			if (isInside) {
				// If the node has the type "group", add it to the group as a child group without validation
				if (node.type === "group") {
					groupIds.push(node.id);
				} else {
					// Check if node id exists in validNodes
					if (!(node.id in validNodes)) continue;

					// If the node has the type "file", "text" or "link", add it to the group as a node
					if (
						node.type === "text" ||
						node.type === "file" ||
						node.type === "link"
					) {
						cannoliNodes.push(validNodes[node.id]);
					}
				}
				// additional node types can be added here if necessary
			} else {
				// Check if node and group overlap
				const isOverlap =
					node.x < group.x + group.width &&
					node.x + node.width > group.x &&
					node.y < group.y + group.height &&
					node.y + node.height > group.y;
				if (isOverlap) {
					throw new Error(
						`Invalid Cannoli layout: Object with id ${node.id} is improperly placed. All objects should be fully inside or outside of each other.`
					);
				}
			}
		}

		return { cannoliNodes, groupIds };
	}

	parseGroupEdges(
		childNodes: CannoliNode[],
		validEdges: Record<string, CannoliEdge>
	): { incomingEdges: CannoliEdge[]; outgoingEdges: CannoliEdge[] } {
		// Initialize the arrays of incoming and outgoing edges
		const incomingEdges: CannoliEdge[] = [];
		const outgoingEdges: CannoliEdge[] = [];

		// For each edge in the canvas data
		for (const edge of this.canvasData.edges) {
			const validEdge = validEdges[edge.id];

			// An edge is incoming if its target node is in the group and its source node is outside the group
			if (
				childNodes.includes(validEdge.target) &&
				!childNodes.includes(validEdge.source)
			) {
				incomingEdges.push(validEdge);
			}

			// An edge is outgoing if its source node is in the group and its target node is outside the group
			if (
				childNodes.includes(validEdge.source) &&
				!childNodes.includes(validEdge.target)
			) {
				outgoingEdges.push(validEdge);
			}
		}

		return { incomingEdges, outgoingEdges };
	}

	parseGroup(
		group: CanvasGroupData,
		incomingEdges: CannoliEdge[]
	): {
		maxLoops: number;
		type: GroupType;
	} {
		// Initialize the maxLoops, choiceString, and type variables
		let maxLoops = 0;
		let type: GroupType = "basic";

		// If there are any incoming edges of type "list"
		if (incomingEdges.some((edge) => edge.type === "list")) {
			// It's a list group
			type = "list";
		}

		// If the group has a label
		if (group.label) {
			// If the label isn't an integer or is 0, throw an error
			if (!parseInt(group.label) || parseInt(group.label) === 0) {
				throw new Error(
					`Invalid Cannoli layout: Group with id ${group.id} has invalid label, loop labels must be set it to a positive integer representing the maximum number of times the group can loop`
				);
			}

			// Set the maxLoops
			maxLoops = parseInt(group.label);
		}

		return { maxLoops, type };
	}

	parseNode(
		node: CanvasNodeData,
		validEdges: Record<string, CannoliEdge>
	): {
		nodeType: NodeType;
		incomingEdges: CannoliEdge[];
		outgoingEdges: CannoliEdge[];
	} | null {
		// Initialize the arrays of incoming and outgoing edges
		const incomingEdges = this.getIncomingEdges(node, validEdges);
		const outgoingEdges = this.getOutgoingEdges(node, validEdges);

		// Initialize the node type
		let nodeType: NodeType;

		// If the node has no incoming or outgoing edges
		if (incomingEdges.length === 0 && outgoingEdges.length === 0) {
			// If the first line of the node's text is a string surrounded by single square brackets, it's a floating node
			if (
				node.text &&
				node.text.split("\n")[0].startsWith("[") &&
				node.text.split("\n")[0].endsWith("]")
			) {
				nodeType = "floating";
			}
			// Otherwise, ignore it
			else {
				return null;
			}
		}
		// Check the node's color against the node color map to determine the node type. If it has no color, its a call node. If it's not in the map, return null
		else if (node.color) {
			if (node.color in this.nodeColorMap) {
				nodeType = this.nodeColorMap[node.color];
			} else {
				return null;
			}
		} else {
			nodeType = "call";
		}

		return { nodeType, incomingEdges, outgoingEdges };
	}

	findEdgeSubtype(
		edge: CannoliEdge
	):
		| BlankSubtype
		| VariableSubtype
		| UtilitySubtype
		| ListSubtype
		| FunctionSubtype
		| ChoiceSubtype {
		// If the edge is a blank edge
		if (edge.type === "blank") {
			// If it's coming from a call node
			if (edge.source.type === "call") {
				// If it's going to a call node
				if (edge.target.type === "call") {
					// It's a continueChat edge
					return "continueChat";
				} else {
					// It's going to a content node, so it's a write edge
					return "write";
				}
			}
			// It's coming from a content node
			else {
				// If it's going to a call node
				if (edge.target.type === "call") {
					// It's a systemMessage edge
					return "systemMessage";
				} else {
					// It's going to a content node, so it's a write edge
					return "write";
				}
			}
		}
		// If the edge is a variable edge
		else if (edge.type === "variable") {
			// It's a variable edge
			return "";
		}
		// If the edge is a utility edge
		else if (edge.type === "utility") {
			// If there's no variables, it's a logging edge
			if (edge.variables.length === 0) {
				return "logging";
			} else {
				// If there are any variables, its a config edge
				return "config";
			}
		}
		// If the edge is a function edge
		else if (edge.type === "function") {
			// It's a function edge
			return "";
		}
		// If the edge is a choice edge
		else if (edge.type === "choice") {
			// If the edge is leaving a group
			if (edge.crossingGroups.find((group) => !group.isEntering)) {
				// It's an outOfGroup choice edge
				return "outOfGroup";
			} else {
				// It's a normal choice edge
				return "normal";
			}
		}
		// If the edge is a list edge
		else if (edge.type === "list") {
			// If the edge is leaving a group
			if (edge.crossingGroups.find((group) => !group.isEntering)) {
				// It's a select edge
				return "select";
			} else {
				// It's a list edge
				return "list";
			}
		}

		throw new Error(
			`Invalid Cannoli layout: Edge with id ${edge.id} has an invalid type`
		);
	}

	findNodeSubtype(
		node: CannoliNode
	): CallSubtype | ContentSubtype | FloatingSubtype {
		if (node.type === "floating") {
			node.subtype = "";
		} else if (node.type === "call") {
			// If the node has any outgoing edge of type "list"
			if (node.outgoingEdges.some((edge) => edge.type === "list")) {
				// If one of them is a select edge
				if (
					node.outgoingEdges.some((edge) => edge.subtype === "select")
				) {
					// It's a select subtype
					return "select";
				} else {
					// It's a list subtype
					return "list";
				}
			}
			// If the node has any outgoing edges of type "choice"
			else if (
				node.outgoingEdges.some((edge) => edge.type === "choice")
			) {
				// It's a choice subtype
				return "choice";
			} else {
				// If it has no outgoing edges of type "list" or "choice", it's a normal node
				return "normal";
			}
		} else if (node.type === "content") {
			// If its content is just a link of the format [[link]], or [link], it's a reference node
			if (node.content.startsWith("[[") && node.content.endsWith("]]")) {
				return "reference";
			} else if (
				node.content.startsWith("[") &&
				node.content.endsWith("]")
			) {
				return "reference";
			}
			// If it contains any variable references of the format {variable} or {{variable}}, and they are all valid, it's a formatter node
			else if (node.content.includes("{") && node.content.includes("}")) {
				const regex = /{{?([^{}]+)}}?/g;

				let match;
				let allVariablesFound = true; // Initial flag
				while ((match = regex.exec(node.content)) !== null) {
					const matchedVariable = match[1];

					// Use some() to check if any edge has the variable
					const hasVariable = node.incomingEdges.some((edge) =>
						edge.variables.some(
							(variable) =>
								variable.name === matchedVariable &&
								variable.type !== "choiceOption" &&
								variable.type !== "config"
						)
					);

					if (!hasVariable) {
						allVariablesFound = false; // Set flag to false if variable is not found
						break;
					}
				}

				if (allVariablesFound) {
					// If all variables are found, return "formatter"
					return "formatter";
				}
			}
			// If it has any incoming edges that contain any variables that are newLink, existingLink, newPath, or existingPath, it's a vault node
			else if (
				node.incomingEdges.some((edge) =>
					edge.variables.some(
						(variable) =>
							variable.type === "newLink" ||
							variable.type === "existingLink" ||
							variable.type === "newPath" ||
							variable.type === "existingPath"
					)
				)
			) {
				return "vault";
			}
			// Otherwise, it's a normal node
			else {
				return "normal";
			}
		}

		throw new Error(
			`Invalid Cannoli layout: Node with id ${node.id} has an invalid type`
		);
	}

	getIncomingEdges(
		node: CanvasNodeData,
		validEdges: Record<string, CannoliEdge>
	): CannoliEdge[] {
		// Here we're converting the validEdges object into an array and then using .filter()
		return Object.values(validEdges).filter(
			(edge: CannoliEdge) => edge.targetId === node.id
		);
	}

	getOutgoingEdges(
		node: CanvasNodeData,
		validEdges: Record<string, CannoliEdge>
	): CannoliEdge[] {
		// Here we're converting the validEdges object into an array and then using .filter()
		return Object.values(validEdges).filter(
			(edge: CannoliEdge) => edge.sourceId === node.id
		);
	}

	isUnidirectional(edge: CanvasEdgeData): boolean {
		// Edge is unidirectional if it does not have fromEnd or toEnd properties
		return !(
			edge.hasOwnProperty("fromEnd") || edge.hasOwnProperty("toEnd")
		);
	}

	getSourceNode(
		edge: CanvasEdgeData,
		nodes: CanvasNodeData[]
	): CanvasNodeData {
		// Find the source node for the edge
		const sourceNode = nodes.find((node) => node.id === edge.fromNode);
		if (!sourceNode) {
			throw new Error(
				`Edge with id ${edge.id} does not have a valid source node.`
			);
		}
		return sourceNode;
	}

	getTargetNode(
		edge: CanvasEdgeData,
		nodes: CanvasNodeData[]
	): CanvasNodeData {
		// Find the target node for the edge
		const targetNode = nodes.find((node) => node.id === edge.toNode);
		if (!targetNode) {
			throw new Error(
				`Edge with id ${edge.id} does not have a valid target node.`
			);
		}
		return targetNode;
	}

	parseEdge(edge: CanvasEdgeData): {
		edgeType: EdgeType;
		edgeTags: EdgeTag[];
		edgeVariables: Variable[];
	} | null {
		let edgeType: EdgeType | null = null;
		const edgeTags: EdgeTag[] = [];
		const edgeVariables: Variable[] = [];

		let label = edge.label;

		// if the edge's color is 1, we won't parse it
		if (edge.color === "1") {
			return null;
		}

		// If the edge isn't uni-directional, we won't parse it
		if (!this.isUnidirectional(edge)) {
			return null;
		}

		// if the edge has a label, check the first character of the label against the edge prefix map to determine the edge type. If there was a prefix, remove it from the label
		if (label) {
			if (label[0] in this.edgePrefixMap) {
				edgeType = this.edgePrefixMap[label[0]];
				label = label.slice(1);
			}
		}

		// if we still haven't determined the type, and the edge has a color, check the edge color against the edge color map to determine the edge type
		if (!edgeType && edge.color) {
			edgeType = this.edgeColorMap[edge.color];
		}

		// If we still haven't determined the type, it's either a blank edge or a variable edge, depending on if there is text in the label
		if (!edgeType) {
			edgeType = label ? "variable" : "blank";
		}

		// Return if there's no label, from here on out we'll assume there is a label
		if (!label) {
			return { edgeType, edgeTags, edgeVariables };
		}

		// If the edge isn't a blank edge, check if the last character is a tag on the edge tag map. If you find one, remove it from the label and add it to the tags array
		if (
			edgeType !== "blank" &&
			label &&
			label[label.length - 1] in this.edgeTagMap
		) {
			edgeTags.push(this.edgeTagMap[label[label.length - 1]]);
			label = label.slice(0, -1);
		}

		// Split the label by comma and trim the variables
		const unparsedEdgeVariables = label
			.split(",")
			.map((variable) => variable.trim());

		// For each unparsed variable
		for (const unparsedVariable of unparsedEdgeVariables) {
			// Try to match the first two characters first
			let prefix = unparsedVariable.substring(0, 2);
			if (prefix in this.variablePrefixMap) {
				edgeVariables.push({
					type: this.variablePrefixMap[prefix],
					name: unparsedVariable.substring(2),
				});
				continue;
			}

			// If that didn't work, try to match the first character
			prefix = unparsedVariable.substring(0, 1);
			if (prefix in this.variablePrefixMap) {
				edgeVariables.push({
					type: this.variablePrefixMap[prefix],
					name: unparsedVariable.substring(1),
				});
				continue;
			}

			// If it matches one of the utility config names, the variable type is config
			if (unparsedVariable in this.utilityConfigMap) {
				edgeVariables.push({
					type: "config",
					name: unparsedVariable,
				});
			}

			// If the type is choice, change the first variable to a choice option variable
			if (edgeType === "choice") {
				edgeVariables[0].type = "choiceOption";
			}
		}

		return { edgeType, edgeTags, edgeVariables };
	}

	computeCrossingGroups(
		edge: CannoliEdge,
		groups: Record<string, CannoliGroup>
	): { group: CannoliGroup; isEntering: boolean }[] {
		const crossingGroups: { group: CannoliGroup; isEntering: boolean }[] =
			[];

		let currentGroup: CannoliGroup | null = edge.source.group;

		// If the source node isn't in a group, start from the target node's group
		if (!currentGroup) {
			currentGroup = edge.target.group;

			if (currentGroup) {
				crossingGroups.push({ group: currentGroup, isEntering: true });
			}
		} else {
			// Step 2 to 4: Traverse up the group hierarchy from the source node
			while (currentGroup && !currentGroup.hasNode(edge.target.id)) {
				crossingGroups.push({ group: currentGroup, isEntering: false });
				currentGroup =
					currentGroup.parentGroups.length > 0
						? currentGroup.parentGroups[0]
						: null;
			}

			// Step 5: If a group was found that contains the target node, traverse down to the target node
			if (currentGroup) {
				let childGroups = [...currentGroup.childGroups];

				while (childGroups.length > 0) {
					const childGroup = childGroups.pop();

					if (!childGroup) continue;

					// If the child group contains the target node, traverse into it
					if (childGroup.hasNode(edge.target.id)) {
						crossingGroups.push({
							group: childGroup,
							isEntering: true,
						});
						childGroups = [...childGroup.childGroups];
					}
				}
			}

			// If the target node isn't in a group, then the edge is leaving the final group
			if (!edge.target.group && crossingGroups.length > 0) {
				crossingGroups[crossingGroups.length - 1].isEntering = false;
			}
		}

		return crossingGroups;
	}

	edgeColorMap: Record<string, EdgeType> = {
		"2": "choice",
		"3": "list",
		"5": "utility",
		"6": "function",
	};

	edgePrefixMap: Record<string, EdgeType> = {
		"*": "utility",
		"?": "choice",
		"-": "list",
		"=": "function",
	};

	edgeTagMap: Record<string, EdgeTag> = {
		"|": "continueChat",
	};

	variablePrefixMap: Record<string, VariableType> = {
		"[": "existingLink",
		"/": "existingPath",
		"+[": "newLink",
		"+/": "newPath",
	};

	nodeColorMap: Record<string, NodeType> = {
		"0": "call",
		"3": "call",
		"4": "call",
		"6": "content",
	};

	utilityConfigMap: Record<string, string> = {
		logging: "logging",
		function: "function",
		model: "model",
		max_tokens: "max_tokens",
		temperature: "temperature",
		top_p: "top_p",
		frequency_penalty: "frequency_penalty",
		presence_penalty: "presence_penalty",
		stop: "stop",
		echo: "echo",
		debug: "debug",
	};
}

export class CannoliGraph {
	canvas: Canvas;
	apiKey: string;
	openai: OpenAIApi;
	vault: Vault;
	groups: Record<string, CannoliGroup>;
	nodes: Record<string, CannoliNode>;
	edges: Record<string, CannoliEdge>;

	constructor(canvasFile: TFile, apiKey: string, vault: Vault) {
		this.canvas = new Canvas(canvasFile, this);
		this.apiKey = apiKey;
		this.vault = vault;
		this.groups = {};
		this.nodes = {};
		this.edges = {};

		const configuration = new Configuration({ apiKey: apiKey });
		delete configuration.baseOptions.headers["User-Agent"];

		// Create an instance of OpenAI
		this.openai = new OpenAIApi(configuration);
	}

	async initialize(verbose = false) {
		await this.canvas.fetchData();
		const { groups, nodes, edges } = this.canvas.parse();
		this.groups = groups;
		this.nodes = nodes;
		this.edges = edges;

		if (verbose) {
			this.logCannoliObjects();
		}
	}

	logCannoliObjects() {
		// Call logEdgeDetails() on each edge
		for (const edge of Object.values(this.edges)) {
			edge.logEdgeDetails();
		}

		// Call logNodeDetails() on each node
		for (const node of Object.values(this.nodes)) {
			node.logNodeDetails();
		}

		// Call logGroupDetails() on each group
		for (const group of Object.values(this.groups)) {
			group.logGroupDetails();
		}
	}

	validate() {
		// NEXT: Call validator functions on groups, nodes, and edges
	}
}

// export async function startCannoli(
// 	canvasFile: TFile,
// 	apiKey: string,
// 	vault: Vault
// ) {
// 	const configuration = new Configuration({ apiKey: apiKey });
// 	delete configuration.baseOptions.headers["User-Agent"];

// 	// Create an instance of OpenAI
// 	const openai = new OpenAIApi(configuration);

// 	// Read the content of the file
// 	const fileContent = await vault.read(canvasFile);

// 	const canvasData = JSON.parse(fileContent) as CanvasData;

// 	console.log(canvasData);

// 	let nodes: Record<string, CannoliNode>;

// 	try {
// 		nodes = await processCanvas(canvasData, vault, canvasFile, openai);

// 		// Rest of the logic goes here with the processed and validated nodes and groups
// 	} catch (error) {
// 		new ErrorModal(
// 			this.app,
// 			"Error processing canvas: " + error.message
// 		).open();
// 		return;
// 	}

// 	// Run the cannoli
// 	await runCannoli(nodes);
// }

// async function runCannoli(nodes: Record<string, CannoliNode>) {
// 	const nodeKeys = Object.keys(nodes);

// 	// Change all call nodes to color 0
// 	for (const key of nodeKeys) {
// 		if (nodes[key].type === "call") {
// 			await nodes[key].changeColor("0");
// 		}
// 	}

// 	// Create nodeCompleted callback, which will be called when a node is completed, and checks if all nodes are complete
// 	const nodeCompleted = () => {
// 		// Check if all nodes are complete
// 		if (nodeKeys.every((key) => nodes[key].status === "complete")) {
// 			console.log("All nodes complete");
// 			return;
// 		}
// 	};

// 	// Attempt to process all nodes with no incoming edges and at least one outgoing edge
// 	for (const key of nodeKeys) {
// 		if (
// 			nodes[key].incomingEdges.length === 0 &&
// 			nodes[key].outgoingEdges.length > 0
// 		) {
// 			await nodes[key].attemptProcess(nodeCompleted);
// 		}
// 	}
// }

// Node Types
type NodeType = "call" | "content" | "floating";

type CallSubtype = "list" | "select" | "choice" | "normal";

type ContentSubtype = "reference" | "vault" | "formatter" | "normal";

type FloatingSubtype = "";

class CannoliNode {
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

	setGroup(group: CannoliGroup) {
		this.group = group;
	}
}

// Edge Types
type EdgeType =
	| "blank"
	| "variable"
	| "utility"
	| "function"
	| "choice"
	| "list";

type BlankSubtype = "continueChat" | "systemMessage" | "write";

type VariableSubtype = "";

type UtilitySubtype = "logging" | "config";

type ListSubtype = "list" | "listGroup" | "select";

type FunctionSubtype = "";

type ChoiceSubtype = "normal" | "outOfGroup";

type EdgeTag = "continueChat";

type Variable = {
	name: string;
	type: VariableType;
	value?: string;
};

type VariableType =
	| "existingLink"
	| "existingPath"
	| "newLink"
	| "newPath"
	| "choiceOption"
	| "regular"
	| "config";

class CannoliEdge {
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
						.map((variable) => `\n\tVariable: "${variable.name}"`)
						.join("")
				: "\n\tVariables: None";
		const tagsFormat =
			this.tags.length > 0
				? this.tags.map((tag) => `\n\tTag: "${tag}"`).join("")
				: "\n\tTags: None";

		const logString = `Edge: ${sourceFormat}----${this.label}---->${targetFormat} (Type: ${this.type}, Subtype: ${this.subtype}), ${variablesFormat}, ${crossingGroupsFormat} , ${tagsFormat}`;

		console.log(logString);
	}

	setSourceAndTarget(nodes: Record<string, CannoliNode>) {
		this.source = nodes[this.sourceId];
		this.target = nodes[this.targetId];
	}
}

type GroupType = "basic" | "list";

class CannoliGroup {
	id: string;
	label: string;
	nodes: CannoliNode[];
	incomingEdges: CannoliEdge[];
	outgoingEdges: CannoliEdge[];
	maxLoops: number;
	type: GroupType;
	childGroupIds: string[];
	parentGroups: CannoliGroup[]; // ordered set of groups, from bottom level (smallest) to top level (biggest)
	childGroups: CannoliGroup[]; // unordered set of child groups
	copies: CannoliGroup[];

	constructor({
		id,
		label,
		nodes,
		incomingEdges,
		outgoingEdges,
		maxLoops,
		type,
		childGroupIds,
	}: {
		id: string;
		label: string;
		nodes: CannoliNode[];
		incomingEdges: CannoliEdge[];
		outgoingEdges: CannoliEdge[];
		maxLoops: number;
		type: GroupType;
		childGroupIds: string[];
	}) {
		this.id = id;
		this.label = label;
		this.nodes = nodes;
		this.incomingEdges = incomingEdges;
		this.outgoingEdges = outgoingEdges;
		this.maxLoops = maxLoops;
		this.type = type;
		this.childGroupIds = childGroupIds;
	}

	logGroupDetails() {
		const nodesFormat =
			this.nodes.length > 0
				? this.nodes
						.map(
							(node) =>
								`\n\tNode: "${node.content.substring(
									0,
									20
								)}..."`
						)
						.join("")
				: "\n\tNodes: None";
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
		const parentGroupsFormat =
			this.parentGroups.length > 0
				? this.parentGroups
						.map(
							(group) =>
								`\n\tParent Group: "${
									group.label
										? group.label.substring(0, 20)
										: "No Label"
								}..."`
						)
						.join("")
				: "\n\tParent Groups: None";
		const childGroupsFormat =
			this.childGroups.length > 0
				? this.childGroups
						.map(
							(group) =>
								`\n\tChild Group: "${
									group.label
										? group.label.substring(0, 20)
										: "No Label"
								}..."`
						)
						.join("")
				: "\n\tChild Groups: None";

		const logString = `Group: MaxLoops: ${this.maxLoops}, (Type: ${this.type}), ${nodesFormat}, ${incomingEdgesFormat}, ${outgoingEdgesFormat}, ${parentGroupsFormat}, ${childGroupsFormat}`;

		console.log(logString);
	}

	setChildGroups(groups: Record<string, CannoliGroup>) {
		// Just map the child group ids to the actual child groups
		this.childGroups = this.childGroupIds.map(
			(childGroupId) => groups[childGroupId]
		);
	}

	setParentGroups(groups: Record<string, CannoliGroup>) {
		this.parentGroups = []; // Clear the current list of parent groups

		// Iterate through all groups
		for (const groupId in groups) {
			const group = groups[groupId];

			// If the current group is a child of the group we're considering
			if (group.childGroupIds.includes(this.id)) {
				this.parentGroups.push(group);
			}
		}

		// Helper function to find the top level parent of a group and calculate depth
		const findTopLevelParentAndDepth = (
			group: CannoliGroup
		): [CannoliGroup, number] => {
			let depth = 0;
			while (group.parentGroups && group.parentGroups.length > 0) {
				group = group.parentGroups[0]; // Choose the first parent as the new group
				depth++;
			}
			return [group, depth];
		};

		// Sort the parent groups based on the level of their top-level parent and depth
		this.parentGroups.sort((a, b) => {
			const [aTopLevelParent, aDepth] = findTopLevelParentAndDepth(a);
			const [bTopLevelParent, bDepth] = findTopLevelParentAndDepth(b);

			// Compare based on depth first, then the id of the top-level parent
			if (aDepth < bDepth) {
				return -1;
			} else if (aDepth > bDepth) {
				return 1;
			} else {
				return aTopLevelParent.id.localeCompare(bTopLevelParent.id);
			}
		});
	}

	addChildGroup(id: string) {
		this.childGroupIds.push(id);
	}

	hasNode(id: string) {
		return this.nodes.some((node) => node.id === id);
	}
}

// function isDAG(
// 	node: CannoliNode,
// 	visited: Set<CannoliNode>,
// 	recursionStack: Set<CannoliNode>,
// 	nodes: Record<string, CannoliNode>
// ): boolean {
// 	visited.add(node);
// 	recursionStack.add(node);

// 	for (const edge of node.outgoingEdges) {
// 		const adjacentNode = edge.target;
// 		if (!visited.has(adjacentNode)) {
// 			if (isDAG(adjacentNode, visited, recursionStack, nodes))
// 				return true;
// 		} else if (recursionStack.has(adjacentNode)) {
// 			return true;
// 		}
// 	}

// 	recursionStack.delete(node);
// 	return false;
// }

// // Search the input string for the first instance of a valid page name surrounded by braces, and return it, or return null if none is found
// async function ensurePageExists(
// 	maybePageName: string,
// 	vault: Vault
// ): Promise<string | null> {
// 	// Look for instances of [[pageName]]
// 	const pageNameMatches = maybePageName.match(/\[\[.*?\]\]/g) || [];

// 	// Initialize a variable to hold the found page
// 	let foundPage = null;

// 	// Loop through each match
// 	for (const match of pageNameMatches) {
// 		// Remove [[ and ]]
// 		const pageName = match.slice(2, -2);

// 		// Look for a markdown file with a matching basename
// 		const page = vault
// 			.getMarkdownFiles()
// 			.find((file) => file.basename === pageName);

// 		// If a page was found, store its original name (with brackets) and break the loop
// 		if (page) {
// 			foundPage = match; // match still has the brackets
// 			break;
// 		}
// 	}

// 	// Return the found page's name (with brackets), or null if none was found
// 	return foundPage;
// }

// async function llmCall({
// 	messages,
// 	openai,
// 	model = "gpt-3.5-turbo",
// 	max_tokens = 300,
// 	n = 1,
// 	temperature = 0.8,
// 	verbose = false,
// }: {
// 	messages: ChatCompletionRequestMessage[];
// 	openai: OpenAIApi;
// 	model?: string;
// 	max_tokens?: number;
// 	n?: number;
// 	temperature?: number;
// 	verbose?: boolean;
// }) {
// 	if (verbose) {
// 		// Log out input chat messages raw, with good indentation
// 		console.log("Input Messages:\n" + JSON.stringify(messages, null, 2));
// 	}

// 	const chatResponse = await openai.createChatCompletion({
// 		messages,
// 		model,
// 		max_tokens,
// 		temperature,
// 		n,
// 	});

// 	if (verbose) {
// 		// Log out the response message raw, with good indentation
// 		console.log(
// 			"Response Message:\n" +
// 				JSON.stringify(chatResponse.data.choices[0].message, null, 2)
// 		);
// 	}

// 	return chatResponse.data.choices[0].message;
// }
