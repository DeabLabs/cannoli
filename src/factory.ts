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
	VerifiedCannoliCanvasGroupData,
	AllVerifiedCannoliCanvasNodeData,
	VerifiedCannoliCanvasEdgeData,
	VerifiedCannoliCanvasTextData,
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
		":": EdgeType.Key,
	};

	edgeColorMap: Record<string, EdgeType> = {
		"2": EdgeType.Config,
		"3": EdgeType.Choice,
		"4": EdgeType.ChatConverter,
		"5": EdgeType.List,
		"6": EdgeType.Key,
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

		[EdgeType.Function]: false,
		[EdgeType.Config]: false,
		[EdgeType.Key]: false,
		[EdgeType.List]: false,
		[EdgeType.Merge]: false,
		[EdgeType.Variable]: false,
		[EdgeType.Category]: false,
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

		// Filter out objects that don't have cannoliData
		let verifiedCannoliData: CannoliCanvasData = {
			nodes: this.cannoliData.nodes.filter((node) => !!node.cannoliData),
			edges: this.cannoliData.edges.filter((edge) => !!edge.cannoliData),
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
			node.type === "text" ? this.parseNodeReferences(node) : [];
		const incomingEdges = this.getIncomingEdges(node.id).map(
			(edge) => edge.id
		);
		const outgoingEdges = this.getOutgoingEdges(node.id).map(
			(edge) => edge.id
		);
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
			incomingEdges,
			outgoingEdges,
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
		const incomingEdges = this.getIncomingEdges(group.id).map(
			(edge) => edge.id
		);
		const outgoingEdges = this.getOutgoingEdges(group.id).map(
			(edge) => edge.id
		);
		const groups = this.getGroupsForVertex(group);

		// Filter for members that are groups or have a non-null indicated type
		const members = this.getMembersForGroup(group).filter(
			(member) =>
				this.getNodeIndicatedType(
					this.cannoliData.nodes.find(
						(node) => node.id === member
					) as
						| CannoliCanvasFileData
						| CannoliCanvasLinkData
						| CannoliCanvasTextData
				) !== null ||
				this.cannoliData.nodes.find((node) => node.id === member)
					?.type === "group"
		);

		const dependencies = [] as string[];
		const originalObject = group.originalObject;
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
			originalObject,
			status,
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
		// For each group of type "signified-for-each", create a duplicate group
		for (const group of data.nodes) {
			// For each group
			if (group.cannoliData.kind === CannoliObjectKind.Group) {
				// For each group of type "signified-for-each"
				if (group.cannoliData.type === GroupType.SignifiedForEach) {
					const castGroup = group as VerifiedCannoliCanvasGroupData;

					if (!castGroup || !castGroup.cannoliData.maxLoops) {
						throw new Error(
							"createForEachDuplicates: castGroup is undefined or castGroup.cannoliData.maxLoops is undefined"
						);
					}

					// Get group incoming and outgoing edges from the canvas
					const incomingEdges =
						castGroup.cannoliData.incomingEdges.map(
							(edgeId) =>
								data.edges.find(
									(edge) => edge.id === edgeId
								) as VerifiedCannoliCanvasEdgeData
						);

					const outgoingEdges =
						castGroup.cannoliData.outgoingEdges.map(
							(edgeId) =>
								data.edges.find(
									(edge) => edge.id === edgeId
								) as VerifiedCannoliCanvasEdgeData
						);

					const outgoingMergeEdge = outgoingEdges.find(
						(edge) => edge.cannoliData.type === EdgeType.Merge
					);

					// Get the target of the merge edge
					const mergeNode = outgoingMergeEdge
						? data.nodes.find(
								(node) => node.id === outgoingMergeEdge.toNode
								// eslint-disable-next-line no-mixed-spaces-and-tabs
						  )
						: null;

					// Find the line of the node's text that starts with "{#}" and replicate it for each loop, adding " <loopNumber>" to each {variable}. I.e. {variable} becomes {variable 1}, {variable 2}, etc.
					if (
						mergeNode &&
						mergeNode.cannoliData.kind === CannoliObjectKind.Node
					) {
						const castMergeNode =
							mergeNode as VerifiedCannoliCanvasTextData;

						// Split the text by newline
						const lines =
							castMergeNode.cannoliData.text.split("\n");

						// Get the line of the node's text that starts with "{#}"
						const loopLine = lines.find((line) =>
							line.startsWith("{#}")
						);

						if (loopLine) {
							// Get the text before and after the loopLine
							let beforeLoopLine =
								castMergeNode.cannoliData.text.slice(
									0,
									castMergeNode.cannoliData.text.indexOf(
										loopLine
									)
								);

							const afterLoopLine =
								castMergeNode.cannoliData.text.slice(
									castMergeNode.cannoliData.text.indexOf(
										loopLine
									) + loopLine.length
								);

							// Find the variables
							const variables = loopLine.match(/{\w+}/g);

							if (variables) {
								// Create a copy of the loopLine for each loop
								for (
									let i = 0;
									// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
									i < castGroup.cannoliData.maxLoops!;
									i++
								) {
									// Create a copy of the loopLine
									let newLoopLine = loopLine;

									// Replace the "{#}" with the loop number
									newLoopLine = newLoopLine.replace(
										"{#}",
										`${i + 1}`
									);

									// Replace each variable with the variable and the loop number
									variables.forEach((variable) => {
										newLoopLine = newLoopLine.replace(
											variable,
											`{${variable.slice(1, -1)} ${
												i + 1
											}}`
										);
									});

									// Add the new loopLine to the beforeLoopLine
									beforeLoopLine = `${beforeLoopLine}${newLoopLine}\n\n`;
								}

								// Add the afterLoopLine to the beforeLoopLine
								beforeLoopLine = `${beforeLoopLine}${afterLoopLine.trim()}`;

								// Update the node's text
								castMergeNode.text = beforeLoopLine;

								castMergeNode.cannoliData.text = beforeLoopLine;
							}
						}

						// Update the node's references
						castMergeNode.cannoliData.references =
							this.parseNodeReferences(castMergeNode);

						// Replace the old node with the new node
						data.nodes = data.nodes.map((node) => {
							if (node.id === castMergeNode.id) {
								return castMergeNode;
							} else {
								return node;
							}
						});
					}

					// Get group crossingInEdges, crossingOutEdges, and internalEdges
					const { crossingInEdges, crossingOutEdges, internalEdges } =
						this.getCrossingAndInternalEdges(castGroup, data);

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
							data
						);
					}

					// Remove the original group and its members and edges from the canvas
					data.nodes = data.nodes.filter(
						(node) =>
							node.id !== group.id &&
							!castGroup.cannoliData?.members.includes(node.id)
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
		group: VerifiedCannoliCanvasGroupData,
		index: number,
		incomingEdges: VerifiedCannoliCanvasEdgeData[],
		outgoingEdges: VerifiedCannoliCanvasEdgeData[],
		crossingInEdges: VerifiedCannoliCanvasEdgeData[],
		crossingOutEdges: VerifiedCannoliCanvasEdgeData[],
		internalEdges: VerifiedCannoliCanvasEdgeData[],
		canvas: VerifiedCannoliCanvasData
	): void {
		// Create a duplicate group and its members and edges
		const duplicateGroup = this.duplicateObject(
			group
		) as VerifiedCannoliCanvasGroupData;

		const duplicateMembers = this.duplicateObject(
			group.cannoliData.members.map((memberId) =>
				canvas.nodes.find((node) => node.id === memberId)
			)
		) as AllVerifiedCannoliCanvasNodeData[];

		// Create duplicate edges
		const duplicateIncomingEdges = this.duplicateObject(
			incomingEdges
		) as VerifiedCannoliCanvasEdgeData[];

		const duplicateOutgoingEdges = this.duplicateObject(
			outgoingEdges
		) as VerifiedCannoliCanvasEdgeData[];

		const duplicateCrossingInEdges = this.duplicateObject(
			crossingInEdges
		) as VerifiedCannoliCanvasEdgeData[];

		const duplicateCrossingOutEdges = this.duplicateObject(
			crossingOutEdges
		) as VerifiedCannoliCanvasEdgeData[];

		const duplicateInternalEdges = this.duplicateObject(
			internalEdges
		) as VerifiedCannoliCanvasEdgeData[];

		// Update the duplicate group's id and type
		duplicateGroup.cannoliData.originalObject = group.id;
		duplicateGroup.id = `${duplicateGroup.id}-${index}`;
		duplicateGroup.cannoliData.currentLoop = index;
		duplicateGroup.cannoliData.type = GroupType.ForEach;

		// Update the members arrays of the groups in this group's groups array
		duplicateGroup.cannoliData.groups.forEach((groupId: string) => {
			const groupData = canvas.nodes.find(
				(node) => node.id === groupId
			) as VerifiedCannoliCanvasGroupData;

			if (!groupData) {
				throw new Error("createDuplicateGroup: groupData is undefined");
			}

			// Change the original group id to the new group id
			groupData.cannoliData.members = groupData.cannoliData.members.map(
				(memberId) => {
					if (memberId === group.id) {
						return duplicateGroup.id;
					} else {
						return memberId;
					}
				}
			);
		});

		// Get the incoming list edge of the group
		const incomingListEdge = canvas.edges.find(
			(edge) =>
				edge.toNode === group.id &&
				edge.cannoliData.type === EdgeType.List
		) as VerifiedCannoliCanvasEdgeData;

		let accumulatorNode: AllVerifiedCannoliCanvasNodeData | null = null;

		// Update the duplicate members' ids and replace the group id in the groups with the duplicate group id
		duplicateMembers.forEach((member) => {
			member.cannoliData.originalObject = member.id;
			member.id = `${member.id}-${index}`;
			member.cannoliData.groups = member.cannoliData.groups.map(
				(groupId: string) => {
					if (groupId === group.id) {
						return duplicateGroup.id;
					} else {
						return groupId;
					}
				}
			);
			member.cannoliData.incomingEdges = [];
			member.cannoliData.outgoingEdges = [];

			// If its a node, update the references if they match the incoming list edge
			if (member.cannoliData.kind === CannoliObjectKind.Node) {
				const node = member as VerifiedCannoliCanvasTextData;
				node.cannoliData.references = node.cannoliData.references?.map(
					(reference) => {
						if (
							reference.type === ReferenceType.Variable &&
							reference.name === incomingListEdge.cannoliData.text
						) {
							reference.name = `${reference.name} ${index}`;
							return reference;
						} else {
							return reference;
						}
					}
				);
			}
		});

		// Update the duplicate group's members array, replacing the old members with the new ones
		duplicateGroup.cannoliData.members = duplicateMembers.map(
			(member) => member.id
		);

		duplicateGroup.cannoliData.incomingEdges = [];
		duplicateGroup.cannoliData.outgoingEdges = [];

		// For each duplicate incoming edge, update the edge's target to the duplicate group, and the group's incoming edges to the duplicate incoming edges, and change the type
		duplicateIncomingEdges.forEach((edge) => {
			edge.cannoliData.originalObject = edge.id;
			edge.id = `${edge.id}-${index}`;
			edge.toNode = duplicateGroup.id;
			duplicateGroup.cannoliData.incomingEdges.push(edge.id);
			if (edge.cannoliData.type === EdgeType.List) {
				edge.cannoliData.type = EdgeType.Key;
				edge.cannoliData.text = `${edge.cannoliData.text} ${index}`;
			}

			// Update the outgoingEdges array of the fromNode
			const fromNode = canvas.nodes.find(
				(node) => node.id === edge.fromNode
			) as AllVerifiedCannoliCanvasNodeData;

			if (!fromNode) {
				throw new Error("createDuplicateGroup: fromNode is undefined");
			}

			fromNode.cannoliData.outgoingEdges.push(edge.id);

			// Remove the edge from the outgoingEdges array of the fromNode
			fromNode.cannoliData.outgoingEdges =
				fromNode.cannoliData.outgoingEdges.filter(
					(edgeId: string | null) =>
						edgeId !== edge.cannoliData.originalObject
				);
		});

		// For each duplicate outgoing edge, update the edge's source to the duplicate group, and the group's outgoing edges to the duplicate outgoing edges, and change the type
		duplicateOutgoingEdges.forEach((edge) => {
			edge.cannoliData.originalObject = edge.id;
			edge.id = `${edge.id}-${index}`;
			edge.fromNode = duplicateGroup.id;
			duplicateGroup.cannoliData.outgoingEdges.push(edge.id);
			if (edge.cannoliData.type === EdgeType.Merge) {
				edge.cannoliData.type = EdgeType.Variable;
				edge.cannoliData.text = `${edge.cannoliData.text} ${index}`;
				accumulatorNode = canvas.nodes.find(
					(node) => node.id === edge.toNode
				) as AllVerifiedCannoliCanvasNodeData;
			}

			// Update the incomingEdges array of the toNode
			const toNode = canvas.nodes.find(
				(node) => node.id === edge.toNode
			) as AllVerifiedCannoliCanvasNodeData;

			if (!toNode) {
				throw new Error("createDuplicateGroup: toNode is undefined");
			}

			toNode.cannoliData.incomingEdges.push(edge.id);

			// Remove the edge from the incomingEdges array of the toNode
			toNode.cannoliData.incomingEdges =
				toNode.cannoliData.incomingEdges.filter(
					(edgeId: string | null) =>
						edgeId !== edge.cannoliData.originalObject
				);
		});

		// For each duplicate crossing in edge, update the edge's target to the new member and update the edge's crossingInGroups with the duplicate group
		duplicateCrossingInEdges.forEach((edge) => {
			edge.cannoliData.originalObject = edge.id;
			edge.id = `${edge.id}-${index}`;
			edge.toNode = `${edge.toNode}-${index}`;
			// edge.toNode = duplicateMembers.find(
			// 	(member) => member.cannoliData.originalObject === edge.toNode
			// )?.id as string;

			// Add this edge to the incomingEdges array of the toNode
			const toNode = duplicateMembers.find(
				(node) => node.id === edge.toNode
			) as AllVerifiedCannoliCanvasNodeData;

			if (!toNode) {
				throw new Error("createDuplicateGroup: toNode is undefined");
			}

			toNode.cannoliData.incomingEdges.push(edge.id);

			// Update the outgoingEdges array of the fromNode
			const fromNode = canvas.nodes.find(
				(node) => node.id === edge.fromNode
			) as AllVerifiedCannoliCanvasNodeData;

			if (!fromNode) {
				throw new Error("createDuplicateGroup: fromNode is undefined");
			}

			fromNode.cannoliData.outgoingEdges.push(edge.id);

			// Remove the edge from the outgoingEdges array of the fromNode
			fromNode.cannoliData.outgoingEdges =
				fromNode.cannoliData.outgoingEdges.filter(
					(edgeId: string | null) =>
						edgeId !== edge.cannoliData.originalObject
				);

			edge.cannoliData.crossingInGroups =
				edge.cannoliData.crossingInGroups.map((groupId: string) => {
					if (groupId === group.id) {
						return duplicateGroup.id;
					} else {
						return groupId;
					}
				});
		});

		// For each duplicate crossing out edge, update the edge's source to the new member and update the edge's crossingOutGroups with the duplicate group
		duplicateCrossingOutEdges.forEach((edge) => {
			edge.cannoliData.originalObject = edge.id;
			edge.id = `${edge.id}-${index}`;
			edge.fromNode = `${edge.fromNode}-${index}`;
			// edge.fromNode = duplicateMembers.find(
			// 	(member) => member.cannoliData.originalObject === edge.fromNode
			// )?.id as string;

			// If the toNode is the accumulatorNode, add the index to the edge's text
			if (edge.toNode === accumulatorNode?.id) {
				edge.cannoliData.text = `${edge.cannoliData.text} ${index}`;
			}

			// Add this edge to the outgoingEdges array of the fromNode
			const fromNode = duplicateMembers.find(
				(node) => node.id === edge.fromNode
			) as AllVerifiedCannoliCanvasNodeData;

			if (!fromNode) {
				throw new Error("createDuplicateGroup: fromNode is undefined");
			}

			fromNode.cannoliData.outgoingEdges.push(edge.id);

			// Update the incomingEdges array of the toNode
			const toNode = canvas.nodes.find(
				(node) => node.id === edge.toNode
			) as AllVerifiedCannoliCanvasNodeData;

			if (!toNode) {
				throw new Error("createDuplicateGroup: toNode is undefined");
			}

			toNode.cannoliData.incomingEdges.push(edge.id);

			// Remove the edge from the incomingEdges array of the toNode
			toNode.cannoliData.incomingEdges =
				toNode.cannoliData.incomingEdges.filter(
					(edgeId: string | null) =>
						edgeId !== edge.cannoliData.originalObject
				);

			edge.cannoliData.crossingOutGroups =
				edge.cannoliData.crossingOutGroups.map((groupId: string) => {
					if (groupId === group.id) {
						return duplicateGroup.id;
					} else {
						return groupId;
					}
				});
		});

		// For each duplicate internal edge, update the edge's source and target to the new members
		duplicateInternalEdges.forEach((edge) => {
			edge.fromNode = duplicateMembers.find(
				(member) => member.cannoliData.originalObject === edge.fromNode
			)?.id as string;

			edge.toNode = duplicateMembers.find(
				(member) => member.cannoliData.originalObject === edge.toNode
			)?.id as string;
		});

		// Add the duplicate group, members, and edges to the canvas
		canvas.nodes.push(duplicateGroup);
		canvas.nodes.push(...duplicateMembers);
		// Add the duplicate edges to the canvas
		canvas.edges.push(
			...duplicateIncomingEdges,
			...duplicateOutgoingEdges,
			...duplicateCrossingInEdges,
			...duplicateCrossingOutEdges,
			...duplicateInternalEdges
		);
	}

	duplicateObject(data: unknown) {
		return JSON.parse(JSON.stringify(data));
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

		// For each member
		for (const member of group.cannoliData.members) {
			// Get the member data
			const memberData = canvas.nodes.find(
				(node) => node.id === member
			) as AllVerifiedCannoliCanvasNodeData;

			// For each incoming edge
			for (const edgeId of memberData.cannoliData.incomingEdges) {
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
			for (const edgeId of memberData.cannoliData.outgoingEdges) {
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
		const incomingEdges = vertex.cannoliData?.incomingEdges;

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
			const members = group.cannoliData?.members;
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
			// Otherwise, it's an accumulate node
			else {
				return CallNodeType.Accumulate;
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

		// Otherwise, its a standard content node
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
					// return this.getKeyEdgeSubtype(edge);
					return EdgeType.Key;
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
			const sourceNode = this.getVertex(edge.fromNode);
			const targetNode = this.getVertex(edge.toNode);

			if (!sourceNode || !targetNode) {
				throw new Error(
					`Edge: ${edge.label} source or target not found`
				);
			}

			if (
				sourceNode.kind === CannoliObjectKind.Group ||
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

	getChoiceEdgeSubtype(edge: CannoliCanvasEdgeData): EdgeType {
		const targetGroup = this.getGroup(edge.toNode);
		if (targetGroup) {
			// If the target is a forEach group, it's a category edge
			if (this.getGroupType(targetGroup) === GroupType.SignifiedForEach) {
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
			(this.getGroupType(sourceGroup) === GroupType.SignifiedForEach ||
				this.getGroupType(sourceGroup) === GroupType.SignifiedForEach)
		) {
			return EdgeType.Merge;
		}
		// Check if the target is a forEach group
		else if (
			targetGroup &&
			this.getGroupType(targetGroup) === GroupType.SignifiedForEach
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

	parseNodeReferences(node: CannoliCanvasTextData): Reference[] {
		// Unified regex to capture any type of reference within double curly braces
		const unifiedPattern = /{{(.*?)}}/g;

		const references: Reference[] = [];
		const textCopy = node.text;
		let match: RegExpExecArray | null;

		while ((match = unifiedPattern.exec(textCopy)) !== null) {
			const content = match[1];
			const reference: Reference = {
				name: "",
				type: ReferenceType.Variable, // default type
				shouldExtract: false,
			};

			let innerMatch: RegExpExecArray | null;
			if ((innerMatch = /^\[\[(.*?)\]\]([\W]*)$/.exec(content))) {
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
			} else if ((innerMatch = /^NOTE([\W]*)$/.exec(content))) {
				// Special "NOTE" reference
				reference.type = ReferenceType.Note;
				reference.shouldExtract = false;
				this.handleModifiers(reference, innerMatch[1]);
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
