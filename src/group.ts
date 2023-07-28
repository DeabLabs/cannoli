import { CannoliEdge } from "./edge";
import { CannoliNode } from "./node";

export type GroupType = "basic" | "list";

export class CannoliGroup {
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

	validate() {
		// Its maxLoops property must be a non-negative integer less than or equal to 10.
		if (this.maxLoops < 0 || this.maxLoops > 10) {
			throw new Error(
				`Group ${this.id} has an invalid maxLoops label, must be less than 10: ${this.maxLoops}`
			);
		}

		// Check if there are any paths that leave the group and reenter.
		const queue: CannoliNode[] = [];

		// Add nodes from the group's outgoing edges to the queue
		for (const edge of this.outgoingEdges) {
			queue.push(edge.target);
		}

		// While there are nodes in the queue, keep checking
		while (queue.length > 0) {
			// Dequeue a node
			const node = queue.shift();

			// If the node doesn't exist, throw an error
			if (!node) {
				throw new Error(
					`Edge ${this.id} has a target node that doesn't exist.`
				);
			}

			// For each of the node's outgoing edges, check the target node
			for (const edge of node.outgoingEdges) {
				// If the target node is in the group, we have a reentering path
				if (this.nodes.includes(edge.target)) {
					throw new Error(
						`Group ${this.id} has a path that leaves the group and comes back in. This would cause a deadlock.`
					);
				}

				// If the target node is not in the group, enqueue it
				else {
					queue.push(edge.target);
				}
			}
		}

		// Calls correct validation function based on group type
		if (this.type === "basic") {
			this.validateBasicGroup();
		}

		if (this.type === "list") {
			this.validateListGroup();
		}
	}

	validateBasicGroup() {
		// It must have no listGroup edges entering it.
		if (this.incomingEdges.some((edge) => edge.subtype === "listGroup")) {
			throw new Error(
				`Basic Group ${this.id} has a listGroup edge entering it.`
			);
		}
	}

	validateListGroup() {
		// It must have at least one listGroup edge entering the group.
		if (!this.incomingEdges.some((edge) => edge.subtype === "listGroup")) {
			throw new Error(
				`List Group ${this.id} has no listGroup edge entering it.`
			);
		}

		// If there are any select edges exiting the group, they must come from the same node, and their first variables must all have the same name
		const selectEdges = this.outgoingEdges.filter(
			(edge) => edge.subtype === "select"
		);
		if (selectEdges.length > 0) {
			const firstVariableNames = selectEdges.map(
				(edge) => edge.variables[0].name
			);
			if (
				!firstVariableNames.every(
					(name) => name === firstVariableNames[0]
				)
			) {
				throw new Error(
					`List Group ${this.id} has select edges exiting it with different first variable names.`
				);
			}
		}
		// If there are not any select edges exiting the group, there must be no edges exiting the group.
		else if (this.outgoingEdges.length > 0) {
			throw new Error(
				`List Group ${this.id} doesn't have a select edge exiting it, but it has other edges exiting it.`
			);
		}
	}
}
