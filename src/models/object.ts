import { EventEmitter } from "events";
import type { CannoliEdge } from "./edge";
import type { CannoliGroup } from "./group";
import type { Run } from "src/run";
import {
	AllVerifiedCannoliCanvasNodeData,
	CannoliObjectKind,
	CannoliObjectStatus,
	EdgeType,
	GroupType,
	NodeType,
	VerifiedCannoliCanvasEdgeData,
} from "./graph";
export class CannoliObject extends EventEmitter {
	run: Run;
	id: string;
	text: string;
	status: CannoliObjectStatus;
	dependencies: string[];
	graph: Record<string, CannoliObject>;
	canvasData:
		| AllVerifiedCannoliCanvasNodeData
		| VerifiedCannoliCanvasEdgeData;
	isClone: boolean;
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
		this.isClone = data.cannoliData.isClone;
		this.kind = data.cannoliData.kind;
		this.type = data.cannoliData.type;
		this.canvasData = data;
	}

	setRun(run: Run) {
		this.run = run;
	}

	setGraph(graph: Record<string, CannoliObject>) {
		this.graph = graph;
	}

	setupListeners() {
		// For each dependency
		for (const dependency of this.dependencies) {
			// Set up a listener for the dependency's completion event
			this.graph[dependency].on("update", (obj, status) => {
				this.dependencyUpdated(obj, status);
			});
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
			// If it's not an array and has status "rejected", return true, if not, continue
			if (
				this.graph[dependency].status === CannoliObjectStatus.Rejected
			) {
				this.status = CannoliObjectStatus.Rejected;
				this.emit("update", this, CannoliObjectStatus.Rejected);
				return true;
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
}

export class CannoliVertex extends CannoliObject {
	outgoingEdges: string[];
	incomingEdges: string[];
	groups: string[]; // Sorted from immediate parent to most distant

	constructor(vertexData: AllVerifiedCannoliCanvasNodeData) {
		super(vertexData);
		this.outgoingEdges = vertexData.outgoingEdges;
		this.incomingEdges = vertexData.incomingEdges;
		this.groups = vertexData.groups;
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
		this.emit("update", this, CannoliObjectStatus.Error, message);
		console.error(message);
	}

	validate() {
		super.validate();
	}
}
