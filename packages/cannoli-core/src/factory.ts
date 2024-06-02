import { CanvasData } from "./canvas_interface";
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
	VerifiedCannoliCanvasGroupData,
	AllVerifiedCannoliCanvasNodeData,
	VerifiedCannoliCanvasEdgeData,
	CannoliArgs,
	CannoliRunSettings,
} from "./models/graph";

export enum IndicatedNodeType {
	Call = "call",
	Content = "content",
	Floating = "floating",
}

export class CannoliFactory {
	cannoliData: CannoliCanvasData;
	currentNote: string;

	vaultModifierMap: Record<string, VaultModifier> = {
		"[": VaultModifier.Note,
		"/": VaultModifier.Folder,
		":": VaultModifier.Property,
	};

	nodeColorMap: Record<string, IndicatedNodeType> = {
		undefined: IndicatedNodeType.Call,
		"0": IndicatedNodeType.Call,
		"1": IndicatedNodeType.Call,
		"2": IndicatedNodeType.Content,
		"3": IndicatedNodeType.Call,
		"4": IndicatedNodeType.Call,
		"6": IndicatedNodeType.Content,
	};

	edgePrefixMap: Record<string, EdgeType> = {
		"*": EdgeType.Config,
		"?": EdgeType.Choice,
		"@": EdgeType.ChatConverter,
		"<": EdgeType.List,
		"=": EdgeType.Field,
	};

	edgeColorMap: Record<string, EdgeType> = {
		"2": EdgeType.Config,
		"3": EdgeType.Choice,
		"4": EdgeType.ChatConverter,
		"5": EdgeType.List,
		"6": EdgeType.Field,
	};

	addMessagesModifierMap: Record<string, boolean> = {
		"|": true,
		"~": false,
	};

	defaultAddMessagesMap: Record<EdgeType, boolean> = {
		[EdgeType.Choice]: true,
		[EdgeType.Chat]: true,
		[EdgeType.SystemMessage]: true,
		[EdgeType.ChatConverter]: true,

		[EdgeType.Config]: false,
		[EdgeType.Field]: false,
		[EdgeType.List]: false,
		[EdgeType.Variable]: false,
		[EdgeType.Item]: false,
		[EdgeType.Logging]: false,
		[EdgeType.Write]: false,
		[EdgeType.ChatResponse]: false,
	};

	groupPrefixMap: Record<string, GroupType> = {
		"<": GroupType.SignifiedForEach,
	};

	groupColorMap: Record<string, GroupType> = {
		"5": GroupType.SignifiedForEach,
	};

	constructor(
		canvas: CanvasData,
		settings: CannoliRunSettings,
		args?: CannoliArgs
	) {
		// Cast the canvas to a CannoliCanvasData
		const cannoliCanvasData = canvas as CannoliCanvasData;

		// Add the settings and args to the canvas
		cannoliCanvasData.settings = settings;
		cannoliCanvasData.args = args;

		this.cannoliData = cannoliCanvasData;
		this.currentNote = args?.currentNote ?? "No active note";


		// If contentIsColorless setting is true, change the node map so that "0" corresponds to "content" and "6" corresponds to "call"
		if (settings.contentIsColorless) {
			this.nodeColorMap = {
				undefined: IndicatedNodeType.Content,
				"0": IndicatedNodeType.Content,
				"1": IndicatedNodeType.Call,
				"2": IndicatedNodeType.Content,
				"3": IndicatedNodeType.Call,
				"4": IndicatedNodeType.Call,
				"6": IndicatedNodeType.Call,
			};
		}
	}

	getCannoliData(): VerifiedCannoliCanvasData {
		const addedEdges: CannoliCanvasEdgeData[] = [];

		// Look for multi-edges
		this.cannoliData.edges.forEach((edge) => {
			// Ignore red ("1") objects
			if (edge.color === "1") {
				return;
			}

			// If there are newlines in the edge text, split by line, then make copies of the edge for each line and add them to the addedEdges array
			if (edge.label && edge.label.includes("\n")) {
				const lines = edge.label.split("\n");
				lines.forEach((line) => {
					const newEdge = this.duplicateObject(edge, `${edge.id}-${line}`) as CannoliCanvasEdgeData;
					newEdge.label = line;
					addedEdges.push(newEdge);
				});
			}
		});

		// Add the added edges to the canvas
		this.cannoliData.edges.push(...addedEdges);

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

		// Filter out objects that don't have cannoliData
		let verifiedCannoliData: CannoliCanvasData = {
			nodes: this.cannoliData.nodes.filter((node) => !!node.cannoliData),
			edges: this.cannoliData.edges.filter((edge) => !!edge.cannoliData),
			settings: this.cannoliData.settings,
			args: this.cannoliData.args,
		};

		// Create forEach duplicates
		verifiedCannoliData = this.createForEachDuplicates(
			verifiedCannoliData as VerifiedCannoliCanvasData
		);

		// Set all dependencies
		for (const node of verifiedCannoliData.nodes) {
			if (node.cannoliData) {
				node.cannoliData.dependencies = this.getVertexDependencies(
					node,
					verifiedCannoliData as VerifiedCannoliCanvasData
				);
			}
		}

		for (const edge of verifiedCannoliData.edges) {
			if (edge.cannoliData) {
				edge.cannoliData.dependencies = this.getEdgeDependencies(edge);
			}
		}

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

			// Then, prepend "{{[[" and append "]]}}" to the text to match the file reference format
			universalText = `{{[[${universalText}]]}}`;
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
			node.type === "text" || node.type === "file"
				? this.parseNodeReferences(node)
				: [];
		const groups = this.getGroupsForVertex(node);
		const dependencies = [] as string[];
		const originalObject = null;
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
			groups,
			dependencies,
			originalObject,
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
		const groups = this.getGroupsForVertex(group);

		const dependencies = [] as string[];
		const status =
			type === GroupType.Basic
				? CannoliObjectStatus.Complete
				: CannoliObjectStatus.Pending;

		const genericProps: CannoliGroupData = {
			kind,
			type,
			text,
			groups,
			dependencies,
			status,
			originalObject: null,
		};

		if (type === GroupType.Repeat || type === GroupType.SignifiedForEach) {
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

		let addMessages = false;

		if (type) {
			// Find the default addMessages override using the map against the type
			addMessages = this.defaultAddMessagesMap[type];
		}

		addMessages =
			labelInfo?.addMessages !== undefined &&
				labelInfo?.addMessages !== null
				? labelInfo.addMessages
				: addMessages;
		const dependencies = [] as string[];
		const originalObject = null;
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
			originalObject,
			crossingInGroups,
			crossingOutGroups,
			status,
			isReflexive,
			vaultModifier,
		};
	}

	createForEachDuplicates(
		data: VerifiedCannoliCanvasData
	): VerifiedCannoliCanvasData {
		// Sort groups by depth (deepest first)
		const groups = data.nodes
			.filter((node) => node.cannoliData.kind === CannoliObjectKind.Group)
			.sort((a, b) => b.cannoliData.groups.length - a.cannoliData.groups.length);

		// For each group of type "signified-for-each", create a duplicate group
		for (const group of groups) {
			// For each group
			if (group.cannoliData.kind === CannoliObjectKind.Group) {
				const originalId = group.id;

				// For each group of type "signified-for-each"
				if (group.cannoliData.type === GroupType.SignifiedForEach) {
					const castGroup = group as VerifiedCannoliCanvasGroupData;

					if (!castGroup || !castGroup.cannoliData.maxLoops) {
						throw new Error(
							"createForEachDuplicates: castGroup is undefined or castGroup.cannoliData.maxLoops is undefined"
						);
					}

					// Get group incoming and outgoing edges from the canvas
					const incomingEdges = data.edges.filter(
						(edge) => edge.toNode === castGroup.id
					);

					const outgoingEdges = data.edges.filter(
						(edge) => edge.fromNode === castGroup.id
					);

					// Get group crossingInEdges, crossingOutEdges, and internalEdges
					const { crossingInEdges, crossingOutEdges, internalEdges } =
						this.getCrossingAndInternalEdges(castGroup, data);


					const subGroups = data.nodes.filter(
						(node) => node.cannoliData.groups.includes(group.id) && node.cannoliData.kind === CannoliObjectKind.Group
					) as VerifiedCannoliCanvasGroupData[];

					const members = data.nodes.filter(
						(node) => node.cannoliData.groups.includes(group.id)
					) as AllVerifiedCannoliCanvasNodeData[];

					// Create the number of duplicates called for in the maxLoops property
					for (let i = 0; i < castGroup.cannoliData.maxLoops; i++) {
						// Create a duplicate group and its members and edges
						this.createDuplicateGroup(
							group as VerifiedCannoliCanvasGroupData,
							i + 1,
							incomingEdges,
							outgoingEdges,
							crossingInEdges,
							crossingOutEdges,
							internalEdges,
							subGroups,
							members,
							data
						);
					}

					// Remove the original group and its members and edges from the canvas
					data.nodes = data.nodes.filter(
						(node) =>
							// If the node is not the original group
							node.id !== originalId &&
							// If the node is not in the members array
							!members.some((member) => member.id === node.id)
					);

					data.edges = data.edges.filter(
						(edge) =>
							!incomingEdges.includes(edge) &&
							!outgoingEdges.includes(edge) &&
							!crossingInEdges.includes(edge) &&
							!crossingOutEdges.includes(edge) &&
							!internalEdges.includes(edge)
					);
				}
			}
		}

		return data;
	}

	createDuplicateGroup(
		originalGroup: VerifiedCannoliCanvasGroupData,
		index: number,
		incomingEdges: VerifiedCannoliCanvasEdgeData[],
		outgoingEdges: VerifiedCannoliCanvasEdgeData[],
		crossingInEdges: VerifiedCannoliCanvasEdgeData[],
		crossingOutEdges: VerifiedCannoliCanvasEdgeData[],
		internalEdges: VerifiedCannoliCanvasEdgeData[],
		subGroups: VerifiedCannoliCanvasGroupData[],
		members: AllVerifiedCannoliCanvasNodeData[],
		data: VerifiedCannoliCanvasData
	): void {
		const duplicateGroup = this.duplicateObject(originalGroup, `${originalGroup.id}-${index}`) as VerifiedCannoliCanvasGroupData;
		duplicateGroup.cannoliData.currentLoop = index;
		duplicateGroup.cannoliData.type = GroupType.Basic;
		duplicateGroup.cannoliData.fromForEach = true;
		duplicateGroup.cannoliData.originalObject = originalGroup.id;

		const duplicateIncomingEdges = incomingEdges.map((edge) => this.duplicateObject(edge, `${edge.id}-${index}`) as VerifiedCannoliCanvasEdgeData);
		duplicateIncomingEdges.forEach((edge) => {
			edge.toNode = duplicateGroup.id;
			// If its a list node, change the type of the edge to item
			if (edge.cannoliData.type === EdgeType.List) {
				edge.cannoliData.type = EdgeType.Item;
			}
		});

		const duplicateOutgoingEdges = outgoingEdges.map((edge) => this.duplicateObject(edge, `${edge.id}-${index}`) as VerifiedCannoliCanvasEdgeData);
		duplicateOutgoingEdges.forEach((edge) => {
			edge.fromNode = duplicateGroup.id;
		});

		const duplicateCrossingInEdges = crossingInEdges.map((edge) => this.duplicateObject(edge, `${edge.id}-${index}`) as VerifiedCannoliCanvasEdgeData);

		// Add the index to the toNode of the duplicate crossingInEdges
		duplicateCrossingInEdges.forEach((edge) => {
			edge.toNode = `${edge.toNode}-${index}`;
		});

		const duplicateCrossingOutEdges = crossingOutEdges.map((edge) => this.duplicateObject(edge, `${edge.id}-${index}`) as VerifiedCannoliCanvasEdgeData);

		// Push the index onto the versions array of each crossing out edge
		duplicateCrossingOutEdges.forEach((edge) => {
			if (!edge.cannoliData.versions) {
				edge.cannoliData.versions = [];
			}
			edge.cannoliData.versions.push({
				version: index,
				header: null,
				subHeader: null,
			});
		});

		// Add the index to the fromNode of the duplicate crossingOutEdges
		duplicateCrossingOutEdges.forEach((edge) => {
			edge.fromNode = `${edge.fromNode}-${index}`;
		});

		const duplicateInternalEdges = internalEdges.map((edge) => this.duplicateObject(edge, `${edge.id}-${index}`) as VerifiedCannoliCanvasEdgeData);


		// Add the index to both ends, and all of the crossing in and out groups
		duplicateInternalEdges.forEach((edge) => {
			edge.fromNode = `${edge.fromNode}-${index}`;
			edge.toNode = `${edge.toNode}-${index}`;
			edge.cannoliData.crossingInGroups = edge.cannoliData.crossingInGroups.map((groupId) => `${groupId}-${index}`);
			edge.cannoliData.crossingOutGroups = edge.cannoliData.crossingOutGroups.map((groupId) => `${groupId}-${index}`);
		});

		const duplicateMembers = members.map((member) => this.duplicateObject(member, `${member.id}-${index}`) as AllVerifiedCannoliCanvasNodeData);

		duplicateMembers.forEach((member) => {
			// For each subgroup, check each member's groups array. If the subgroup is present, replace it with the duplicate group id
			for (const subGroup of subGroups) {
				if (member.cannoliData.groups.includes(subGroup.id)) {
					member.cannoliData.groups = member.cannoliData.groups.map((groupId) => groupId === subGroup.id ? `${groupId}-${index}` : groupId);
				}
			}
			// replace the original group id with the duplicate group id
			member.cannoliData.groups = member.cannoliData.groups.map((groupId) => groupId === originalGroup.id ? `${groupId}-${index}` : groupId);
		});

		duplicateCrossingInEdges.forEach((edge) => {
			// For each subgroup, check each member's groups array. If the subgroup is present, replace it with the duplicate group id
			for (const subGroup of subGroups) {
				if (edge.cannoliData.crossingInGroups.includes(subGroup.id)) {
					edge.cannoliData.crossingInGroups = edge.cannoliData.crossingInGroups.map((groupId) => groupId === subGroup.id ? `${groupId}-${index}` : groupId);
				}
			}
			// replace the original group id with the duplicate group id
			edge.cannoliData.crossingInGroups = edge.cannoliData.crossingInGroups.map((groupId) => groupId === originalGroup.id ? `${groupId}-${index}` : groupId);
		});

		duplicateCrossingOutEdges.forEach((edge) => {
			// For each subgroup, check each member's groups array. If the subgroup is present, replace it with the duplicate group id
			for (const subGroup of subGroups) {
				if (edge.cannoliData.crossingOutGroups.includes(subGroup.id)) {
					edge.cannoliData.crossingOutGroups = edge.cannoliData.crossingOutGroups.map((groupId) => groupId === subGroup.id ? `${groupId}-${index}` : groupId);
				}
			}
			// replace the original group id with the duplicate group id
			edge.cannoliData.crossingOutGroups = edge.cannoliData.crossingOutGroups.map((groupId) => groupId === originalGroup.id ? `${groupId}-${index}` : groupId);
		});

		data.nodes.push(duplicateGroup);
		data.edges.push(...duplicateIncomingEdges);
		data.edges.push(...duplicateOutgoingEdges);
		data.edges.push(...duplicateCrossingInEdges);
		data.edges.push(...duplicateCrossingOutEdges);
		data.edges.push(...duplicateInternalEdges);
		data.nodes.push(...duplicateMembers);
	}

	duplicateObject(data: unknown, newId: string) {
		const duplicate = JSON.parse(JSON.stringify(data));
		duplicate.id = newId;
		return duplicate;
	}

	getCrossingAndInternalEdges(
		group: VerifiedCannoliCanvasGroupData,
		canvas: VerifiedCannoliCanvasData
	): {
		crossingInEdges: VerifiedCannoliCanvasEdgeData[];
		crossingOutEdges: VerifiedCannoliCanvasEdgeData[];
		internalEdges: VerifiedCannoliCanvasEdgeData[];
	} {
		// Initialize the lists
		const crossingInEdges: VerifiedCannoliCanvasEdgeData[] = [];
		const crossingOutEdges: VerifiedCannoliCanvasEdgeData[] = [];
		const internalEdges: VerifiedCannoliCanvasEdgeData[] = [];
		const processedEdges = new Set<string>();

		// For each member
		const members = getGroupMembersFromData(group.id, canvas);
		for (const member of members) {
			// For each incoming edge
			for (const edgeId of getIncomingEdgesFromData(member, canvas)) {
				if (processedEdges.has(edgeId)) continue;
				processedEdges.add(edgeId);

				const edgeData = canvas.edges.find(
					(edge) => edge.id === edgeId
				) as VerifiedCannoliCanvasEdgeData;

				// If it's crossing in
				if (edgeData.cannoliData.crossingInGroups.includes(group.id)) {
					// Add it to the list
					crossingInEdges.push(edgeData);
				} else {
					// Otherwise, it's internal
					internalEdges.push(edgeData);
				}
			}

			// For each outgoing edge
			for (const edgeId of getOutgoingEdgesFromData(member, canvas)) {
				if (processedEdges.has(edgeId)) continue;
				processedEdges.add(edgeId);

				const edgeData = canvas.edges.find(
					(edge) => edge.id === edgeId
				) as VerifiedCannoliCanvasEdgeData;

				// If it's crossing out
				if (edgeData.cannoliData.crossingOutGroups.includes(group.id)) {
					// Add it to the list
					crossingOutEdges.push(edgeData);
				} else {
					// Otherwise, it's internal
					internalEdges.push(edgeData);
				}
			}
		}

		return {
			crossingInEdges,
			crossingOutEdges,
			internalEdges,
		};
	}

	getVertexDependencies(
		vertex: AllCannoliCanvasNodeData,
		data: VerifiedCannoliCanvasData
	): string[] {
		// Initialize the dependencies array
		const dependencies = [] as string[];

		// For each incoming edge, check if it is reflexive and add it if its not
		const incomingEdges = getIncomingEdgesFromData(vertex.id, data);

		if (!incomingEdges) {
			throw new Error(
				"setVertexDependencies: vertex.cannoliData.incomingEdges is undefined"
			);
		}

		incomingEdges.forEach((edge) => {
			const edgeData = data.edges.find(
				(edgeData) => edgeData.id === edge
			) as VerifiedCannoliCanvasEdgeData;

			if (!edgeData) {
				throw new Error("setVertexDependencies: edgeData is undefined");
			}

			if (!edgeData.cannoliData) {
				return;
			}

			// if (edgeData.cannoliData.isReflexive) {
			// 	return;
			// } else {
			dependencies.push(edge);
			// }
		});

		// For each incoming edge of each group in groups, check if it is reflexive and add it if its not
		const groups = vertex.cannoliData?.groups;
		groups?.forEach((group) => {
			const groupData = data.nodes.find(
				(groupData) => groupData.id === group
			) as VerifiedCannoliCanvasGroupData;
			if (!groupData) {
				throw new Error(
					`setVertexDependencies: groupData for ${vertex.id} is undefined in:\n${JSON.stringify(data, null, 2)}`
				);
			}

			const incomingEdges = getIncomingEdgesFromData(group, data);

			if (!incomingEdges) {
				throw new Error(
					"setVertexDependencies: group.cannoliData.incomingEdges is undefined"
				);
			}

			incomingEdges.forEach((edge) => {
				const edgeData = data.edges.find(
					(edgeData) => edgeData.id === edge
				) as VerifiedCannoliCanvasEdgeData;
				if (!edgeData) {
					throw new Error(
						"setVertexDependencies: edgeData is undefined"
					);
				}

				if (!edgeData.cannoliData) {
					return;
				}

				if (edgeData.cannoliData.isReflexive) {
					return;
				} else {
					dependencies.push(edge);
				}
			});
		});

		// If the vertex is a group, add all of its members as dependencies
		if (vertex.cannoliData?.kind === CannoliObjectKind.Group) {
			const group = vertex as CannoliCanvasGroupData;
			const members = getGroupMembersFromData(group.id, data);
			// Filter for members that exist in the data
			const existingMembers = members?.filter((member) =>
				data.nodes.some((node) => node.id === member)
			);

			if (existingMembers) {
				dependencies.push(...existingMembers);
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
		const outgoingEdges = this.getOutgoingEdges(vertex.id);
		// If it has any outgoing field or list edges, it's a form node
		if (
			outgoingEdges.some(
				(edge) =>
					this.getEdgeType(edge) === EdgeType.Field
			)
		) {
			return CallNodeType.Form;
		}
		// If it has any outgoing choice edges, it's a choose node
		else if (
			outgoingEdges.some(
				(edge) => this.getEdgeType(edge) === EdgeType.Choice
			)
		) {
			return CallNodeType.Choose;
		}
		else {
			return CallNodeType.StandardCall;
		}

	}

	getContentNodeType(
		node:
			| CannoliCanvasFileData
			| CannoliCanvasLinkData
			| CannoliCanvasTextData
	): ContentNodeType | null {
		// If its a file node, return reference
		if (node.type === "file") {
			return ContentNodeType.Reference;
		}

		let text = "";

		if (node.type === "text") {
			node = node as CannoliCanvasTextData;
			text = node.text;
		} else {
			node = node as CannoliCanvasLinkData;
			text = node.url;
		}

		// If its color is "2", return http
		if (node.color === "2") {
			return ContentNodeType.Http;
		}

		// If its text starts and ends with double double quotes, it's a formatter node
		if (text.startsWith('""') && text.endsWith('""')) {
			return ContentNodeType.Formatter;
		}

		// If the text starts with {{ and ends with }}, and doesnt have any newlines, and only contains one instance of {{ and }} it's a reference node
		if (
			text.trim().startsWith("{{") &&
			text.trim().endsWith("}}") &&
			!text.trim().includes("\n") &&
			text.trim().split("{{").length === 2 &&
			text.trim().split("}}").length === 2
		) {
			return ContentNodeType.Reference;
		}

		// If it has no incoming edges, it's an input node
		if (this.getIncomingEdges(node.id).length === 0) {
			return ContentNodeType.Input;
		}
		// If it has no outgoing edges, it's an output node
		if (this.getOutgoingEdges(node.id).length === 0) {
			return ContentNodeType.Output;
		}

		return ContentNodeType.StandardContent;
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
				if (!vertex.color) {
					vertex.color = undefined;
				}
				// Check against the node color map
				// @ts-expect-error
				if (this.nodeColorMap[vertex.color]) {
					// @ts-expect-error
					return this.nodeColorMap[vertex.color || undefined];
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
					return EdgeType.Choice;
				}
				// If the type from the color map is field, return the subtype
				else if (this.edgeColorMap[edge.color] === EdgeType.Field) {
					// return this.getKeyEdgeSubtype(edge);
					return EdgeType.Field;
				}
				// If the type from the color map is chatconverter, return the subtype
				else if (
					this.edgeColorMap[edge.color] === EdgeType.ChatConverter
				) {
					// If the source is a call node and the target is a content node, return chatResponse

					const sourceNode = this.getNode(edge.fromNode);
					const targetNode = this.getNode(edge.toNode);
					if (
						sourceNode &&
						this.getNodeIndicatedType(sourceNode) ===
						IndicatedNodeType.Call &&
						targetNode &&
						this.getNodeIndicatedType(targetNode) ===
						IndicatedNodeType.Content
					) {
						return EdgeType.ChatResponse;
					} else {
						// Otherwise, return chatConverter
						return EdgeType.ChatConverter;
					}
				}
				// If the type from the color map is config
				else if (this.edgeColorMap[edge.color] === EdgeType.Config) {
					// If the edge has a label
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
					return EdgeType.Choice;
				}
				// If the type from the color map is key, return the subtype
				else if (this.edgePrefixMap[edge.label[0]] === EdgeType.Field) {
					return EdgeType.Field;
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
			const sourceNode = this.getVertex(edge.fromNode);
			const targetNode = this.getVertex(edge.toNode);

			if (!sourceNode || !targetNode) {
				throw new Error(
					`Edge: ${edge.label} source or target not found`
				);
			}

			if (
				// @ts-expect-error: kind is not a property of CannoliCanvasGroupData
				sourceNode.kind === CannoliObjectKind.Group ||
				// @ts-expect-error: kind is not a property of CannoliCanvasGroupData
				targetNode.kind === CannoliObjectKind.Group
			) {
				return EdgeType.Chat;
			}

			const sourceIndicatedType = this.getNodeIndicatedType(
				sourceNode as
				| CannoliCanvasFileData
				| CannoliCanvasLinkData
				| CannoliCanvasTextData
			);
			const targetIndicatedType = this.getNodeIndicatedType(
				targetNode as
				| CannoliCanvasFileData
				| CannoliCanvasLinkData
				| CannoliCanvasTextData
			);

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
		if (
			this.addMessagesModifierMap[edge.label[edge.label.length - 1]] !==
			undefined
		) {
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

	parseNodeReferences(
		node: CannoliCanvasTextData | CannoliCanvasFileData
	): Reference[] {
		// Unified regex to capture any type of reference within double curly braces
		const unifiedPattern = /{{(.*?)}}/g;

		const references: Reference[] = [];
		const textCopy = node.text;
		let match: RegExpExecArray | null;

		while (textCopy && (match = unifiedPattern.exec(textCopy)) !== null) {
			const content = match[1];
			const reference: Reference = {
				name: "",
				type: ReferenceType.Variable, // default type
				shouldExtract: false,
			};

			let innerMatch: RegExpExecArray | null;
			if ((innerMatch = /^NOTE([\W]*)$/.exec(content))) {
				// Special "NOTE" reference
				reference.type = ReferenceType.Note;
				reference.shouldExtract = false;
				reference.name = this.currentNote;
				this.handleModifiers(reference, innerMatch[1]);
			} else if ((innerMatch = /^SELECTION([\W]*)$/.exec(content))) {
				// Special "SELECTION" reference
				reference.type = ReferenceType.Selection;
				reference.shouldExtract = false;
				reference.name = "SELECTION";
				this.handleModifiers(reference, innerMatch[1]);
			} else if ((innerMatch = /^\[\[(.*?)\]\]([\W]*)$/.exec(content))) {
				// Note reference
				reference.type = ReferenceType.Note;
				reference.shouldExtract = true;
				reference.name = innerMatch[1];
				this.handleModifiers(reference, innerMatch[2]);
			} else if ((innerMatch = /^\[(.*?)\]$/.exec(content))) {
				// Floating reference
				reference.type = ReferenceType.Floating;
				reference.shouldExtract = true;
				reference.name = innerMatch[1];
			} else if ((innerMatch = /^@(.*?)([\W]*)$/.exec(content))) {
				// Dynamic reference
				reference.type = ReferenceType.Variable;
				reference.shouldExtract = true;
				reference.name = innerMatch[1];
				this.handleModifiers(reference, innerMatch[2]);
			} else if ((innerMatch = /^\+@(.*?)([\W]*)$/.exec(content))) {
				// Create note reference
				reference.type = ReferenceType.CreateNote;
				reference.shouldExtract = true;
				reference.name = innerMatch[1];
				this.handleModifiers(reference, innerMatch[2]);
			} else {
				// Standard variable
				reference.name = content;
			}

			references.push(reference);
		}

		return references;
	}

	handleModifiers(reference: Reference, modifiers: string) {
		if (modifiers.includes("!#")) {
			reference.includeName = false;
		} else if (modifiers.includes("#")) {
			reference.includeName = true;
		}

		if (modifiers.includes("!^")) {
			reference.includeProperties = false;
		} else if (modifiers.includes("^")) {
			reference.includeProperties = true;
		}

		if (modifiers.includes("!@")) {
			reference.includeLink = false;
		} else if (modifiers.includes("@")) {
			reference.includeLink = true;
		}
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
		} else if (edge.color === "1") {
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
			// Hmmm
			return null;
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
		const sourceAsGroup = this.getGroup(source.id);
		if (sourceAsGroup) {
			if (targetGroups.includes(sourceAsGroup)) {
				crossingInGroups.shift();
			}
		}

		// Check if the source is a member of the target group, if so remove the last group from crossingOutGroups
		const targetAsGroup = this.getGroup(target.id);
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
			// Hmmm
			return true;
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

export function getIncomingEdgesFromData(nodeId: string, data: VerifiedCannoliCanvasData): string[] {
	return data.edges.filter(
		(edge) => edge.toNode === nodeId
	).map((edge) => edge.id);
}

export function getOutgoingEdgesFromData(nodeId: string, data: VerifiedCannoliCanvasData): string[] {
	return data.edges.filter(
		(edge) => edge.fromNode === nodeId
	).map((edge) => edge.id);
}

export function getGroupMembersFromData(groupId: string, data: VerifiedCannoliCanvasData): string[] {
	// Find all nodes with the groupId in their groups array
	return data.nodes.filter((node) => node.cannoliData.groups.includes(groupId)).map((node) => node.id);
}
