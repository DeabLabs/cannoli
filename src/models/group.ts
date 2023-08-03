import { AllCanvasNodeData } from "obsidian/canvas";
import { CannoliObject, CannoliObjectStatus, CannoliVertex } from "./object";
import { CannoliEdge, EdgeType, IndicatedEdgeType } from "./edge";
import { Run } from "src/run";
import { IndicatedNodeType, NodeType } from "./node";
import { Vault } from "obsidian";

export enum IndicatedGroupType {
	Repeat = "repeat",
	List = "list",
	Basic = "basic",
	NonLogic = "non-logic",
}

export enum GroupType {
	Repeat,
	List,
	Basic,
	NonLogic,
}

export class CannoliGroup extends CannoliVertex {
	members: string[];

	GroupPrefixMap: Record<string, IndicatedGroupType> = {
		"<": IndicatedGroupType.List,
	};

	GroupColorMap: Record<string, IndicatedGroupType> = {
		"3": IndicatedGroupType.List,
	};

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone, vault, canvasData);
	}

	setMembers() {
		// Iterate through all vertices
		for (const objectId in this.graph) {
			const object = this.graph[objectId];
			if (object instanceof CannoliVertex) {
				// If the current group contains the vertex
				if (object.groups.includes(this.id)) {
					this.members.push(object.id);

					// Make the member vertex a dependency of the group
					this.addDependency(object.id);

					// Make all non-reflexive incoming edges dependencies of the member vertex
					for (const edge of object.incomingEdges) {
						if (!edge.isReflexive) {
							object.addDependency(edge.id);
						}
					}
				}
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
		// If all the dependencies that are edges are complete, execute
		for (const dependency of this.dependencies) {
			// If the dependency is an array of edges, check if at least one is complete
			if (Array.isArray(dependency)) {
				if (
					dependency.some(
						(dep) =>
							this.graph[dep].status ===
							CannoliObjectStatus.Complete
					) &&
					dependency.every(
						(dep) => this.graph[dep] instanceof CannoliEdge
					)
				) {
					continue;
				} else {
					return false;
				}
			} else {
				if (
					this.graph[dependency].status ===
						CannoliObjectStatus.Complete &&
					this.graph[dependency] instanceof CannoliEdge
				) {
					continue;
				} else {
					return false;
				}
			}
		}

		return true;
	}

	membersFinished(run: Run) {}

	dependencyCompleted(dependency: CannoliObject, run: Run): void {
		// Switch on status of this group
		switch (this.status) {
			case CannoliObjectStatus.Pending:
				// If all edge dependencies are complete, execute
				if (this.allEdgeDependenciesComplete()) {
					this.execute(run);
				}
				break;
			case CannoliObjectStatus.Executing:
				// If all members are complete or rejected, call membersFinished
				if (this.allMembersCompleteOrRejected()) {
					this.membersFinished(run);
				}
				break;
			default:
				break;
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
					labelNumber,
					0
				);
			case GroupType.Basic:
				return new CannoliGroup(
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
		numberOfVersions: number,
		copyId: number
	) {
		super(id, text, graph, isClone, vault, canvasData);
		this.numberOfVersions = numberOfVersions;
		this.copyId = copyId;
	}

	clone() {}
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
		maxLoops: number
	) {
		super(id, text, graph, isClone, vault, canvasData);
		this.maxLoops = maxLoops;
	}

	resetMembers(run: Run) {
		// For each member
		for (const member of this.getMembers()) {
			// Reset the member
			member.reset(run);
			// Reset the member's outgoing edges

			for (const edge of member.outgoingEdges) {
				this.graph[edge.id].reset(run);
			}
		}
	}

	membersFinished(run: Run): void {
		if (this.currentLoop < this.maxLoops) {
			this.currentLoop++;
			this.resetMembers(run);
		} else {
			this.status = CannoliObjectStatus.Complete;
			this.emit("update", this, CannoliObjectStatus.Complete, run);
		}
	}

	reset(run: Run): void {
		super.reset(run);
		this.currentLoop = 0;
	}
}
