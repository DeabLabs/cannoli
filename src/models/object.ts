import { EventEmitter } from "events";
import { AllCanvasNodeData } from "obsidian/canvas";
import { Run } from "src/run";
import type { CannoliEdge } from "./edge";
import type { CannoliGroup } from "./group";
import { Vault } from "obsidian";

export enum IndicatedNodeType {
	Call = "call",
	Content = "content",
	Floating = "floating",
	NonLogic = "non-logic",
}

export enum NodeType {
	Choice = "choice",
	List = "list",
	StandardCall = "standard-call",
	Formatter = "formatter",
	Input = "input",
	Display = "display",
	Vault = "vault",
	Reference = "reference",
	Floating = "floating",
	NonLogic = "non-logic",
}

export enum ReferenceType {
	Variable = "variable",
	Floating = "floating",
	Note = "note",
}

export interface Reference {
	name: string;
	type: ReferenceType;
	shouldExtract: boolean;
}

export enum IndicatedGroupType {
	Repeat = "repeat",
	List = "list",
	Basic = "basic",
	NonLogic = "non-logic",
}

export enum GroupType {
	Repeat = "repeat",
	List = "list",
	Basic = "basic",
	NonLogic = "non-logic",
}

export enum CannoliObjectStatus {
	Pending = "pending",
	Executing = "executing",
	Complete = "complete",
	Rejected = "rejected",
	Error = "error",
}

export enum EdgeType {
	Write = "write",
	Logging = "logging",
	Config = "config",
	Chat = "chat",
	SystemMessage = "system-message",
	List = "list",
	Function = "function",
	ListItem = "list-item",
	Select = "select",
	Branch = "branch",
	Category = "category",
	Vault = "vault",
	SingleVariable = "single-variable",
	NonLogic = "non-logic",
	Untyped = "untyped",
}

export enum IndicatedEdgeType {
	Blank,
	Variable,
	List,
	Choice,
	Config,
	Function,
	Vault,
	Logging,
}

export enum CannoliObjectKind {
	Node = "node",
	Edge = "edge",
	Group = "group",
}

export class CannoliObject extends EventEmitter {
	id: string;
	text: string;
	status: CannoliObjectStatus;
	dependencies: (string | string[])[];
	graph: Record<string, CannoliObject>;
	isClone: boolean;
	vault: Vault;
	kind: CannoliObjectKind;
	type: EdgeType | NodeType | GroupType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault
	) {
		super();
		this.id = id;
		this.text = text;
		this.graph = graph;
		this.status = CannoliObjectStatus.Pending;
		this.dependencies = [];
		this.graph = graph;
		this.isClone = isClone;
		this.vault = vault;
	}

	addDependency(dependency: string | string[]) {
		// If the dependency is already in the list of dependencies, error
		if (this.isDependency(dependency)) {
			throw new Error(
				`Error on object ${this.id}: duplicate variables must come from different choice branches. Check the choice nodes and make sure that only one of the duplicate variables can be activated at once.`
			);
		}

		// Add the dependency to the list of dependencies
		this.dependencies.push(dependency);
	}

	setupListeners() {
		// For each dependency
		for (const dependency of this.dependencies) {
			// If its an array, add listeners to each element
			if (Array.isArray(dependency)) {
				for (const element of dependency) {
					this.graph[element].on("update", (obj, status, run) => {
						// Look for duplicate dependency conflicts
						if (status === CannoliObjectStatus.Complete) {
							const completeDependencies = dependency.filter(
								(dependency) =>
									this.graph[dependency].status ===
									CannoliObjectStatus.Complete
							);
							if (completeDependencies.length > 1) {
								throw new Error(
									`Error on object ${this.id}: duplicate variables must come from different choice branches. Check the choice nodes and make sure that only one of the duplicate variables can be activated at once.`
								);
							}
						}
						this.dependencyUpdated(
							this.graph[element],
							status,
							run
						);
					});
				}
			}
			// If its not an array, add listeners to the element
			else {
				// Set up a listener for the dependency's completion event
				this.graph[dependency].on("update", (obj, status, run) => {
					this.dependencyUpdated(obj, status, run);
				});
			}
		}
	}

	isDependency(potentialDependency: string | string[]): boolean {
		// Convert potentialDependency to an array if it's not already
		const potentialDependencies = Array.isArray(potentialDependency)
			? potentialDependency
			: [potentialDependency];

		// Check if any potentialDependency is in this.dependencies
		return potentialDependencies.some((pd) =>
			this.dependencies.some((dependency) =>
				Array.isArray(dependency)
					? dependency.includes(pd)
					: dependency === pd
			)
		);
	}

	getAllDependencies(): CannoliObject[] {
		const dependencies: CannoliObject[] = [];

		// For each dependency
		for (const dependency of this.dependencies) {
			// If it's an array, add each element to the list of dependencies
			if (Array.isArray(dependency)) {
				for (const element of dependency) {
					dependencies.push(this.graph[element]);
				}
			}
			// If it's not an array, add it to the list of dependencies
			else {
				dependencies.push(this.graph[dependency]);
			}
		}

		return dependencies;
	}

	dependencyUpdated(
		dependency: CannoliObject,
		status: CannoliObjectStatus,
		run: Run
	) {
		switch (status) {
			case CannoliObjectStatus.Complete:
				this.dependencyCompleted(dependency, run);
				break;
			case CannoliObjectStatus.Rejected:
				this.dependencyRejected(dependency, run);
				break;
			case CannoliObjectStatus.Executing:
				this.dependencyExecuting(dependency, run);
				break;
			default:
				break;
		}
	}

	allDependenciesComplete(): boolean {
		// For each dependency
		for (const dependency of this.dependencies) {
			// If it's an array, check if all elements are complete
			if (Array.isArray(dependency)) {
				// If any element is not complete, return false
				if (
					dependency.some(
						(dep) =>
							this.graph[dep].status !==
							CannoliObjectStatus.Complete
					)
				) {
					return false;
				}
			}
			// If it's not an array, check if it's complete
			else {
				if (
					this.graph[dependency].status !==
					CannoliObjectStatus.Complete
				) {
					return false;
				}
			}
		}
		return true;
	}

	async execute(run: Run) {
		this.status = CannoliObjectStatus.Executing;
		this.emit("update", this, CannoliObjectStatus.Executing, run);

		if (run.isMock) {
			await this.mockRun(run);
		} else {
			await this.run(run);
		}

		this.status = CannoliObjectStatus.Complete;
		this.emit("update", this, CannoliObjectStatus.Complete, run);
	}

	tryReject(run: Run) {
		// Check all dependencies
		this.dependencies.every((dependency) => {
			// If it's an array and all elements have status "rejected", return true, if not, continue
			if (Array.isArray(dependency)) {
				if (
					dependency.every(
						(dependency) =>
							this.graph[dependency].status ===
							CannoliObjectStatus.Rejected
					)
				) {
					this.status = CannoliObjectStatus.Rejected;
					this.emit(
						"update",
						this,
						CannoliObjectStatus.Rejected,
						run
					);
					return true;
				}
			} else {
				// If it's not an array and has status "rejected", return true, if not, continue
				if (
					this.graph[dependency].status ===
					CannoliObjectStatus.Rejected
				) {
					this.status = CannoliObjectStatus.Rejected;
					this.emit(
						"update",
						this,
						CannoliObjectStatus.Rejected,
						run
					);
					return true;
				}
			}
		});

		// If all dependencies are not rejected, return false
		return false;
	}

	ensureStringLength(str: string, maxLength: number): string {
		if (str.length > maxLength) {
			return str.substring(0, maxLength - 3) + "...";
		} else {
			return str;
		}
	}

	setSpecialType() {
		return;
	}

	// All of the following must be implemented by subclasses

	getIndicatedType():
		| IndicatedEdgeType
		| IndicatedNodeType
		| IndicatedGroupType {
		throw new Error("Method not implemented.");
	}

	decideType(): EdgeType | NodeType | GroupType {
		throw new Error("Method not implemented.");
	}

	createTyped(graph: Record<string, CannoliObject>): CannoliObject | null {
		throw new Error("Method not implemented.");
	}

	reset(run: Run) {
		this.status = CannoliObjectStatus.Pending;
		this.emit("update", this, CannoliObjectStatus.Pending, run);
	}

	dependencyRejected(dependency: CannoliObject, run: Run) {
		this.tryReject(run);
	}

	dependencyCompleted(dependency: CannoliObject, run: Run) {}

	dependencyExecuting(dependency: CannoliObject, run: Run) {}

	async run(run: Run) {}

	async mockRun(run: Run) {}

	logDetails(): string {
		let dependenciesString = "";
		for (const dependency of this.dependencies) {
			if (Array.isArray(dependency)) {
				dependenciesString += "\t[";
				for (const element of dependency) {
					dependenciesString += `"${this.graph[element].text}", `;
				}
				dependenciesString += "]\n";
			} else {
				dependenciesString += `\t"${this.graph[dependency].text}"\n`;
			}
		}

		return `Dependencies:\n${dependenciesString}\n`;
	}

	validate() {
		// If the id is empty, error
		if (this.id === "") {
			throw new Error(
				`Error on object ${this.id}: id cannot be an empty string.`
			);
		}
	}

	setDependencies() {}
}

export class CannoliVertex extends CannoliObject {
	canvasData: AllCanvasNodeData;
	outgoingEdges: string[];
	incomingEdges: string[];
	groups: string[]; // Sorted from immediate parent to most distant

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		vault: Vault,
		canvasData: AllCanvasNodeData,
		outgoingEdges?: string[],
		incomingEdges?: string[],
		groups?: string[]
	) {
		super(id, text, graph, isClone, vault);
		this.canvasData = canvasData;
		this.outgoingEdges = outgoingEdges || [];
		this.incomingEdges = incomingEdges || [];
		this.groups = groups || [];
	}

	addIncomingEdge(id: string) {
		this.incomingEdges.push(id);
	}

	addOutgoingEdge(id: string) {
		this.outgoingEdges.push(id);
	}

	getOutgoingEdges(): CannoliEdge[] {
		return this.outgoingEdges.map(
			(edge) => this.graph[edge] as CannoliEdge
		);
	}

	getIncomingEdges(): CannoliEdge[] {
		return this.incomingEdges.map(
			(edge) => this.graph[edge] as CannoliEdge
		);
	}

	getGroups(): CannoliGroup[] {
		return this.groups.map((group) => this.graph[group] as CannoliGroup);
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

	setGroups() {
		const groups: CannoliGroup[] = [];
		const currentVertexRectangle = this.createRectangle(
			this.canvasData.x,
			this.canvasData.y,
			this.canvasData.width,
			this.canvasData.height
		);

		// Iterate through all vertices
		for (const object in this.graph) {
			const vertex = this.graph[object];

			if (
				!(
					vertex instanceof CannoliVertex &&
					vertex.kind !== CannoliObjectKind.Edge &&
					vertex.id !== this.id
				)
			) {
				continue;
			}

			const groupRectangle = this.createRectangle(
				vertex.canvasData.x,
				vertex.canvasData.y,
				vertex.canvasData.width,
				vertex.canvasData.height
			);

			// If the group encloses the current vertex, add it to the groups
			if (this.encloses(groupRectangle, currentVertexRectangle)) {
				groups.push(vertex as CannoliGroup); // Type cast as CannoliGroup for clarity
			}
		}

		// Sort the groups from smallest to largest (from immediate parent to most distant)
		groups.sort((a, b) => {
			const aArea = a.canvasData.width * a.canvasData.height;
			const bArea = b.canvasData.width * b.canvasData.height;

			return aArea - bArea;
		});

		this.groups = groups.map((group) => group.id);
	}

	setDependencies(): void {
		// Make all incoming edges that aren't reflexive dependencies
		for (const edge of this.incomingEdges) {
			const edgeObject = this.graph[edge] as CannoliEdge;

			if (!edgeObject.isReflexive) {
				this.addDependency(edge);
			}
		}

		// Make all incoming edges of all groups that aren't reflexive dependencies
		for (const group of this.groups) {
			const groupObject = this.graph[group] as CannoliGroup;

			for (const edge of groupObject.incomingEdges) {
				const edgeObject = this.graph[edge] as CannoliEdge;

				if (!edgeObject.isReflexive) {
					this.addDependency(edge);
				}
			}
		}
	}

	error(message: string) {
		const run = new Run(false);
		this.status = CannoliObjectStatus.Error;
		this.emit("update", this, CannoliObjectStatus.Error, run, message);
		throw new Error(message);
	}

	validate() {
		super.validate();

		// If the canvasData is null, error
		if (!this.canvasData) {
			this.error(`Error: canvasData cannot be null.`);
		}
	}
}
