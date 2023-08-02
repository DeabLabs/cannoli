import { EventEmitter } from "events";
import { Run } from "./run";
import { AllCanvasNodeData, CanvasEdgeData } from "obsidian/canvas";

export enum CannoliObjectStatus {
	Pending = "pending",
	Executing = "executing",
	Complete = "complete",
	Rejected = "rejected",
}

export class CannoliObject extends EventEmitter {
	id: string;
	text: string;
	status: CannoliObjectStatus;
	dependencies: (string | string[])[];
	graph: Record<string, CannoliObject>;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>
	) {
		super();
		this.id = id;
		this.text = text;
		this.status = CannoliObjectStatus.Pending;
		this.dependencies = [];
		this.graph = {};
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
			await this.mockRun();
		} else {
			await this.run();
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

	// All of the following must be implemented by subclasses

	reset() {
		this.status = CannoliObjectStatus.Pending;
	}

	dependencyCompleted(dependency: CannoliObject, run: Run) {}

	dependencyRejected(dependency: CannoliObject, run: Run) {}

	async run() {}

	async mockRun() {}

	logDetails() {}

	validate() {}
}

export class CannoliVertex extends CannoliObject {
	canvasData: AllCanvasNodeData;
	outgoingEdges: string[];
	incomingEdges: string[];
	parentGroups: string[];

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph);
		this.canvasData = canvasData;
		this.outgoingEdges = [];
		this.incomingEdges = [];
	}

	addIncomingEdge(edge: string) {
		this.incomingEdges.push(edge);
		this.addDependency(edge);
	}

	addOutgoingEdge(edge: string) {
		this.outgoingEdges.push(edge);
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

	setParentGroups(graph: Record<string, CannoliObject>): CannoliGroup[] {
		const parentGroups: CannoliGroup[] = [];
		const currentVertexRectangle = this.createRectangle(
			this.canvasData.x,
			this.canvasData.y,
			this.canvasData.width,
			this.canvasData.height
		);

		// Iterate through all vertices
		for (const object in graph) {
			const vertex = graph[object];

			// Ensure vertex is of type CannoliGroup before processing further
			if (!(vertex instanceof CannoliGroup)) {
				continue;
			}

			const groupRectangle = this.createRectangle(
				vertex.canvasData.x,
				vertex.canvasData.y,
				vertex.canvasData.width,
				vertex.canvasData.height
			);

			// If the group encloses the current vertex, add it to the parent groups
			if (this.encloses(groupRectangle, currentVertexRectangle)) {
				parentGroups.push(vertex as CannoliGroup); // Type cast as CannoliGroup for clarity
			}
		}

		// Sort the parent groups from smallest to largest (from immediate parent to most distant)
		parentGroups.sort((a, b) => {
			const aArea = a.canvasData.width * a.canvasData.height;
			const bArea = b.canvasData.width * b.canvasData.height;

			return aArea - bArea;
		});

		return parentGroups;
	}
}

export class CannoliEdge extends CannoliObject {
	source: string;
	target: string;
	canvasData: CanvasEdgeData;

	constructor(
		id: string,
		text: string,

		graph: Record<string, CannoliObject>,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph);
		this.source = source;
		this.target = target;
		this.canvasData = canvasData;

		this.addDependency(source);
	}

	getSource(): CannoliVertex {
		return this.graph[this.source] as CannoliVertex;
	}

	getTarget(): CannoliVertex {
		return this.graph[this.target] as CannoliVertex;
	}

	setIncomingAndOutgoingEdges(graph: Record<string, CannoliObject>) {
		const source = graph[this.source];
		const target = graph[this.target];

		if (
			source instanceof CannoliVertex &&
			target instanceof CannoliVertex
		) {
			source.addOutgoingEdge(this.id);
			target.addIncomingEdge(this.id);
		}
	}
}

export class CannoliGroup extends CannoliVertex {
	members: string[];
	crossingInEdges: string[];
	crossingOutEdges: string[];

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, canvasData);
	}

	setChildren(graph: Record<string, CannoliObject>) {
		// Iterate through all vertices
		for (const object in graph) {
			const vertex = graph[object];
			if (vertex instanceof CannoliVertex) {
				// If the current group is a parent of the vertex
				if (vertex.parentGroups.includes(this.id)) {
					this.members.push(vertex.id);
				}
			}
		}
	}
}

export class CannoliNode extends CannoliVertex {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, canvasData);
	}
}
