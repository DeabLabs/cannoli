import { CanvasData } from "obsidian/canvas";

import {
	AllCannoliCanvasNodeData,
	CannoliCanvasData,
	CannoliCanvasEdgeData,
	CannoliCanvasFileData,
	CannoliCanvasGroupData,
	CannoliCanvasLinkData,
	CannoliCanvasTextData,
	CannoliEdgeData,
	CannoliObjectKind,
	CannoliGroupData,
	CannoliNodeData,
	CannoliObjectStatus,
	ReferenceType,
	Reference,
	CallNodeType,
	ContentNodeType,
	FloatingNodeType,
	GroupType,
	EdgeType,
	CannoliVertexData,
	VaultModifier,
	VerifiedCannoliCanvasData,
} from "./models/graph";

export enum IndicatedNodeType {
	Call = "call",
	Content = "content",
	Floating = "floating",
}

export class CannoliFactory {
	cannoliData: CannoliCanvasData;

	vaultModifierMap: Record<string, VaultModifier> = {
		"[": VaultModifier.Note,
		"+[": VaultModifier.CreateNote,
		"/": VaultModifier.Folder,
		"+/": VaultModifier.CreateFolder,
	};

	nodeColorMap: Record<string, IndicatedNodeType> = {
		"0": IndicatedNodeType.Call,
		"1": IndicatedNodeType.Call,
		"3": IndicatedNodeType.Call,
		"4": IndicatedNodeType.Call,
		"6": IndicatedNodeType.Content,
	};

	edgePrefixMap: Record<string, EdgeType> = {
		"*": EdgeType.Config,
		"?": EdgeType.Choice,
		"=": EdgeType.Function,
		"<": EdgeType.Key,
	};

	edgeColorMap: Record<string, EdgeType> = {
		"2": EdgeType.Config,
		"3": EdgeType.Choice,
		"4": EdgeType.Function,
		"5": EdgeType.Key,
	};

	addMessagesModifierMap: Record<string, boolean> = {
		"|": true,
		"~": false,
	};

	groupPrefixMap: Record<string, GroupType> = {
		"<": GroupType.ForEach,
		"?": GroupType.While,
	};

	groupColorMap: Record<string, GroupType> = {
		"5": GroupType.ForEach,
		"3": GroupType.While,
	};

	constructor(canvas: CanvasData) {
		this.cannoliData = canvas;
	}

	getCannoliData(): VerifiedCannoliCanvasData {
		// Create the cannoli data object for each node and edge
		this.cannoliData.nodes.forEach((node) => {
			// Ignore red ("1") objects
			if (node.color === "1") {
				return;
			}

			const kind = this.getVertexKind(node);

			let cannoliData: CannoliVertexData | null;

			if (kind === CannoliObjectKind.Node) {
				node = node as
					| CannoliCanvasFileData
					| CannoliCanvasLinkData
					| CannoliCanvasTextData;
				cannoliData = this.createNodeData(node);
			} else {
				node = node as CannoliCanvasGroupData;
				cannoliData = this.createGroupData(node);
			}

			if (cannoliData) {
				node.cannoliData = cannoliData;
			}
		});

		// Create the cannoli data object for each edge
		this.cannoliData.edges.forEach((edge) => {
			// Ignore red ("1") objects
			if (edge.color === "1") {
				return;
			}

			const cannoliData = this.createEdgeData(edge);

			if (cannoliData) {
				edge.cannoliData = cannoliData;
			}
		});

		// Set all dependencies
		for (const node of this.cannoliData.nodes) {
			if (node.cannoliData) {
				node.cannoliData.dependencies =
					this.getVertexDependencies(node);
			}
		}

		for (const edge of this.cannoliData.edges) {
			if (edge.cannoliData) {
				edge.cannoliData.dependencies = this.getEdgeDependencies(edge);
			}
		}

		// Filter out objects that don't have cannoliData
		const verifiedCannoliData: CannoliCanvasData = {
			nodes: this.cannoliData.nodes.filter((node) => !!node.cannoliData),
			edges: this.cannoliData.edges.filter((edge) => !!edge.cannoliData),
		};

		return verifiedCannoliData as VerifiedCannoliCanvasData;
	}

	createNodeData(
		node:
			| CannoliCanvasFileData
			| CannoliCanvasLinkData
			| CannoliCanvasTextData
	): CannoliNodeData | null {
		// If the node already has a cannoliData object, return it
		if (node.cannoliData) {
			return node.cannoliData;
		}

		let universalText;

		if (node.type === "file") {
			node = node as CannoliCanvasFileData;
			// If the node is a file, the "file" property is a path. Get the text after the final "/" and remove the extension
			const fileName = node.file.split("/").pop();
			universalText = fileName?.split(".").shift();

			// Then, prepend ">[[" and append "]]" to the text to match the reference format
			universalText = `>[[${universalText}]]`;
		} else if (node.type === "link") {
			node = node as CannoliCanvasLinkData;
			universalText = node.url;
		} else if (node.type === "text") {
			node = node as CannoliCanvasTextData;
			// If the node is a text, the "text" property is the text
			universalText = node.text;
		}

		const kind = CannoliObjectKind.Node;
		const type = this.getNodeType(node);
		const text = universalText || "";
		const references =
			node.type === "text" ? this.parseNodeReferences(node) : [];
		const incomingEdges = this.getIncomingEdges(node.id).map(
			(edge) => edge.id
		);
		const outgoingEdges = this.getOutgoingEdges(node.id).map(
			(edge) => edge.id
		);
		const groups = this.getGroupsForVertex(node);
		const dependencies = [] as string[];
		const isClone = false;
		const status =
			type === FloatingNodeType.Variable
				? CannoliObjectStatus.Complete
				: CannoliObjectStatus.Pending;

		if (!type) {
			return null;
		}

		return {
			kind,
			type,
			text,
			references,
			incomingEdges,
			outgoingEdges,
			groups,
			dependencies,
			isClone,
			status,
		};
	}

	createGroupData(group: CannoliCanvasGroupData): CannoliGroupData | null {
		// If the node already has a cannoliData object, return it
		if (group.cannoliData) {
			return group.cannoliData;
		}

		const labelInfo = this.parseGroupLabel(group);

		const kind = CannoliObjectKind.Group;
		const type = this.getGroupType(group);
		const text = labelInfo?.text || "";
		const incomingEdges = this.getIncomingEdges(group.id).map(
			(edge) => edge.id
		);
		const outgoingEdges = this.getOutgoingEdges(group.id).map(
			(edge) => edge.id
		);
		const groups = this.getGroupsForVertex(group);
		const members = this.getMembersForGroup(group);
		const dependencies = [] as string[];
		const isClone = false;
		const status =
			type === GroupType.Basic
				? CannoliObjectStatus.Complete
				: CannoliObjectStatus.Pending;

		const genericProps: CannoliGroupData = {
			kind,
			type,
			text,
			incomingEdges,
			outgoingEdges,
			groups,
			members,
			dependencies,
			isClone,
			status,
		};

		if (type === GroupType.Repeat || type === GroupType.While) {
			return {
				...genericProps,
				currentLoop: labelInfo?.completedNumber || 0,
				maxLoops: labelInfo?.totalNumber || 0,
			};
		} else {
			return genericProps;
		}
	}

	createEdgeData(edge: CannoliCanvasEdgeData): CannoliEdgeData | null {
		// If the node already has a cannoliData object, return it
		if (edge.cannoliData) {
			return edge.cannoliData;
		}

		const crossingGroups = this.getCrossingGroups(edge);
		let crossingInGroups: string[] = [];
		let crossingOutGroups: string[] = [];

		if (crossingGroups) {
			crossingInGroups = crossingGroups.crossingInGroups;
			crossingOutGroups = crossingGroups.crossingOutGroups;
		} else {
			crossingInGroups = [];
			crossingOutGroups = [];
		}

		const labelInfo = this.parseEdgeLabel(edge);

		const kind = CannoliObjectKind.Edge;
		const type = this.getEdgeType(edge);
		const text = labelInfo?.text || "";
		const vaultModifier = labelInfo?.vaultModifier || undefined;
		const addMessages = labelInfo?.addMessages || false;
		const dependencies = [] as string[];
		const isClone = false;
		const isReflexive = this.isReflexive(edge);
		const status = CannoliObjectStatus.Pending;

		if (!type) {
			return null;
		}

		return {
			kind,
			type,
			text,
			addMessages,
			dependencies,
			isClone,
			crossingInGroups,
			crossingOutGroups,
			status,
			isReflexive,
			vaultModifier,
		};
	}

	getVertexDependencies(vertex: AllCannoliCanvasNodeData): string[] {
		// Initialize the dependencies array
		const dependencies = [] as string[];

		// For each incoming edge, check if it is reflexive and add it if its not
		const incomingEdges = vertex.cannoliData?.incomingEdges;

		if (!incomingEdges) {
			throw new Error(
				"setVertexDependencies: vertex.cannoliData.incomingEdges is undefined"
			);
		}

		incomingEdges.forEach((edge) => {
			const edgeData = this.getEdge(edge);
			if (!edgeData) {
				throw new Error("setVertexDependencies: edgeData is undefined");
			}

			if (this.isReflexive(edgeData)) {
				return;
			} else {
				dependencies.push(edge);
			}
		});

		// For each incoming edge of each group in groups, check if it is reflexive and add it if its not
		const groups = this.getGroupsForVertex(vertex);
		groups.forEach((group) => {
			const groupData = this.getGroup(group);
			if (!groupData) {
				throw new Error(
					"setVertexDependencies: groupData is undefined"
				);
			}

			const incomingEdges = groupData.cannoliData?.incomingEdges;

			if (!incomingEdges) {
				throw new Error(
					"setVertexDependencies: group.cannoliData.incomingEdges is undefined"
				);
			}

			incomingEdges.forEach((edge) => {
				const edgeData = this.getEdge(edge);
				if (!edgeData) {
					throw new Error(
						"setVertexDependencies: edgeData is undefined"
					);
				}

				if (this.isReflexive(edgeData)) {
					return;
				} else {
					dependencies.push(edge);
				}
			});
		});

		// If the vertex is a group, add all of its members as dependencies
		if (vertex.cannoliData?.kind === CannoliObjectKind.Group) {
			console.log(`vertex with text ${vertex.text} is a group`);
			const group = vertex as CannoliCanvasGroupData;
			const members = group.cannoliData?.members;
			if (members) {
				dependencies.push(...members);
			}
		}

		return dependencies;
	}

	getEdgeDependencies(edge: CannoliCanvasEdgeData): string[] {
		const dependencies = [] as string[];

		// Set the source as a dependency
		dependencies.push(edge.fromNode);

		// Set all crossing out groups as dependencies
		const cannoliData = edge.cannoliData;

		if (!cannoliData) {
			throw new Error("getEdgeDependencies: cannoliData is undefined");
		}

		const crossingOutGroups = cannoliData.crossingOutGroups;
		dependencies.push(...crossingOutGroups);

		return dependencies;
	}

	getNodeType(
		node:
			| CannoliCanvasFileData
			| CannoliCanvasLinkData
			| CannoliCanvasTextData
	): CallNodeType | ContentNodeType | FloatingNodeType | null {
		const indicatedType = this.getNodeIndicatedType(node);

		// If it's floating, return null
		if (indicatedType === IndicatedNodeType.Floating) {
			return FloatingNodeType.Variable;
		}
		// If it's content, call getContentNodeType
		else if (indicatedType === IndicatedNodeType.Content) {
			return this.getContentNodeType(node);
		} else if (indicatedType === IndicatedNodeType.Call) {
			const textNode = node as CannoliCanvasTextData;
			return this.getCallNodeType(textNode);
		} else {
			return null;
		}
	}

	getCallNodeType(vertex: CannoliCanvasTextData): CallNodeType | null {
		const incomingEdges = this.getIncomingEdges(vertex.id);
		const outgoingEdges = this.getOutgoingEdges(vertex.id);

		// If it has an incoming edge of type "merge"
		if (
			incomingEdges.some(
				(edge) => this.getEdgeType(edge) === EdgeType.Merge
			)
		) {
			// If it has an outgoing edge of type "category", it's a categorize node
			if (
				outgoingEdges.some(
					(edge) => this.getEdgeType(edge) === EdgeType.Category
				)
			) {
				return CallNodeType.Categorize;
			}
			// If it has an outgoing edge of type "choice"
			else if (
				outgoingEdges.some(
					(edge) => this.getEdgeType(edge) === EdgeType.Choice
				)
			) {
				// Get all outgoing choice edges
				const choiceEdges = outgoingEdges.filter(
					(edge) => this.getEdgeType(edge) === EdgeType.Choice
				);

				// Parse the labels of the choice edges
				const choiceLabels = choiceEdges.map((edge) =>
					this.parseEdgeLabel(edge)
				);

				// If the text in all choice labels are the same, its a select node
				if (choiceLabels.every((label) => label === choiceLabels[0])) {
					return CallNodeType.Select;
				} else {
					return CallNodeType.Choose;
				}
			}
			// If it has any outgoing key or list edges, it's a distribute node
			else if (
				outgoingEdges.some(
					(edge) =>
						this.getEdgeType(edge) === EdgeType.Key ||
						this.getEdgeType(edge) === EdgeType.List
				)
			) {
				return CallNodeType.Distribute;
			}
			// Otherwise, it's a standard call node
			else {
				return CallNodeType.StandardCall;
			}
		} else {
			// If it has any outgoing key or list edges, it's a distribute node
			if (
				outgoingEdges.some(
					(edge) =>
						this.getEdgeType(edge) === EdgeType.Key ||
						this.getEdgeType(edge) === EdgeType.List
				)
			) {
				return CallNodeType.Distribute;
			}
			// If it has any outgoing choice edges, it's a choose node
			else if (
				outgoingEdges.some(
					(edge) => this.getEdgeType(edge) === EdgeType.Choice
				)
			) {
				return CallNodeType.Choose;
			}
			// If it has any outgoing category edges, it's a categorize node
			else if (
				outgoingEdges.some(
					(edge) => this.getEdgeType(edge) === EdgeType.Category
				)
			) {
				return CallNodeType.Categorize;
			} else {
				return CallNodeType.StandardCall;
			}
		}
	}

	getContentNodeType(
		node:
			| CannoliCanvasFileData
			| CannoliCanvasLinkData
			| CannoliCanvasTextData
	): ContentNodeType | null {
		const incomingEdges = this.getIncomingEdges(node.id);

		// If its a file node, return reference
		if (node.type === "file") {
			return ContentNodeType.StaticReference;
		}

		let text = "";

		if (node.type === "text") {
			node = node as CannoliCanvasTextData;
			text = node.text;
		} else {
			node = node as CannoliCanvasLinkData;
			text = node.url;
		}

		// If its text starts and ends with a "`", and it doesn't start and end with "```", and it contains at least one "{" and one "}", it's a formatter node
		if (
			text.startsWith("`") &&
			text.endsWith("`") &&
			!text.startsWith("```") &&
			!text.endsWith("```") &&
			text.includes("{") &&
			text.includes("}")
		) {
			return ContentNodeType.Formatter;
		}

		// If doesnt have any incoming edges, return input
		if (incomingEdges.length === 0) {
			return ContentNodeType.Input;
		}

		// If the first line of the text starts with ">[[" and ends with "]]", or it starts with ">[" and ends with "]", it's a static reference node
		const firstLine = text.split("\n")[0];
		if (
			(firstLine.startsWith(">[[") && text.endsWith("]]")) ||
			(firstLine.startsWith(">[") && text.endsWith("]"))
		) {
			return ContentNodeType.StaticReference;
		}

		// Parse the incoming edges
		const incomingEdgeLabelInfo = incomingEdges.map((edge) =>
			this.parseEdgeLabel(edge)
		);

		// If any of the incoming edges have a non-null vault modifier, its a dynamic reference node
		if (
			incomingEdgeLabelInfo.some((labelInfo) => labelInfo?.vaultModifier)
		) {
			return ContentNodeType.DynamicReference;
		}

		// Otherwise, its a display node
		return ContentNodeType.Display;
	}

	getVertexKind(vertex: AllCannoliCanvasNodeData) {
		switch (vertex.type) {
			case "file":
				return CannoliObjectKind.Node;
			case "link":
				return CannoliObjectKind.Node;
			case "text":
				return CannoliObjectKind.Node;
			case "group":
				return CannoliObjectKind.Group;
		}
	}

	getNodeIndicatedType(
		vertex:
			| CannoliCanvasFileData
			| CannoliCanvasLinkData
			| CannoliCanvasTextData
	): IndicatedNodeType | null {
		if (!this.hasEdges(vertex.id)) {
			if (this.isFloatingNode(vertex.id)) {
				return IndicatedNodeType.Floating;
			} else {
				return null;
			}
		}

		switch (vertex.type) {
			case "file":
				return IndicatedNodeType.Content;
			case "link":
				return IndicatedNodeType.Content;
			case "text":
				if (vertex.color) {
					// Check against the node color map
					if (this.nodeColorMap[vertex.color]) {
						return this.nodeColorMap[vertex.color];
					}
				} else {
					return IndicatedNodeType.Call;
				}
		}

		return null;
	}

	getEdgeType(edge: CannoliCanvasEdgeData): EdgeType | null {
		if (edge.color) {
			// Check against the edge color map
			if (this.edgeColorMap[edge.color]) {
				// If the type from the map is choice, return the subtype
				if (this.edgeColorMap[edge.color] === EdgeType.Choice) {
					return this.getChoiceEdgeSubtype(edge);
				}
				// If the type from the color map is key, return the subtype
				else if (this.edgeColorMap[edge.color] === EdgeType.Key) {
					return this.getKeyEdgeSubtype(edge);
				}
				// If the type from the color map is config
				else if (this.edgeColorMap[edge.color] === EdgeType.Config) {
					// If the edge has a label, return config
					if (edge.label && edge.label.length > 0) {
						return EdgeType.Config;
					} else {
						// Otherwise, return logging
						return EdgeType.Logging;
					}
				}

				return this.edgeColorMap[edge.color];
			}
		} else if (edge.label && edge.label.length > 0) {
			// Check the first character against the edge prefix map
			if (this.edgePrefixMap[edge.label[0]]) {
				// If the type from the map is choice, return the subtype
				if (this.edgePrefixMap[edge.label[0]] === EdgeType.Choice) {
					return this.getChoiceEdgeSubtype(edge);
				}
				// If the type from the color map is key, return the subtype
				else if (this.edgePrefixMap[edge.label[0]] === EdgeType.Key) {
					return this.getKeyEdgeSubtype(edge);
				}
				// If the type from the color map is config
				else if (
					this.edgePrefixMap[edge.label[0]] === EdgeType.Config
				) {
					// If the length is greater than 1, return config
					if (edge.label.length > 1) {
						return EdgeType.Config;
					} else {
						// Otherwise, return logging
						return EdgeType.Logging;
					}
				}

				return this.edgePrefixMap[edge.label[0]];
			} else {
				return EdgeType.Variable;
			}
		} else if (!edge.label || edge.label.length === 0) {
			// Get the indicated type of the source and target nodes
			const sourceNode = this.getNode(edge.fromNode);
			const targetNode = this.getNode(edge.toNode);

			if (!sourceNode || !targetNode) {
				throw new Error("Edge source or target not found");
			}

			const sourceIndicatedType = this.getNodeIndicatedType(sourceNode);
			const targetIndicatedType = this.getNodeIndicatedType(targetNode);

			// If the source is a content node
			if (sourceIndicatedType === IndicatedNodeType.Content) {
				// If the target is a content node, return write
				if (targetIndicatedType === IndicatedNodeType.Content) {
					return EdgeType.Write;
				} else {
					// If the target is a call node, return SystemMessage
					return EdgeType.SystemMessage;
				}
			}
			// If the source is a call node
			else {
				// If the target is a content node, return write
				if (targetIndicatedType === IndicatedNodeType.Content) {
					return EdgeType.Write;
				} else {
					// If the target is a call node, return chat
					return EdgeType.Chat;
				}
			}
		}

		return null;
	}

	getChoiceEdgeSubtype(edge: CannoliCanvasEdgeData): EdgeType {
		const targetGroup = this.getGroup(edge.toNode);
		if (targetGroup) {
			// If the target is a forEach group, it's a category edge
			if (this.getGroupType(targetGroup) === GroupType.ForEach) {
				return EdgeType.Category;
			} else {
				return EdgeType.Choice;
			}
		} else {
			return EdgeType.Choice;
		}
	}

	getKeyEdgeSubtype(edge: CannoliCanvasEdgeData): EdgeType {
		const sourceGroup = this.getGroup(edge.fromNode);
		const targetGroup = this.getGroup(edge.toNode);

		// If the source is a forEach group or a repeat group, it's a merge edge
		if (
			sourceGroup &&
			(this.getGroupType(sourceGroup) === GroupType.ForEach ||
				this.getGroupType(sourceGroup) === GroupType.ForEach)
		) {
			return EdgeType.Merge;
		}
		// Check if the target is a forEach group
		else if (
			targetGroup &&
			this.getGroupType(targetGroup) === GroupType.ForEach
		) {
			return EdgeType.List;
		}

		return EdgeType.Key;
	}

	getGroupType(group: CannoliCanvasGroupData): GroupType {
		if (group.color) {
			// Check against the group color map
			if (this.groupColorMap[group.color]) {
				return this.groupColorMap[group.color];
			}
		}

		if (group.label) {
			// Check the first character against the group prefix map
			if (this.groupPrefixMap[group.label[0]]) {
				return this.groupPrefixMap[group.label[0]];
			}

			const labelInfo = this.parseGroupLabel(group);

			if (!labelInfo) {
				return GroupType.Basic;
			}

			// If isLoop is true
			if (labelInfo.isLoop) {
				return GroupType.Repeat;
			} else {
				return GroupType.Basic;
			}
		}

		return GroupType.Basic;
	}

	getEdge(id: string): CannoliCanvasEdgeData | undefined {
		return this.cannoliData.edges.find((edge) => edge.id === id);
	}

	getVertex(id: string): AllCannoliCanvasNodeData | undefined {
		return this.cannoliData.nodes.find((node) => node.id === id);
	}

	getNode(
		id: string
	):
		| CannoliCanvasFileData
		| CannoliCanvasLinkData
		| CannoliCanvasTextData
		| undefined {
		const node = this.cannoliData.nodes.find((node) => node.id === id);
		if (
			node?.type === "file" ||
			node?.type === "text" ||
			node?.type === "link"
		) {
			return node;
		} else {
			return undefined;
		}
	}

	getGroup(id: string): CannoliCanvasGroupData | undefined {
		const group = this.cannoliData.nodes.find((group) => group.id === id);
		if (group?.type === "group") {
			return group;
		}
	}

	parseEdgeLabel(edge: CannoliCanvasEdgeData): {
		text: string;
		vaultModifier: VaultModifier | null;
		addMessages: boolean | null;
	} | null {
		if (!edge.label) {
			return null;
		}

		let text = edge.label;
		let vaultModifier: VaultModifier | null = null;
		let addMessages: boolean | null = null;

		// If the label starts with a vault modifier from the map, set the vault modifier and remove it from the label. The vault modifier can be 1 or 2 characters long.
		if (this.vaultModifierMap[edge.label[0]]) {
			vaultModifier = this.vaultModifierMap[edge.label[0]];
			text = text.slice(1);
		} else if (this.vaultModifierMap[edge.label.slice(0, 2)]) {
			vaultModifier = this.vaultModifierMap[edge.label.slice(0, 2)];
			text = text.slice(2);
		}

		// If the last character is in the add messages map, set add messages to the corresponding bool value and remove it from the label
		if (this.addMessagesModifierMap[edge.label[edge.label.length - 1]]) {
			addMessages =
				this.addMessagesModifierMap[edge.label[edge.label.length - 1]];
			text = text.slice(0, -1);
		}

		return {
			text,
			vaultModifier,
			addMessages,
		};
	}

	parseGroupLabel(group: CannoliCanvasGroupData): {
		isLoop: boolean;
		text: string;
		completedNumber: number | null;
		totalNumber: number | null;
	} | null {
		let isLoop = false;
		let text = group.label;
		let completedNumber: number | null = null;
		let totalNumber: number | null = null;

		if (!text) {
			return null;
		}

		// If the label starts with a prefix from the map, remove it from the label
		if (this.groupPrefixMap[text[0]]) {
			text = text.slice(1);
		}

		// If the text is a fraction of positive integers, set the completed and total numbers
		if (text.includes("/")) {
			const splitText = text.split("/");
			if (
				Number.isInteger(+splitText[0]) &&
				Number.isInteger(+splitText[1])
			) {
				isLoop = true;
				completedNumber = +splitText[0];
				totalNumber = +splitText[1];
			}
		}
		// If the text is a positive integer, set the total number to that, and the completed number to 0
		else if (Number.isInteger(+text)) {
			isLoop = true;
			completedNumber = 0;
			totalNumber = +text;
		}

		return {
			isLoop,
			text,
			completedNumber,
			totalNumber,
		};
	}

	parseNodeReferences(node: CannoliCanvasTextData): Reference[] {
		const regex = /\{\[\[(.+?)\]\]\}|\{\[(.+?)\]\}|{{(.+?)}}|{(.+?)}/g;
		let match: RegExpExecArray | null;
		const references: Reference[] = [];
		let textCopy = node.text;

		while ((match = regex.exec(textCopy)) !== null) {
			let name = "";
			let type: ReferenceType = ReferenceType.Variable;
			let shouldExtract = false;

			if (match[1]) {
				type = ReferenceType.Note;
				name = match[1];
				shouldExtract = true;
			} else if (match[2]) {
				type = ReferenceType.Floating;
				name = match[2];
				shouldExtract = true;
			} else if (match[3] || match[4]) {
				name = match[3] || match[4];
				shouldExtract = !!match[3];
			}

			const reference: Reference = {
				name,
				type,
				shouldExtract,
			};
			references.push(reference);
			textCopy = textCopy.replace(match[0], `{${references.length - 1}}`);
		}

		return references;
	}

	getIncomingEdges(id: string): CannoliCanvasEdgeData[] {
		return this.cannoliData.edges.filter(
			(edge) => edge.toNode === id && this.isValidEdge(edge)
		);
	}

	getOutgoingEdges(id: string): CannoliCanvasEdgeData[] {
		// Filter out non-logic edges
		return this.cannoliData.edges.filter(
			(edge) => edge.fromNode === id && this.isValidEdge(edge)
		);
	}

	hasEdges(id: string): boolean {
		if (
			this.getIncomingEdges(id).length > 0 ||
			this.getOutgoingEdges(id).length > 0
		) {
			return true;
		} else {
			return false;
		}
	}

	isValidEdge(edge: CannoliCanvasEdgeData): boolean {
		// If the edge has fromEnd and toEnd set to "none"
		if (edge.fromEnd === "none" && edge.toEnd === "none") {
			return false;
		} else {
			return true;
		}
	}

	isFloatingNode(id: string): boolean {
		const node = this.getNode(id);
		// Check if the first line starts with [ and ends with ]
		const firstLine = node?.text?.split("\n")[0];
		if (firstLine?.startsWith("[") && firstLine?.endsWith("]")) {
			return true;
		} else {
			return false;
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

	getGroupsForVertex(vertex: AllCannoliCanvasNodeData): string[] {
		const groups: CannoliCanvasGroupData[] = [];
		const currentVertexRectangle = this.createRectangle(
			vertex.x,
			vertex.y,
			vertex.width,
			vertex.height
		);

		// Get all groups
		const allGroups = this.cannoliData.nodes.filter(
			(node) =>
				this.getVertexKind(node) === CannoliObjectKind.Group &&
				node.id !== vertex.id
		);

		// Iterate through all vertices
		for (const group of allGroups) {
			const groupRectangle = this.createRectangle(
				group.x,
				group.y,
				group.width,
				group.height
			);

			// If the group encloses the current vertex, add it to the groups
			if (this.encloses(groupRectangle, currentVertexRectangle)) {
				groups.push(group as CannoliCanvasGroupData); // Type cast as CannoliGroup for clarity
			}
		}

		// Sort the groups from smallest to largest (from immediate parent to most distant)
		groups.sort((a, b) => {
			const aArea = a.width * a.height;
			const bArea = b.width * b.height;

			return aArea - bArea;
		});

		return groups.map((group) => group.id);
	}

	getMembersForGroup(group: CannoliCanvasGroupData): string[] {
		const members: string[] = [];
		const currentGroupRectangle = this.createRectangle(
			group.x,
			group.y,
			group.width,
			group.height
		);

		// Iterate through all vertices except the group itself
		for (const vertex of this.cannoliData.nodes) {
			// Skip the group itself
			if (vertex.id === group.id) {
				continue;
			}
			const vertexRectangle = this.createRectangle(
				vertex.x,
				vertex.y,
				vertex.width,
				vertex.height
			);

			// If the vertex is enclosed by the current group, add it to the members
			if (this.encloses(currentGroupRectangle, vertexRectangle)) {
				members.push(vertex.id);
			}
		}

		return members;
	}

	getCrossingGroups(edge: CannoliCanvasEdgeData): {
		crossingOutGroups: string[];
		crossingInGroups: string[];
	} | null {
		// Get the source and target vertices
		const source = this.getVertex(edge.fromNode);
		const target = this.getVertex(edge.toNode);

		// If either vertex is null, throw an error
		if (!source || !target) {
			throw new Error("Source or target vertex is null");
		}

		// If the source or target don't have cannoliData, throw an error
		if (!source.cannoliData || !target.cannoliData) {
			throw new Error(
				"Source or target vertex does not have cannoliData"
			);
		}

		// Initialize crossingOutGroups and crossingInGroups
		let crossingOutGroups: CannoliCanvasGroupData[] = [];
		let crossingInGroups: CannoliCanvasGroupData[] = [];

		// Initialize sourceGroups and targetGroups by mapping the group ids to the group data
		const sourceGroups: CannoliCanvasGroupData[] =
			source.cannoliData.groups.map(
				(groupId) => this.getVertex(groupId) as CannoliCanvasGroupData
			);
		const targetGroups: CannoliCanvasGroupData[] =
			target.cannoliData.groups.map(
				(groupId) => this.getVertex(groupId) as CannoliCanvasGroupData
			);

		// Find the first shared group
		const sharedGroup = sourceGroups.find((group: CannoliCanvasGroupData) =>
			targetGroups.includes(group)
		);

		// Handle case where no shared group is found
		if (sharedGroup === undefined) {
			crossingOutGroups = [...sourceGroups];
			crossingInGroups = [...targetGroups].reverse();
		} else {
			// Set crossingOutGroups
			const sourceIndex = sourceGroups.indexOf(sharedGroup);
			crossingOutGroups = sourceGroups.slice(0, sourceIndex);

			// Set crossingInGroups
			const targetIndex = targetGroups.indexOf(sharedGroup);
			const tempCrossingInGroups = targetGroups.slice(0, targetIndex);
			crossingInGroups = tempCrossingInGroups.reverse();
		}

		// Check if the target is a member of the source group, if so remove the first group from crossingInGroups
		const sourceAsGroup = this.getGroup(target.id);
		if (sourceAsGroup) {
			if (targetGroups.includes(sourceAsGroup)) {
				crossingInGroups.shift();
			}
		}

		// Check if the source is a member of the target group, if so remove the last group from crossingOutGroups
		const targetAsGroup = this.getGroup(source.id);
		if (targetAsGroup) {
			if (sourceGroups.includes(targetAsGroup)) {
				crossingOutGroups.pop();
			}
		}

		// Return crossingOutGroups and crossingInGroups as arrays of ids
		return {
			crossingOutGroups: crossingOutGroups.map((group) => group.id),
			crossingInGroups: crossingInGroups.map((group) => group.id),
		};
	}

	isReflexive(edge: CannoliCanvasEdgeData): boolean {
		// If the source is a group that contains the target, return true
		const source = this.getVertex(edge.fromNode);
		const target = this.getVertex(edge.toNode);

		if (!source || !target) {
			throw new Error("Source or target vertex is null");
		}

		if (!source.cannoliData || !target.cannoliData) {
			throw new Error(
				"Source or target vertex does not have cannoliData"
			);
		}

		// If the source is a group that contains the target, return true
		if (target.cannoliData.groups.includes(source.id)) {
			return true;
		}

		// If the target is a group that contains the source, return true
		if (source.cannoliData.groups.includes(target.id)) {
			return true;
		}

		return false;
	}
}
