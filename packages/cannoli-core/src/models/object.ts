import type { CannoliEdge } from "./edge";
import type { CannoliGroup } from "./group";
import type { Run } from "../run";
import {
	AllVerifiedCannoliCanvasNodeData,
	CannoliGraph,
	CannoliObjectKind,
	CannoliObjectStatus,
	EdgeType,
	GroupType,
	NodeType,
	VerifiedCannoliCanvasEdgeData,
} from "./graph";
export class CannoliObject extends EventTarget {
	run: Run;
	id: string;
	text: string;
	status: CannoliObjectStatus;
	dependencies: string[];
	graph: Record<string, CannoliObject>;
	cannoliGraph: CannoliGraph;
	canvasData:
		| AllVerifiedCannoliCanvasNodeData
		| VerifiedCannoliCanvasEdgeData;
	originalObject: string | null;
	kind: CannoliObjectKind;
	type: EdgeType | NodeType | GroupType;

	constructor(
		data: AllVerifiedCannoliCanvasNodeData | VerifiedCannoliCanvasEdgeData
	) {
		super();
		this.id = data.id;
		this.text = data.cannoliData.text;
		this.status = data.cannoliData.status;
		this.dependencies = data.cannoliData.dependencies;
		this.originalObject = data.cannoliData.originalObject;
		this.kind = data.cannoliData.kind;
		this.type = data.cannoliData.type;
		this.canvasData = data;
	}

	setRun(run: Run) {
		this.run = run;
	}

	setGraph(graph: Record<string, CannoliObject>, cannoliGraph: CannoliGraph) {
		this.graph = graph;
		this.cannoliGraph = cannoliGraph;
	}

	setupListeners() {
		// For each dependency
		for (const dependency of this.dependencies) {
			// Set up a listener for the dependency's completion event
			this.graph[dependency].addEventListener(
				"update",
				(event: CustomEvent) => {
					// Assuming that 'obj' and 'status' are properties in the detail of the CustomEvent
					this.dependencyUpdated(
						event.detail.obj,
						event.detail.status
					);
				}
			);
		}
	}

	getAllDependencies(): CannoliObject[] {
		const dependencies: CannoliObject[] = [];
		for (const dependency of this.dependencies) {
			dependencies.push(this.graph[dependency]);
		}

		return dependencies;
	}

	dependencyUpdated(dependency: CannoliObject, status: CannoliObjectStatus) {
		if (this.run.isStopped) {
			return;
		}

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
		// Get the dependencies as objects
		const dependencies = this.getAllDependencies();

		// For each dependency
		for (const dependency of dependencies) {
			if (dependency.status !== CannoliObjectStatus.Complete) {
				// If the dependency is a non-logging edge
				if (
					this.cannoliGraph.isEdge(dependency) &&
					dependency.type !== EdgeType.Logging
				) {
					let redundantComplete = false;

					// Check if there are any other edge dependencies that share the same name and type which are complete
					for (const otherDependency of dependencies) {
						if (
							this.cannoliGraph.isEdge(otherDependency) &&
							otherDependency.text === dependency.text &&
							otherDependency.type === dependency.type &&
							otherDependency.status ===
							CannoliObjectStatus.Complete
						) {
							// If there are, set redundantComplete to true
							redundantComplete = true;
							break;
						}
					}

					// If redundantComplete is false, return false
					if (!redundantComplete) {
						return false;
					}
				} else {
					// If the dependency is not an edge, return false
					return false;
				}
			}
		}
		return true;
	}

	allEdgeDependenciesComplete(): boolean {
		// Get the dependencies as objects
		const dependencies = this.getAllDependencies();

		// For each dependency
		for (const dependency of dependencies) {
			// If the dependency it's not an edge, continue
			if (!this.cannoliGraph.isEdge(dependency)) {
				continue;
			}

			if (dependency.status !== CannoliObjectStatus.Complete) {
				// If the dependency is a non-logging edge
				if (
					this.cannoliGraph.isEdge(dependency) &&
					dependency.type !== EdgeType.Logging
				) {
					let redundantComplete = false;

					// Check if there are any other edge dependencies that share the same name which are complete
					for (const otherDependency of dependencies) {
						if (
							this.cannoliGraph.isEdge(otherDependency) &&
							otherDependency.text === dependency.text &&
							otherDependency.status ===
							CannoliObjectStatus.Complete
						) {
							// If there are, set redundantComplete to true
							redundantComplete = true;
							break;
						}
					}

					// If redundantComplete is false, return false
					if (!redundantComplete) {
						return false;
					}
				} else {
					// If the dependency is not an edge, return false
					return false;
				}
			}
		}
		return true;
	}

	executing() {
		this.status = CannoliObjectStatus.Executing;
		const event = new CustomEvent("update", {
			detail: { obj: this, status: CannoliObjectStatus.Executing },
		});
		this.dispatchEvent(event);
	}

	completed() {
		this.status = CannoliObjectStatus.Complete;
		const event = new CustomEvent("update", {
			detail: { obj: this, status: CannoliObjectStatus.Complete },
		});
		this.dispatchEvent(event);
	}

	pending() {
		this.status = CannoliObjectStatus.Pending;
		const event = new CustomEvent("update", {
			detail: { obj: this, status: CannoliObjectStatus.Pending },
		});
		this.dispatchEvent(event);
	}

	reject() {
		this.status = CannoliObjectStatus.Rejected;
		const event = new CustomEvent("update", {
			detail: { obj: this, status: CannoliObjectStatus.Rejected },
		});
		this.dispatchEvent(event);
	}

	tryReject() {
		// Check all dependencies
		const shouldReject = this.getAllDependencies().every((dependency) => {
			if (dependency.status === CannoliObjectStatus.Rejected) {
				// If the dependency is an edge
				if (this.cannoliGraph.isEdge(dependency)) {
					let redundantNotRejected = false;

					// Check if there are any other edge dependencies that share the same name and are not rejected
					for (const otherDependency of this.getAllDependencies()) {
						if (
							this.cannoliGraph.isEdge(otherDependency) &&
							otherDependency.text === dependency.text &&
							otherDependency.status !==
							CannoliObjectStatus.Rejected
						) {
							// If there are, set redundantNotRejected to true and break the loop
							redundantNotRejected = true;
							break;
						}
					}

					// If redundantNotRejected is true, return true to continue the evaluation
					if (redundantNotRejected) {
						return true;
					}
				}

				// If the dependency is not an edge or no redundancy was found, return false to reject
				return false;
			}

			// If the current dependency is not rejected, continue the evaluation
			return true;
		});

		// If the object should be rejected, call the reject method
		if (!shouldReject) {
			this.reject();
		}
	}

	ensureStringLength(str: string, maxLength: number): string {
		if (str.length > maxLength) {
			return str.substring(0, maxLength - 3) + "...";
		} else {
			return str;
		}
	}

	reset() {
		this.status = CannoliObjectStatus.Pending;
		const event = new CustomEvent("update", {
			detail: { obj: this, status: CannoliObjectStatus.Pending },
		});
		this.dispatchEvent(event);
	}

	dependencyRejected(dependency: CannoliObject) {
		this.tryReject();
	}

	dependencyCompleted(dependency: CannoliObject) { }

	dependencyExecuting(dependency: CannoliObject) { }

	async execute() { }

	logDetails(): string {
		let dependenciesString = "";
		for (const dependency of this.dependencies) {
			dependenciesString += `\t"${this.graph[dependency].text}"\n`;
		}

		return `Dependencies:\n${dependenciesString}\n`;
	}

	validate() { }
}

export class CannoliVertex extends CannoliObject {
	outgoingEdges: string[];
	incomingEdges: string[];
	groups: string[]; // Sorted from immediate parent to most distant

	constructor(vertexData: AllVerifiedCannoliCanvasNodeData) {
		super(vertexData);
		this.outgoingEdges = vertexData.cannoliData.outgoingEdges;
		this.incomingEdges = vertexData.cannoliData.incomingEdges;
		this.groups = vertexData.cannoliData.groups;
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

	error(message: string) {
		this.status = CannoliObjectStatus.Error;
		const event = new CustomEvent("update", {
			detail: {
				obj: this,
				status: CannoliObjectStatus.Error,
				message: message,
			},
		});
		this.dispatchEvent(event);
		console.error(message);
	}

	warning(message: string) {
		this.status = CannoliObjectStatus.Warning;
		const event = new CustomEvent("update", {
			detail: {
				obj: this,
				status: CannoliObjectStatus.Warning,
				message: message,
			},
		});
		this.dispatchEvent(event);
		console.error(message); // Consider changing this to console.warn(message);
	}

	validate() {
		super.validate();
	}
}
