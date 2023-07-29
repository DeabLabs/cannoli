// import { ErrorModal } from "main";
import { TFile } from "obsidian";
import {
	CanvasData,
	CanvasEdgeData,
	CanvasGroupData,
	CanvasNodeData,
} from "obsidian/canvas.d";
import { CannoliGraph } from "./cannoli";
import { CannoliGroup, GroupType } from "./group";
import {
	CallSubtype,
	CannoliNode,
	ContentSubtype,
	FloatingSubtype,
	NodeType,
	checkVariablesInContent,
} from "./node";
import {
	BlankSubtype,
	CannoliEdge,
	ChoiceSubtype,
	EdgeTag,
	EdgeType,
	FunctionSubtype,
	ListSubtype,
	UtilitySubtype,
	Variable,
	VariableSubtype,
	VariableType,
} from "./edge";

export class Canvas {
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
		const parsedContent = JSON.parse(fileContent);

		// If the subcanvas group id is set, filter the canvas data to only include the nodes and edges in the group
		if (this.subCanvasGroupId) {
			const subCanvasGroup = parsedContent.groups[this.subCanvasGroupId];
			if (!subCanvasGroup) {
				throw new Error(
					`Group with id ${this.subCanvasGroupId} not found.`
				);
			}

			const { nodeIds, edgeIds } =
				this.getNodesAndEdgesInGroup(subCanvasGroup);

			parsedContent.nodes = parsedContent.nodes.filter(
				(node: { id: string }) => nodeIds.includes(node.id)
			);
			parsedContent.edges = parsedContent.edges.filter(
				(edge: { id: string }) => edgeIds.includes(edge.id)
			);
		}

		this.canvasData = parsedContent;
	}

	getNodesAndEdgesInGroup(group: CanvasGroupData): {
		nodeIds: string[];
		edgeIds: string[];
	} {
		// Create a rectangle for the given group
		const groupRectangle = this.createRectangle(
			group.x,
			group.y,
			group.width,
			group.height
		);

		// Arrays to store the IDs of nodes and edges within the given group
		const nodeIds: string[] = [];
		const edgeIds: string[] = [];

		// Loop over all nodes in canvasData and check which nodes are within the given group
		for (const node of this.canvasData.nodes) {
			if (node.id === group.id) continue;

			const nodeRectangle = this.createRectangle(
				node.x,
				node.y,
				node.width,
				node.height
			);

			if (this.encloses(groupRectangle, nodeRectangle)) {
				nodeIds.push(node.id);
			} else if (this.overlaps(groupRectangle, nodeRectangle)) {
				throw new Error(
					`Invalid layout: Node with id ${node.id} overlaps with the group but is not fully enclosed. Nodes should be fully inside or outside of each group.`
				);
			}
		}

		// Loop over all edges in canvasData and check which edges are fully within the given group
		for (const edge of this.canvasData.edges) {
			if (
				nodeIds.includes(edge.source) &&
				nodeIds.includes(edge.target)
			) {
				edgeIds.push(edge.id);
			}
		}

		return { nodeIds, edgeIds };
	}

	parse(): {
		groups: Record<string, CannoliGroup>;
		nodes: Record<string, CannoliNode>;
		edges: Record<string, CannoliEdge>;
	} {
		const groups: Record<string, CannoliGroup> = {};
		const nodes: Record<string, CannoliNode> = {};
		const edges: Record<string, CannoliEdge> = {};

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
			// If the group's label is not an integer or is 0, disregard it
			if (!parseInt(groupData.label) || parseInt(groupData.label) === 0) {
				continue;
			}

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
			edge.crossingGroups = this.computeCrossingGroups(edge);
			edge.subtype = this.findEdgeSubtype(edge);
		}

		// For each node in the nodes object, set the subtype
		for (const node of Object.values(nodes)) {
			node.subtype = this.findNodeSubtype(node, nodes);
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

	createRectangle(x: number, y: number, width: number, height: number) {
		return {
			x,
			y,
			width,
			height,
			x_right: x + width,
			y_bottom: y + height,
		};
	}

	encloses(
		a: ReturnType<typeof this.createRectangle>,
		b: ReturnType<typeof this.createRectangle>
	): boolean {
		return (
			a.x <= b.x &&
			a.y <= b.y &&
			a.x_right >= b.x_right &&
			a.y_bottom >= b.y_bottom
		);
	}

	overlaps(
		a: ReturnType<typeof this.createRectangle>,
		b: ReturnType<typeof this.createRectangle>
	): boolean {
		const horizontalOverlap = a.x < b.x_right && a.x_right > b.x;
		const verticalOverlap = a.y < b.y_bottom && a.y_bottom > b.y;
		const overlap = horizontalOverlap && verticalOverlap;
		return overlap && !this.encloses(a, b) && !this.encloses(b, a);
	}

	parseGroupChildren(
		group: CanvasGroupData,
		validNodes: Record<string, CannoliNode>
	): { cannoliNodes: CannoliNode[]; groupIds: string[] } {
		const cannoliNodes: CannoliNode[] = [];
		const groupIds: string[] = [];
		const groupRectangle = this.createRectangle(
			group.x,
			group.y,
			group.width,
			group.height
		);

		for (const node of this.canvasData.nodes) {
			if (node.id === group.id) continue;

			const nodeRectangle = this.createRectangle(
				node.x,
				node.y,
				node.width,
				node.height
			);

			if (this.encloses(groupRectangle, nodeRectangle)) {
				if (node.type === "group") {
					groupIds.push(node.id);
				} else {
					if (!(node.id in validNodes)) continue;
					if (
						node.type === "text" ||
						node.type === "file" ||
						node.type === "link"
					) {
						cannoliNodes.push(validNodes[node.id]);
					}
				}
			} else if (this.overlaps(groupRectangle, nodeRectangle)) {
				throw new Error(
					`Invalid Cannoli layout: Object with id ${node.id} is improperly placed. All objects should be fully inside or outside of each other.`
				);
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
		let isListGroup = false; // Initialize as false

		for (const edge of incomingEdges.filter(
			(edge) => edge.type === "list"
		)) {
			const allOutgoingHaveSameVariable = edge.source.outgoingEdges
				.filter((edge) => edge.type === "list")
				.every(
					(outgoingEdge) =>
						outgoingEdge.variables.length === 1 &&
						outgoingEdge.variables[0].name ===
							edge.variables[0].name
				);

			if (allOutgoingHaveSameVariable) {
				isListGroup = true;
				break;
			}
		}

		if (isListGroup) {
			type = "list";
		}

		// If the group has a label
		if (group.label) {
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
			// If the first line of the node's text is a string surrounded by single (not double) square brackets, it's a floating node
			if (node.text && node.text.split("\n")[0].match(/^\[[^[\]]+\]$/)) {
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
			// If the edge is leaving a group of type list
			if (
				edge.crossingGroups.find(
					(group) => !group.isEntering && group.group.type === "list"
				)
			) {
				// It's a select edge
				return "select";
			} else if (
				edge.crossingGroups &&
				edge.crossingGroups.find((group) => group.isEntering)
			) {
				// Extract the outgoing edges which are of type "list"
				const listOutgoingEdges = edge.source.outgoingEdges.filter(
					(edge) => edge.type === "list"
				);

				// Check for each outgoing edge
				const hasListGroupEdge = listOutgoingEdges.some((outEdge) => {
					// Ensure crossingGroups property is defined and non-empty
					if (
						outEdge.crossingGroups &&
						outEdge.crossingGroups.length > 0
					) {
						// Find if any crossing group satisfies the condition
						const crossingGroupFound = outEdge.crossingGroups.find(
							(group) =>
								group.isEntering &&
								group.group.type === "list" &&
								outEdge.crossingGroups.length === 1
						);
						// Return true if a group was found that satisfies the conditions
						return Boolean(crossingGroupFound);
					}
					// If no crossingGroups or it is empty, return false
					return false;
				});

				if (hasListGroupEdge) {
					return "listGroup";
				} else {
					return "list";
				}
			} else {
				return "list";
			}
		}

		throw new Error(
			`Invalid Cannoli layout: Edge with id ${edge.id} has an invalid type`
		);
	}

	findNodeSubtype(
		node: CannoliNode,
		nodes: Record<string, CannoliNode>
	): CallSubtype | ContentSubtype | FloatingSubtype {
		if (node.type === "floating") {
			return "";
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
			// Put variables from all incoming edges into an array. Edges have the property "variables" which is an array of variables
			const incomingVariables = node.incomingEdges.flatMap(
				(edge) => edge.variables
			);

			const validReferencesCount = checkVariablesInContent(
				node.content,
				incomingVariables,
				nodes,
				node.cannoli,
				true
			);

			// If its content is just a link of the format [[link]], or [link], it's a reference node
			if (node.content.startsWith("[[") && node.content.endsWith("]]")) {
				return "reference";
			} else if (
				node.content.startsWith("[") &&
				node.content.endsWith("]")
			) {
				return "reference";
			} else if (
				// If there are any valid references in the content, they seem to intend for it to be a formatter node
				validReferencesCount !== undefined &&
				validReferencesCount > 0
			) {
				// Check if all references in the content are valid
				checkVariablesInContent(
					node.content,
					incomingVariables,
					nodes,
					node.cannoli
				);

				return "formatter";
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

			// If it doesn't match any of the prefixes or utility config names, it's a normal variable
			else {
				edgeVariables.push({
					type: "regular",
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
		edge: CannoliEdge
	): { group: CannoliGroup; isEntering: boolean }[] {
		// Initialize an empty array to store the groups the edge crosses
		const crossingGroups: { group: CannoliGroup; isEntering: boolean }[] =
			[];

		// Start with the parent groups of the source and target nodes
		let sourceGroup: CannoliGroup | null = edge.source?.group || null;
		let targetGroup: CannoliGroup | null = edge.target?.group || null;

		// If both nodes have groups
		if (sourceGroup && targetGroup) {
			// If the source and target nodes belong to the same group, the edge doesn't cross any group boundaries
			if (sourceGroup === targetGroup) {
				return [];
			}
			// If the source group is a parent of the target group, the edge enters the groups from the target group up to (but not including) the source group
			else if (targetGroup.parentGroups.includes(sourceGroup)) {
				while (targetGroup && targetGroup !== sourceGroup) {
					crossingGroups.push({
						group: targetGroup,
						isEntering: true,
					});
					targetGroup =
						targetGroup.parentGroups &&
						targetGroup.parentGroups.length > 0
							? targetGroup.parentGroups[
									targetGroup.parentGroups.length - 1
									// eslint-disable-next-line no-mixed-spaces-and-tabs
							  ]
							: null;
				}
			}
			// If the target group is a parent of the source group, the edge exits the groups from the source group up to (but not including) the target group
			else if (sourceGroup.parentGroups.includes(targetGroup)) {
				while (sourceGroup && sourceGroup !== targetGroup) {
					crossingGroups.push({
						group: sourceGroup,
						isEntering: false,
					});
					sourceGroup =
						sourceGroup.parentGroups &&
						sourceGroup.parentGroups.length > 0
							? sourceGroup.parentGroups[
									sourceGroup.parentGroups.length - 1
									// eslint-disable-next-line no-mixed-spaces-and-tabs
							  ]
							: null;
				}
			}
			// If source group and target group are different and neither is a parent of the other, we find the common group and exit groups from source to it, then enter groups from target to it
			else {
				// Find the deepest common parent group
				let commonGroup: CannoliGroup | null = null;
				for (const group of sourceGroup.parentGroups
					.slice()
					.reverse()) {
					// Check if the group is also a parent group of the target node
					if (targetGroup.parentGroups.includes(group)) {
						commonGroup = group;
						break;
					}
				}

				// Exit groups from source to the common group
				while (sourceGroup && sourceGroup !== commonGroup) {
					crossingGroups.push({
						group: sourceGroup,
						isEntering: false,
					});
					sourceGroup =
						sourceGroup.parentGroups &&
						sourceGroup.parentGroups.length > 0
							? sourceGroup.parentGroups[
									sourceGroup.parentGroups.length - 1
									// eslint-disable-next-line no-mixed-spaces-and-tabs
							  ]
							: null;
				}

				// Enter groups from target to the common group
				while (targetGroup && targetGroup !== commonGroup) {
					crossingGroups.push({
						group: targetGroup,
						isEntering: true,
					});
					targetGroup =
						targetGroup.parentGroups &&
						targetGroup.parentGroups.length > 0
							? targetGroup.parentGroups[
									targetGroup.parentGroups.length - 1
									// eslint-disable-next-line no-mixed-spaces-and-tabs
							  ]
							: null;
				}
			}
		}

		// If the source node has a group but the target node doesn't, the edge is leaving the source node's group
		else if (sourceGroup && !targetGroup) {
			while (sourceGroup) {
				crossingGroups.push({ group: sourceGroup, isEntering: false });
				sourceGroup =
					sourceGroup.parentGroups &&
					sourceGroup.parentGroups.length > 0
						? sourceGroup.parentGroups[
								sourceGroup.parentGroups.length - 1
								// eslint-disable-next-line no-mixed-spaces-and-tabs
						  ]
						: null;
			}
		}

		// If the target node has a group but the source node doesn't, the edge is entering the target node's group
		else if (targetGroup && !sourceGroup) {
			while (targetGroup) {
				crossingGroups.unshift({
					group: targetGroup,
					isEntering: true,
				});
				targetGroup =
					targetGroup.parentGroups &&
					targetGroup.parentGroups.length > 0
						? targetGroup.parentGroups[
								targetGroup.parentGroups.length - 1
								// eslint-disable-next-line no-mixed-spaces-and-tabs
						  ]
						: null;
			}
		}

		// Return the crossingGroups array
		return crossingGroups;
	}

	containsValidReferences(
		content: string,
		variables: Variable[],
		cannoli: CannoliGraph
	): boolean {
		const regex = /{{(.+?)}}|{(.+?)}|{\[\[(.+?)\]\]}|{\[(.+?)\]}/g;
		let match;

		while ((match = regex.exec(content)) !== null) {
			console.log("Match found: ", match);

			if (match[3]) {
				// Note reference
				const noteName = match[3];
				console.log("Checking for note reference: ", noteName);
				const note = cannoli.vault
					.getMarkdownFiles()
					.find((file) => file.basename === noteName);
				if (note) {
					console.log("Note found: ", note);
					return true;
				} else {
					console.log("Note not found.");
				}
			} else if (match[4]) {
				// Floating variable reference
				const varName = match[4];
				console.log("Checking for floating variable: ", varName);
				const floatingNode = Object.values(cannoli.nodes).find(
					(node) =>
						node.type === "floating" &&
						node.content.startsWith(varName)
				);
				if (floatingNode) {
					console.log("Floating variable found: ", floatingNode);
					return true;
				} else {
					console.log("Floating variable not found.");
				}
			} else if (match[1] || match[2]) {
				// Regular variable
				const variableName = match[1] || match[2];
				console.log("Checking for regular variable: ", variableName);
				const variableExists = variables.some(
					(variable) =>
						variable.name === variableName &&
						variable.type !== "choiceOption" &&
						variable.type !== "config"
				);
				if (variableExists) {
					console.log("Variable exists: ", variableName);
					return true;
				} else {
					console.log("Variable not found: ", variableName);
				}
			}
		}

		// If no valid references were found
		console.log("No valid references were found.");
		return false;
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
