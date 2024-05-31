import { CannoliObject, CannoliVertex } from "./object";
import { CannoliEdge } from "./edge";
import {
	CannoliObjectStatus,
	EdgeType,
	VerifiedCannoliCanvasData,
	VerifiedCannoliCanvasGroupData,
} from "./graph";
import { getGroupMembersFromData } from "src/factory";

export class CannoliGroup extends CannoliVertex {
	members: string[];
	maxLoops: number;
	currentLoop: number;
	fromForEach: boolean;

	constructor(
		groupData: VerifiedCannoliCanvasGroupData,
		fullCanvasData: VerifiedCannoliCanvasData
	) {
		super(groupData, fullCanvasData);
		this.members = getGroupMembersFromData(
			groupData.id,
			fullCanvasData
		);
		this.maxLoops = groupData.cannoliData.maxLoops ?? 1;
		this.currentLoop = groupData.cannoliData.currentLoop ?? 0;
		this.fromForEach = groupData.cannoliData.fromForEach ?? false;
		this.originalObject = groupData.cannoliData.originalObject ?? null;
	}

	getMembers(): CannoliVertex[] {
		return this.members.map(
			(member) => this.graph[member] as CannoliVertex
		);
	}

	getCrossingAndInternalEdges(): {
		crossingInEdges: CannoliEdge[];
		crossingOutEdges: CannoliEdge[];
		internalEdges: CannoliEdge[];
	} {
		// Initialize the lists
		const crossingInEdges: CannoliEdge[] = [];
		const crossingOutEdges: CannoliEdge[] = [];
		const internalEdges: CannoliEdge[] = [];

		// For each member
		for (const member of this.members) {
			const memberObject = this.graph[member];
			// If it's a vertex
			if (
				this.cannoliGraph.isNode(memberObject) ||
				this.cannoliGraph.isGroup(memberObject)
			) {
				// For each incoming edge
				for (const edge of memberObject.incomingEdges) {
					const edgeObject = this.graph[edge];
					if (this.cannoliGraph.isEdge(edgeObject)) {
						// If it's crossing in
						if (edgeObject.crossingInGroups.includes(this.id)) {
							// Add it to the list
							crossingInEdges.push(edgeObject);
						} else {
							// Otherwise, it's internal
							internalEdges.push(edgeObject);
						}
					}
				}
				// For each outgoing edge
				for (const edge of memberObject.outgoingEdges) {
					const edgeObject = this.graph[edge];
					if (this.cannoliGraph.isEdge(edgeObject)) {
						// If it's crossing out
						if (edgeObject.crossingOutGroups.includes(this.id)) {
							// Add it to the list
							crossingOutEdges.push(edgeObject);
						} else {
							// Otherwise, it's internal
							internalEdges.push(edgeObject);
						}
					}
				}
			}
		}

		return {
			crossingInEdges,
			crossingOutEdges,
			internalEdges,
		};
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

	allDependenciesCompleteOrRejected(): boolean {
		// For each dependency
		for (const dependency of this.dependencies) {
			// If it's not complete, return false
			if (
				this.graph[dependency].status !==
				CannoliObjectStatus.Complete &&
				this.graph[dependency].status !== CannoliObjectStatus.Rejected
			) {
				return false;
			}
		}
		return true;
	}

	async execute(): Promise<void> {
		this.status = CannoliObjectStatus.Complete;
		const event = new CustomEvent("update", {
			detail: { obj: this, status: CannoliObjectStatus.Complete },
		});
		this.dispatchEvent(event);
	}

	membersFinished() { }

	dependencyCompleted(dependency: CannoliObject): void {
		if (this.status === CannoliObjectStatus.Executing) {
			// If all dependencies are complete or rejected, call membersFinished
			if (this.allDependenciesCompleteOrRejected()) {
				this.membersFinished();

			}
		} else if (this.status === CannoliObjectStatus.Complete) {
			if (this.fromForEach && this.allDependenciesCompleteOrRejected()) {
				const event = new CustomEvent("update", {
					detail: { obj: this, status: CannoliObjectStatus.VersionComplete },
				});
				this.dispatchEvent(event);
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
		return true;
	}

	anyReflexiveEdgesComplete(): boolean {
		// For each incoming edge
		for (const edge of this.incomingEdges) {
			const edgeObject = this.graph[edge] as CannoliEdge;
			// If it's reflexive and complete, return true
			if (
				edgeObject.isReflexive &&
				edgeObject.status === CannoliObjectStatus.Complete
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
	}
}

// export class ForEachGroup extends CannoliGroup {
// 	constructor(
// 		forEachData: VerifiedCannoliCanvasGroupData,
// 		fullCanvasData: VerifiedCannoliCanvasData
// 	) {
// 		super(forEachData, fullCanvasData);
// 	}

// 	logDetails(): string {
// 		return (
// 			super.logDetails() + `Type: ForEach\nIndex: ${this.currentLoop}\n`
// 		);
// 	}

// 	async execute(): Promise<void> {
// 		this.status = CannoliObjectStatus.Executing;
// 		const event = new CustomEvent("update", {
// 			detail: { obj: this, status: CannoliObjectStatus.Executing },
// 		});
// 		this.dispatchEvent(event);
// 	}

// 	dependencyCompleted(dependency: CannoliObject): void {
// 		if (this.status === CannoliObjectStatus.Executing) {
// 			// If all members are complete or rejected, call membersFinished
// 			if (this.allMembersCompleteOrRejected()) {
// 				this.completed();
// 			}
// 		}
// 	}
// }

export class RepeatGroup extends CannoliGroup {
	constructor(
		groupData: VerifiedCannoliCanvasGroupData,
		fullCanvasData: VerifiedCannoliCanvasData
	) {
		super(groupData, fullCanvasData);

		this.currentLoop = groupData.cannoliData.currentLoop ?? 0;
		this.maxLoops = groupData.cannoliData.maxLoops ?? 1;
	}

	async execute(): Promise<void> {
		this.status = CannoliObjectStatus.Executing;
		const event = new CustomEvent("update", {
			detail: { obj: this, status: CannoliObjectStatus.Executing },
		});
		this.dispatchEvent(event);
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
		if (
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			this.currentLoop < this.maxLoops! - 1 &&
			this.allEdgeDependenciesComplete()
		) {
			this.currentLoop++;

			if (!this.run.isMock) {
				// Sleep for 20ms to allow complete color to render
				setTimeout(() => {
					this.resetMembers();

					const event = new CustomEvent("update", {
						detail: { obj: this, status: CannoliObjectStatus.VersionComplete, message: this.currentLoop.toString() },
					});

					this.dispatchEvent(event);

					this.executeMembers();
				}, 20);
			} else {
				this.resetMembers();
				this.executeMembers();
			}
		} else {
			this.status = CannoliObjectStatus.Complete;
			const event = new CustomEvent("update", {
				detail: { obj: this, status: CannoliObjectStatus.Complete },
			});
			this.dispatchEvent(event);
		}
	}

	executeMembers(): void {
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
				`Repeat groups loops must have a valid number in their label. Please ensure the label is a positive integer.`
			);
		}

		// Repeat groups can't have incoming edges of type list or category
		const listOrCategoryEdges = this.incomingEdges.filter(
			(edge) =>
				this.graph[edge].type === EdgeType.List
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
