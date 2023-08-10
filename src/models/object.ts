import { EventEmitter } from "events";
import { AllCanvasNodeData } from "obsidian/canvas";
import type { CannoliEdge } from "./edge";
import type { CannoliGroup } from "./group";
import { isProvideEdge } from "./identity";
import type { Run } from "src/run";
import {
	CannoliObjectKind,
	CannoliObjectStatus,
	EdgeType,
	GroupType,
	NodeType,
} from "./graph";

export enum IndicatedNodeType {
	Call = "call",
	Content = "content",
	Floating = "floating",
	NonLogic = "non-logic",
}

export enum IndicatedGroupType {
	Repeat = "repeat",
	List = "list",
	Basic = "basic",
	While = "while",
	NonLogic = "non-logic",
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

export class CannoliObject extends EventEmitter {
	run: Run;
	id: string;
	text: string;
	status: CannoliObjectStatus;
	dependencies: (string | string[])[];
	graph: Record<string, CannoliObject>;
	isClone: boolean;
	kind: CannoliObjectKind;
	type: EdgeType | NodeType | GroupType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean
	) {
		super();
		this.id = id;
		this.text = text;
		this.graph = graph;
		this.status = CannoliObjectStatus.Pending;
		this.dependencies = [];
		this.isClone = isClone;
	}

	setRun(run: Run) {
		this.run = run;
	}

	addDependency(dependency: string) {
		// If the dependency is already in the list of dependencies, error
		if (this.isDependency(dependency)) {
			throw new Error(
				`Error on object ${this.id}: duplicate variables must come from different choice branches. Check the choice nodes and make sure that only one of the duplicate variables can be activated at once.`
			);
		}

		const dependencyObject = this.graph[dependency];

		// If the dependency is a provide edge, check for duplicate names
		if (isProvideEdge(dependencyObject)) {
			for (const dep of this.dependencies) {
				if (Array.isArray(dep)) {
					for (const element of dep) {
						const elementObject = this.graph[element];
						if (isProvideEdge(elementObject)) {
							if (elementObject.name === dependencyObject.name) {
								dep.push(dependency);
								return;
							}
						}
					}
				} else {
					const elementObject = this.graph[dep];
					if (isProvideEdge(elementObject)) {
						if (elementObject.name === dependencyObject.name) {
							// Create an array with the old dependency and the new dependency
							const newDepArray = [dep, dependency];

							// Remove the old dependency from the list of dependencies
							this.dependencies.splice(
								this.dependencies.indexOf(dep),
								1
							);

							// Add the new dependency to the list of dependencies
							this.dependencies.push(newDepArray);
							return;
						}
					}
				}
			}
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
						this.dependencyUpdated(this.graph[element], status);
					});
				}
			}
			// If its not an array, add listeners to the element
			else {
				// Set up a listener for the dependency's completion event
				this.graph[dependency].on("update", (obj, status) => {
					this.dependencyUpdated(obj, status);
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

	dependencyUpdated(dependency: CannoliObject, status: CannoliObjectStatus) {
		switch (status) {
			case CannoliObjectStatus.Complete:
				this.dependencyCompleted(dependency);
				break;
			case CannoliObjectStatus.Rejected:
				this.dependencyRejected(dependency);
				break;
			case CannoliObjectStatus.Executing:
				this.dependencyExecuting(dependency);
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

	executing() {
		this.status = CannoliObjectStatus.Executing;
		this.emit("update", this, CannoliObjectStatus.Executing);
	}

	completed() {
		this.status = CannoliObjectStatus.Complete;
		this.emit("update", this, CannoliObjectStatus.Complete);
	}

	pending() {
		this.status = CannoliObjectStatus.Pending;
		this.emit("update", this, CannoliObjectStatus.Pending);
	}

	reject() {
		this.status = CannoliObjectStatus.Rejected;
		this.emit("update", this, CannoliObjectStatus.Rejected);
	}

	tryReject() {
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
					this.emit("update", this, CannoliObjectStatus.Rejected);
					return true;
				}
			} else {
				// If it's not an array and has status "rejected", return true, if not, continue
				if (
					this.graph[dependency].status ===
					CannoliObjectStatus.Rejected
				) {
					this.status = CannoliObjectStatus.Rejected;
					this.emit("update", this, CannoliObjectStatus.Rejected);
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

	reset() {
		this.status = CannoliObjectStatus.Pending;
		this.emit("update", this, CannoliObjectStatus.Pending);
	}

	dependencyRejected(dependency: CannoliObject) {
		this.tryReject();
	}

	dependencyCompleted(dependency: CannoliObject) {}

	dependencyExecuting(dependency: CannoliObject) {}

	async execute() {}

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

	validate() {}

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
		canvasData: AllCanvasNodeData,
		outgoingEdges?: string[],
		incomingEdges?: string[],
		groups?: string[]
	) {
		super(id, text, graph, isClone);
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
		this.status = CannoliObjectStatus.Error;
		this.emit("update", this, CannoliObjectStatus.Error, message);
		console.error(message);
	}

	validate() {
		super.validate();

		// If the canvasData is null, error
		if (!this.canvasData) {
			this.error(`Error: canvasData cannot be null.`);
		}
	}
}
