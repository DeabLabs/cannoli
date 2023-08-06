import { AllCanvasNodeData } from "obsidian/canvas";
import {
	CannoliObject,
	CannoliObjectKind,
	CannoliObjectStatus,
	CannoliVertex,
	EdgeType,
	GroupType,
	IndicatedEdgeType,
	IndicatedGroupType,
	IndicatedNodeType,
	NodeType,
} from "./object";
import { Run } from "src/run";
import { Vault } from "obsidian";
import { CannoliEdge } from "./edge";

export class CannoliGroup extends CannoliVertex {
	members: string[];

	GroupPrefixMap: Record<string, IndicatedGroupType> = {
		"<": IndicatedGroupType.List,
	};

	GroupColorMap: Record<string, IndicatedGroupType> = {
		"5": IndicatedGroupType.List,
	};

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges?: string[],
		incomingEdges?: string[],
		groups?: string[],
		members?: string[]
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups
		);

		this.members = members || [];

		this.kind = CannoliObjectKind.Group;
	}

	setMembers() {
		// Iterate through all vertices
		for (const objectId in this.graph) {
			const object = this.graph[objectId];
			if (object instanceof CannoliVertex) {
				// If the current group contains the vertex and the vertex is not a floating node
				if (object.groups.includes(this.id)) {
					this.members.push(object.id);
				}
			}
		}
	}

	setDependencies(): void {
		// All members and non-reflexive incoming edges are dependencies
		for (const member of this.members) {
			this.dependencies.push(member);
		}

		for (const edge of this.incomingEdges) {
			const edgeObject = this.graph[edge] as CannoliEdge;

			if (!edgeObject.isReflexive) {
				this.dependencies.push(edge);
			}
		}
	}

	getMembers(): CannoliVertex[] {
		return this.members.map(
			(member) => this.graph[member] as CannoliVertex
		);
	}

	allMembersCompleteOrRejected(): boolean {
		// For each member
		for (const member of this.members) {
			// If it's not complete, return false
			if (
				this.graph[member].status !== CannoliObjectStatus.Complete &&
				this.graph[member].status !== CannoliObjectStatus.Rejected
			) {
				return false;
			}
		}
		return true;
	}

	allEdgeDependenciesComplete(): boolean {
		// Get two arrays: one of all dependencies that are arrays, and one of all dependencies that are not arrays
		const arrayDependencies = this.dependencies.filter((dependency) =>
			Array.isArray(dependency)
		) as string[][];

		const nonArrayDependencies = this.dependencies.filter(
			(dependency) => !Array.isArray(dependency)
		) as string[];

		// Filter out the array dependencies that contain non-edges
		const edgeArrayDependencies = arrayDependencies.filter((dependency) =>
			dependency.every((dep) => this.graph[dep].kind === "edge")
		);

		// Filter out the non-array dependencies that are not edges
		const edgeNonArrayDependencies = nonArrayDependencies.filter(
			(dependency) => this.graph[dependency].kind === "edge"
		);

		// For each edge dependency, check if it's complete or at least one is complete, respectively
		const edgeArrayDependenciesComplete = edgeArrayDependencies.every(
			(dependency) =>
				dependency.some(
					(dep) =>
						this.graph[dep].status === CannoliObjectStatus.Complete
				)
		);

		const edgeNonArrayDependenciesComplete = edgeNonArrayDependencies.every(
			(dependency) =>
				this.graph[dependency].status === CannoliObjectStatus.Complete
		);

		// Return true if all edge dependencies are complete or at least one is complete, respectively
		return (
			edgeArrayDependenciesComplete && edgeNonArrayDependenciesComplete
		);
	}

	async execute(run: Run): Promise<void> {
		this.status = CannoliObjectStatus.Executing;
		this.emit("update", this, CannoliObjectStatus.Executing, run);
	}

	membersFinished(run: Run) {}

	dependencyCompleted(dependency: CannoliObject, run: Run): void {
		if (this.status === CannoliObjectStatus.Executing) {
			// If all members are complete or rejected, call membersFinished
			if (this.allMembersCompleteOrRejected()) {
				this.membersFinished(run);
			}
		}
	}

	dependencyExecuting(dependency: CannoliObject, run: Run): void {
		if (this.status === CannoliObjectStatus.Pending) {
			this.execute(run);
		}
	}

	getIndicatedType():
		| IndicatedEdgeType
		| IndicatedNodeType
		| IndicatedGroupType {
		// Check if the first character is in the prefix map
		const firstCharacter = this.text[0];
		if (firstCharacter in this.GroupPrefixMap) {
			return this.GroupPrefixMap[firstCharacter];
		}

		// If not, check the color map
		const color = this.canvasData.color;

		if (color) {
			if (color in this.GroupColorMap) {
				return this.GroupColorMap[color];
			}
		}

		// If the label number is not null, return Repeat
		const labelNumber = this.getLabelNumber();
		if (labelNumber !== null) {
			return IndicatedGroupType.Repeat;
		}

		// If the group has all NonLogic members, return NonLogic
		if (
			this.getMembers().every(
				(member) =>
					member.getIndicatedType() === IndicatedNodeType.NonLogic ||
					member.getIndicatedType() === IndicatedGroupType.NonLogic
			)
		) {
			return IndicatedGroupType.NonLogic;
		} else {
			// Otherwise, return Basic
			return IndicatedGroupType.Basic;
		}
	}

	decideType(): EdgeType | NodeType | GroupType {
		const indicatedType = this.getIndicatedType();
		switch (indicatedType) {
			case IndicatedGroupType.Repeat:
				return GroupType.Repeat;
			case IndicatedGroupType.List:
				return GroupType.List;
			case IndicatedGroupType.Basic:
				return GroupType.Basic;
			case IndicatedGroupType.NonLogic:
				return GroupType.NonLogic;
			default:
				throw new Error(
					`Error on object ${this.id}: indicated type ${indicatedType} is not a valid group type.`
				);
		}
	}

	createTyped(graph: Record<string, CannoliObject>): CannoliObject | null {
		const type = this.decideType();
		const labelNumber = this.getLabelNumber();
		switch (type) {
			case GroupType.Repeat:
				if (labelNumber === null) {
					throw new Error(
						`Error on object ${this.id}: repeat group must have a positive integer label.`
					);
				}
				return new RepeatGroup(
					this.id,
					this.text,
					graph,
					this.isClone,
					this.vault,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups,
					this.members,
					labelNumber
				);
			case GroupType.List:
				if (labelNumber === null) {
					throw new Error(
						`Error on object ${this.id}: list group must have a positive integer label.`
					);
				}
				return new ListGroup(
					this.id,
					this.text,
					graph,
					this.isClone,
					this.vault,
					this.canvasData,
					this.outgoingEdges,
					this.incomingEdges,
					this.groups,
					this.members,
					labelNumber,
					0
				);
			case GroupType.Basic:
				return new BasicGroup(
					this.id,
					this.text,
					graph,
					this.isClone,
					this.vault,
					this.canvasData
				);
			case GroupType.NonLogic:
				return null;
			default:
				throw new Error(
					`Error on object ${this.id}: type ${type} is not a valid group type.`
				);
		}
	}

	getLabelNumber(): number | null {
		let label = this.text;

		// If the first character of the group label is in the group prefix map, remove it
		if (label[0] in this.GroupPrefixMap) {
			label = label.slice(1);
		}

		// If the remaining label is a positive integer, use it as the maxLoops
		const maxLoops = parseInt(label);
		if (isNaN(maxLoops)) {
			return null;
		}
		return maxLoops;
	}

	logDetails(): string {
		let groupsString = "";
		groupsString += `Groups: `;
		for (const group of this.groups) {
			groupsString += `\n\t-"${this.ensureStringLength(
				this.graph[group].text,
				15
			)}"`;
		}

		let membersString = "";
		membersString += `Members: `;
		for (const member of this.members) {
			membersString += `\n\t-"${this.ensureStringLength(
				this.graph[member].text,
				15
			)}"`;
		}

		let incomingEdgesString = "";
		incomingEdgesString += `Incoming Edges: `;
		for (const edge of this.incomingEdges) {
			incomingEdgesString += `\n\t-"${this.ensureStringLength(
				this.graph[edge].text,
				15
			)}"`;
		}

		let outgoingEdgesString = "";
		outgoingEdgesString += `Outgoing Edges: `;
		for (const edge of this.outgoingEdges) {
			outgoingEdgesString += `\n\t-"${this.ensureStringLength(
				this.graph[edge].text,
				15
			)}"`;
		}

		return (
			super.logDetails() +
			`[::] Group ${this.id} Text: "${this.text}"\n${incomingEdgesString}\n${outgoingEdgesString}\n${groupsString}\n${membersString}\n`
		);
	}

	checkOverlap(): void {
		const currentGroupRectangle = this.createRectangle(
			this.canvasData.x,
			this.canvasData.y,
			this.canvasData.width,
			this.canvasData.height
		);

		// Iterate through all objects in the graph
		for (const objectKey in this.graph) {
			const object = this.graph[objectKey];

			if (object instanceof CannoliVertex) {
				// Skip the current group to avoid self-comparison
				if (object === this) continue;

				const objectRectangle = this.createRectangle(
					object.canvasData.x,
					object.canvasData.y,
					object.canvasData.width,
					object.canvasData.height
				);

				// Check if the object overlaps with the current group
				if (this.overlaps(objectRectangle, currentGroupRectangle)) {
					this.error(
						`This group overlaps with another object. Please ensure objects fully enclose their members.`
					);
					return; // Exit the method after the first error is found
				}
			}
		}
	}

	validateExitingAndReenteringPaths(): void {
		const visited = new Set<CannoliVertex>();

		const dfs = (vertex: CannoliVertex, hasLeftGroup: boolean) => {
			visited.add(vertex);
			for (const edge of vertex.getOutgoingEdges()) {
				const targetVertex = edge.getTarget();
				const isTargetInsideGroup = targetVertex
					.getGroups()
					.includes(this);

				if (hasLeftGroup && isTargetInsideGroup) {
					this.error(
						`A path leaving this group and re-enters it, this would cause deadlock.`
					);
					return;
				}

				if (!visited.has(targetVertex)) {
					dfs(targetVertex, hasLeftGroup || !isTargetInsideGroup);
				}
			}
		};

		const members = this.getMembers();

		for (const member of members) {
			if (!visited.has(member)) {
				dfs(member, false);
			}
		}
	}

	validate(): void {
		super.validate();

		// Check for exiting and re-entering paths
		this.validateExitingAndReenteringPaths();

		// Check overlap
		this.checkOverlap();

		// Groups can't have outgoing edges that aren't of type list
		for (const edge of this.outgoingEdges) {
			if (
				this.graph[edge].kind === CannoliObjectKind.Edge &&
				this.graph[edge].type !== EdgeType.List
			) {
				this.error(
					`Groups can't have outgoing edges that aren't of type list.`
				);
			}
		}
	}
}

export class BasicGroup extends CannoliGroup {
	async execute(run: Run): Promise<void> {
		this.status = CannoliObjectStatus.Complete;
		this.emit("update", this, CannoliObjectStatus.Complete, run);
	}
}

export class ListGroup extends CannoliGroup {
	numberOfVersions: number;
	copyId: number;
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[],
		members: string[],
		numberOfVersions: number,
		copyId: number
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups,
			members
		);
		this.numberOfVersions = numberOfVersions;
		this.copyId = copyId;

		this.type = GroupType.List;
	}

	clone() {}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: List\nNumber of Versions: ${this.numberOfVersions}\n`
		);
	}

	validate(): void {
		super.validate();

		// List groups must have one and only one edge of type either list or category
		const listOrCategoryEdges = this.outgoingEdges.filter(
			(edge) =>
				this.graph[edge].type === EdgeType.List ||
				this.graph[edge].type === EdgeType.Category
		);

		if (listOrCategoryEdges.length !== 1) {
			this.error(
				`List groups must have one and only one edge of type list or category.`
			);
		}

		// List groups can't have outgoing edges that aren't of type list
		for (const edge of this.outgoingEdges) {
			if (
				this.graph[edge].kind === CannoliObjectKind.Edge &&
				this.graph[edge].type !== EdgeType.List
			) {
				this.error(
					`List groups can't have outgoing edges that aren't of type list.`
				);
			}
		}
	}
}

export class RepeatGroup extends CannoliGroup {
	maxLoops: number;
	currentLoop: number;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges: string[],
		incomingEdges: string[],
		groups: string[],
		members: string[],
		maxLoops: number
	) {
		super(
			id,
			text,
			graph,
			isClone,
			vault,
			canvasData,
			outgoingEdges,
			incomingEdges,
			groups,
			members
		);
		this.maxLoops = maxLoops;
		this.currentLoop = 0;

		this.type = GroupType.Repeat;
	}

	resetMembers(run: Run) {
		console.log("resetting members");

		// For each member
		for (const member of this.getMembers()) {
			console.log(
				`resetting member ${member.id}. Its current status is ${member.status}`
			);

			// Reset the member
			member.reset(run);
			// Reset the member's outgoing edges whose target isn't this group

			for (const edge of member.outgoingEdges) {
				const edgeObject = this.graph[edge] as CannoliEdge;

				if (edgeObject.getTarget() !== this) {
					edgeObject.reset(run);
				}
			}
		}
	}

	membersFinished(run: Run): void {
		if (this.currentLoop < this.maxLoops - 1) {
			this.currentLoop++;

			if (!run.isMock) {
				// Sleep for 20ms to allow complete color to render
				setTimeout(() => {
					this.resetMembers(run);
					this.executeMembers(run);
				}, 20);
			} else {
				this.resetMembers(run);
				this.executeMembers(run);
			}
		} else {
			this.status = CannoliObjectStatus.Complete;
			this.emit("update", this, CannoliObjectStatus.Complete, run);
		}
	}

	executeMembers(run: Run): void {
		// For each member
		for (const member of this.getMembers()) {
			const incomingEdges = member.getIncomingEdges();

			// If the member has no incoming edges, execute it
			if (incomingEdges.length === 0) {
				member.execute(run);
			} else {
				// Otherwise, check if all incoming edges are complete
				if (
					incomingEdges.every(
						(edge) =>
							this.graph[edge.id].status ===
							CannoliObjectStatus.Complete
					)
				) {
					// If so, execute the member
					member.execute(run);
				}
			}
		}
	}

	reset(run: Run): void {
		super.reset(run);
		this.currentLoop = 0;
	}

	logDetails(): string {
		return (
			super.logDetails() + `Type: Repeat\nMax Loops: ${this.maxLoops}\n`
		);
	}

	validate(): void {
		super.validate();

		// Repeat groups can't have incoming edges of type list or category
		const listOrCategoryEdges = this.incomingEdges.filter(
			(edge) =>
				this.graph[edge].type === EdgeType.List ||
				this.graph[edge].type === EdgeType.Category
		);

		if (listOrCategoryEdges.length !== 0) {
			this.error(
				`Repeat groups can't have incoming edges of type list or category.`
			);
		}

		// Repeat groups can't have any outgoing edges
		if (this.outgoingEdges.length !== 0) {
			this.error(`Repeat groups can't have any outgoing edges.`);
		}
	}
}
