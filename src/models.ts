import { EventEmitter } from "events";
import { Run } from "./run";
import { AllCanvasNodeData, CanvasEdgeData } from "obsidian/canvas";
import { ChatCompletionRequestMessage } from "openai";

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
	outgoingEdges: { id: string; isReflexive: boolean }[];
	incomingEdges: { id: string; isReflexive: boolean }[];
	groups: string[]; // Sorted from immediate parent to most distant

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

	addIncomingEdge(id: string, isReflexive: boolean) {
		this.incomingEdges.push({ id, isReflexive });
		if (!isReflexive) {
			this.addDependency(id);
		}
	}

	addOutgoingEdge(id: string, isReflexive: boolean) {
		this.outgoingEdges.push({ id, isReflexive });
	}

	getOutgoingEdges(): CannoliEdge[] {
		return this.outgoingEdges.map(
			(edge) => this.graph[edge.id] as CannoliEdge
		);
	}

	getIncomingEdges(): CannoliEdge[] {
		return this.incomingEdges.map(
			(edge) => this.graph[edge.id] as CannoliEdge
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
}

export class CannoliEdge extends CannoliObject {
	source: string;
	target: string;
	crossingInGroups: string[];
	crossingOutGroups: string[];
	canvasData: CanvasEdgeData;
	content: string | Record<string, string>;

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

	setIncomingAndOutgoingEdges() {
		const source = this.getSource();
		const target = this.getTarget();

		if (
			source instanceof CannoliVertex &&
			target instanceof CannoliVertex
		) {
			if (
				source.groups.includes(this.target) ||
				target.groups.includes(this.source)
			) {
				source.addIncomingEdge(this.id, true);
				target.addOutgoingEdge(this.id, true);
			} else {
				source.addOutgoingEdge(this.id, false);
				target.addIncomingEdge(this.id, false);
			}
		}
	}

	setCrossingGroups() {
		// Get the source and target vertices
		const source = this.getSource();
		const target = this.getTarget();

		// Find the first shared group
		const sharedGroup = source.groups.find((group) =>
			target.groups.includes(group)
		);

		// Handle case where no shared group is found
		if (sharedGroup === undefined) {
			this.crossingOutGroups = [...source.groups];
			this.crossingInGroups = [...target.groups].reverse();
		} else {
			// Set crossingOutGroups
			const sourceIndex = source.groups.indexOf(sharedGroup);
			this.crossingOutGroups = source.groups.slice(0, sourceIndex);

			// Set crossingInGroups
			const targetIndex = target.groups.indexOf(sharedGroup);
			const tempCrossingInGroups = target.groups.slice(0, targetIndex);
			this.crossingInGroups = tempCrossingInGroups.reverse();
		}

		// Add the crossingOut groups to this edge's dependencies
		this.crossingOutGroups.forEach((group) => this.addDependency(group));
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {}
}

export class CannoliGroup extends CannoliVertex {
	members: string[];

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, canvasData);
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

export class ProvideEdge extends CannoliEdge {
	name: string | null;
	messages: ChatCompletionRequestMessage[];
	addMessages: boolean;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		name: string | null,
		addMessages: boolean
	) {
		super(id, text, graph, canvasData, source, target);
		this.name = name;
		this.addMessages = addMessages;
	}
}

export class ChatEdge extends ProvideEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, canvasData, source, target, null, true);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (messages !== undefined) {
			this.messages = messages;
		} else {
			throw new Error(
				`Error on Chat edge ${this.id}: messages is undefined.`
			);
		}

		if (content !== undefined) {
			throw new Error(
				`Error on Chat edge ${this.id}: cannot load content.`
			);
		}
	}
}

export class SystemMessageEdge extends ProvideEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, canvasData, source, target, null, true);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (content !== undefined) {
			this.messages = [
				{
					role: "system",
					content: content as string,
				},
			];
		} else {
			throw new Error(
				`Error on SystemMessage edge ${this.id}: content is undefined.`
			);
		}

		if (messages !== undefined) {
			throw new Error(
				`Error on SystemMessage edge ${this.id}: cannot load messages.`
			);
		}
	}
}

export class WriteEdge extends CannoliEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, canvasData, source, target);
	}

	load({
		content,
		chatHistory,
	}: {
		content?: string | Record<string, string>;
		chatHistory?: ChatCompletionRequestMessage[];
	}): void {
		if (content !== undefined) {
			this.content = content;
		} else {
			throw new Error(
				`Error on Write edge ${this.id}: content is undefined.`
			);
		}

		if (chatHistory !== undefined) {
			throw new Error(
				`Error on Write edge ${this.id}: cannot load chatHistory.`
			);
		}
	}
}

export class LoggingEdge extends WriteEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, canvasData, source, target);
	}

	load({
		content,
		chatHistory,
	}: {
		content?: string | Record<string, string>;
		chatHistory?: ChatCompletionRequestMessage[];
	}): void {
		if (content !== undefined) {
			this.content = content;
		} else {
			throw new Error(
				`Error on Logging edge ${this.id}: content is undefined.`
			);
		}

		if (chatHistory !== undefined) {
			// Append the chatHistory to the content as a string
			this.content = `${this.content}\n${JSON.stringify(
				chatHistory,
				null,
				2
			)}`;
		}
	}
}

export enum ConfigEdgeSetting {
	Config = "config",
	Model = "model",
	MaxTokens = "max_tokens",
	Temperature = "temperature",
	TopP = "top_p",
	FrequencyPenalty = "frequency_penalty",
	PresencePenalty = "presence_penalty",
	Stop = "stop",
}

export class ConfigEdge extends CannoliEdge {
	setting: string;
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, canvasData, source, target);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (content === undefined) {
			throw new Error(
				`Error on Config edge ${this.id}: content is undefined.`
			);
		} else {
			this.content = content;
		}

		if (messages !== undefined) {
			throw new Error(
				`Error on Config edge ${this.id}: cannot load chatHistory.`
			);
		}
	}
}

export class VariableEdge extends ProvideEdge {}

export class ListEdge extends VariableEdge {}

export class ChoiceEdge extends VariableEdge {}

export class VaultEdge extends VariableEdge {}

export class FunctionEdge extends VariableEdge {}
