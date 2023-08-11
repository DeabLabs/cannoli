import { CannoliObject, CannoliVertex } from "./object";
import { CannoliEdge } from "./edge";
import {
	CannoliObjectKind,
	CannoliObjectStatus,
	EdgeType,
	VerifiedCannoliCanvasGroupData,
} from "./graph";

export class CannoliGroup extends CannoliVertex {
	members: string[];

	constructor(groupData: VerifiedCannoliCanvasGroupData) {
		super(groupData);
		this.members = groupData.cannoliData.members;
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

		const dependencies = this.dependencies.filter(
			(dependency) => !Array.isArray(dependency)
		) as string[];

		// Filter out the dependencies that are not edges
		const edgeDependencies = dependencies.filter(
			(dependency) => this.graph[dependency].kind === "edge"
		);

		const edgeDependenciesComplete = edgeDependencies.every(
			(dependency) =>
				this.graph[dependency].status === CannoliObjectStatus.Complete
		);

		// Return true if all edge dependencies are complete or at least one is complete, respectively
		return edgeDependenciesComplete;
	}

	async execute(): Promise<void> {
		this.status = CannoliObjectStatus.Executing;
		this.emit("update", this, CannoliObjectStatus.Executing);
	}

	membersFinished() {}

	dependencyCompleted(dependency: CannoliObject): void {
		if (this.status === CannoliObjectStatus.Executing) {
			// If all members are complete or rejected, call membersFinished
			if (this.allMembersCompleteOrRejected()) {
				this.membersFinished();
			}
		}
	}

	dependencyExecuting(dependency: CannoliObject): void {
		if (this.status === CannoliObjectStatus.Pending) {
			this.execute();
		}
	}

	dependencyRejected(dependency: CannoliObject) {
		if (this.noEdgeDependenciesRejected()) {
			return;
		} else {
			this.reject();
		}
	}

	noEdgeDependenciesRejected(): boolean {
		// For each dependency
		for (const dependency of this.dependencies) {
			// If it's an array, check if all elements are complete
			if (Array.isArray(dependency)) {
				// If its an array of edges
				if (
					dependency.every((dep) => this.graph[dep].kind === "edge")
				) {
					// If all elements are rejected, return false
					if (
						dependency.every(
							(dep) =>
								this.graph[dep].status ===
								CannoliObjectStatus.Rejected
						)
					) {
						return false;
					}
				}
			}
			// If it's not an array, check if it's rejected
			else {
				// If its an edge
				if (this.graph[dependency].kind === "edge") {
					if (
						this.graph[dependency].status ===
						CannoliObjectStatus.Rejected
					) {
						return false;
					}
				}
			}
		}
		return true;
	}

	anyReflexiveEdgesRejected(): boolean {
		// For each incoming edge
		for (const edge of this.incomingEdges) {
			const edgeObject = this.graph[edge] as CannoliEdge;
			// If it's reflexive and rejected, return true
			if (
				edgeObject.isReflexive &&
				edgeObject.status === CannoliObjectStatus.Rejected
			) {
				return true;
			}
		}
		return false;
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
			`[::] Group ${this.id} Text: "${this.text}"\n${incomingEdgesString}\n${outgoingEdgesString}\n${groupsString}\n${membersString}\n` +
			super.logDetails()
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

export class ForEachGroup extends CannoliGroup {
	constructor(forEachData: VerifiedCannoliCanvasGroupData) {
		super(forEachData);
	}

	logDetails(): string {
		return super.logDetails() + `Type: List\n`;
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

	constructor(groupData: VerifiedCannoliCanvasGroupData) {
		super(groupData);

		this.currentLoop = groupData.cannoliData.currentLoop ?? 0;
		this.maxLoops = groupData.cannoliData.maxLoops ?? 1;
	}

	resetMembers() {
		// For each member
		for (const member of this.getMembers()) {
			// Reset the member
			member.reset();
			// Reset the member's outgoing edges whose target isn't this group

			for (const edge of member.outgoingEdges) {
				const edgeObject = this.graph[edge] as CannoliEdge;

				if (edgeObject.getTarget() !== this) {
					edgeObject.reset();
				}
			}
		}
	}

	membersFinished(): void {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		if (this.currentLoop < this.maxLoops! - 1) {
			this.currentLoop++;

			if (!this.run.isMock) {
				// Sleep for 20ms to allow complete color to render
				setTimeout(() => {
					this.resetMembers();
					this.executeMembers();
				}, 20);
			} else {
				this.resetMembers();
				this.executeMembers();
			}
		} else {
			this.status = CannoliObjectStatus.Complete;
			this.emit("update", this, CannoliObjectStatus.Complete);
		}
	}

	executeMembers(): void {
		// THIS SHOULD CALL A "TRY EXECUTE" METHOD ON EACH MEMBER

		// For each member
		for (const member of this.getMembers()) {
			member.dependencyCompleted(this);
		}
	}

	reset(): void {
		super.reset();
		this.currentLoop = 0;
	}

	logDetails(): string {
		return (
			super.logDetails() + `Type: Repeat\nMax Loops: ${this.maxLoops}\n`
		);
	}

	validate(): void {
		super.validate();

		// Repeat groups must have a valid label number
		if (this.maxLoops === null) {
			this.error(
				`Repeat groups and While loops must have a valid number in their label. Please ensure the label is a positive integer.`
			);
		}

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

export class WhileGroup extends RepeatGroup {
	constructor(groupData: VerifiedCannoliCanvasGroupData) {
		super(groupData);
	}

	membersFinished(): void {
		// Check if any non-vertex dependencies are rejected and if the current loop is less than the max loops
		if (
			!this.anyReflexiveEdgesRejected() &&
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			this.currentLoop < this.maxLoops! - 1
		) {
			this.currentLoop++;

			if (!this.run.isMock) {
				// Sleep for 20ms to allow complete color to render
				setTimeout(() => {
					this.resetMembers();
					this.executeMembers();
				}, 20);
			} else {
				this.resetMembers();
				this.executeMembers();
			}
		} else {
			this.status = CannoliObjectStatus.Complete;
			this.emit("update", this, CannoliObjectStatus.Complete);
		}
	}

	validate(): void {
		super.validate();

		// While groups must have at least one incoming edge that is reflexive and of type "branch"
		// const branchEdges = this.getIncomingEdges().filter(
		// 	(edge) => edge.type === EdgeType.Branch && edge.isReflexive
		// );

		// if (branchEdges.length === 0) {
		// 	this.error(
		// 		`While groups must have at least one incoming branch edge coming from a node in the group.`
		// 	);
		// }
	}

	logDetails(): string {
		return super.logDetails() + `Subtype: While\n`;
	}
}
