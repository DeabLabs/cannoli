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
	isClone: boolean;

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
		this.graph = {};
		this.isClone = isClone;
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

	reset(run: Run) {
		this.status = CannoliObjectStatus.Pending;
		this.emit("update", this, CannoliObjectStatus.Pending, run);
	}

	dependencyRejected(dependency: CannoliObject, run: Run) {
		this.tryReject(run);
	}

	dependencyCompleted(dependency: CannoliObject, run: Run) {}

	async run() {}

	async mockRun() {}

	logDetails(): string {
		return "";
	}

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
		isClone: boolean,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone);
		this.canvasData = canvasData;
		this.outgoingEdges = [];
		this.incomingEdges = [];
	}

	addIncomingEdge(id: string, isReflexive: boolean) {
		this.incomingEdges.push({ id, isReflexive });
		// if (!isReflexive) {
		// 	this.addDependency(id);
		// }
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
	content: string | Record<string, string> | undefined;
	isLoaded: boolean;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, isClone);
		this.source = source;
		this.target = target;
		this.canvasData = canvasData;

		this.isLoaded = false;

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
	}): void {
		// We should never be calling the base class load method
		throw new Error(
			`Error on edge ${
				this.id
			}: load is not implemented. Attempted to load content "${content}" and messages "${JSON.stringify(
				messages,
				null,
				2
			)}".`
		);
	}

	dependencyCompleted(dependency: CannoliObject, run: Run): void {
		if (this.allDependenciesComplete()) {
			this.execute(run);
		}
	}

	async run() {
		if (!this.isLoaded) {
			throw new Error(
				`Error on edge ${this.id}: edge is being run but has not been loaded.`
			);
		}
	}

	async mockRun() {
		if (!this.isLoaded) {
			throw new Error(
				`Error on edge ${this.id}: edge is being run but has not been loaded.`
			);
		}
	}

	logDetails(): string {
		// Build crossing groups string of the text of the crossing groups
		let crossingGroupsString = "";
		crossingGroupsString += `Crossing Out Groups: `;
		for (const group of this.crossingOutGroups) {
			crossingGroupsString += `\t-"${ensureStringLength(
				this.graph[group].text,
				15
			)}`;
		}
		crossingGroupsString += `\nCrossing In Groups: `;
		for (const group of this.crossingInGroups) {
			crossingGroupsString += `\t-"${ensureStringLength(
				this.graph[group].text,
				15
			)}`;
		}

		return (
			super.logDetails() +
			`---> Edge ${this.id} Text: "(${
				this.text
			})"\nSource: "${ensureStringLength(
				this.getSource().text,
				15
			)}\nTarget: "${ensureStringLength(
				this.getTarget().text,
				15
			)}"\n${crossingGroupsString}\n`
		);
	}

	reset(run: Run) {
		super.reset(run);
		this.isLoaded = false;
		this.content = undefined;
	}
}

export class CannoliGroup extends CannoliVertex {
	members: string[];

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone, canvasData);
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
}

export class ListGroup extends CannoliGroup {
	copyId: string;
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData,
		copyId: string
	) {
		super(id, text, graph, isClone, canvasData);
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
		canvasData: AllCanvasNodeData,
		maxLoops: number
	) {
		super(id, text, graph, isClone, canvasData);
		this.maxLoops = maxLoops;
	}

	loop() {
		this.currentLoop++;
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
			this.loop();
			this.resetMembers(run);
		} else {
			this.status = CannoliObjectStatus.Complete;
			this.emit("update", this, CannoliObjectStatus.Complete, run);
		}
	}
}
export class CannoliNode extends CannoliVertex {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone, canvasData);
	}

	buildRenderFunction(): (
		variables: {
			name: string;
			content: string;
		}[]
	) => Promise<string> {
		throw new Error(
			`Error on node ${this.id}: buildRenderFunction is not implemented.`
		);
	}

	dependencyCompleted(dependency: CannoliObject, run: Run): void {
		if (this.allDependenciesComplete()) {
			this.execute(run);
		}
	}
}

export class CallNode extends CannoliNode {
	renderFunction: (
		variables: { name: string; content: string }[]
	) => Promise<string>;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone, canvasData);

		this.renderFunction = this.buildRenderFunction();
	}

	async run() {
		// TEST VERSION (sleep for random time between 0 and 3 seconds)
		console.log(`Running call node with text "${this.text}"`);
		const sleepTime = Math.random() * 3000;
		await new Promise((resolve) => setTimeout(resolve, sleepTime));
	}

	async mockRun() {
		console.log(`Mock running call node with text "${this.text}"`);
	}
}

export class ContentNode extends CannoliNode {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone, canvasData);
	}

	async run() {
		// TEST VERSION (write a random string to the text field)
		console.log(`Running content node with text "${this.text}"`);
		this.text = Math.random().toString(36).substring(7);
	}

	async mockRun() {
		console.log(`Mock running content node with text "${this.text}"`);
	}
}

export class FloatingNode extends CannoliNode {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: AllCanvasNodeData
	) {
		super(id, text, graph, isClone, canvasData);
	}

	dependencyCompleted(dependency: CannoliObject, run: Run): void {
		return;
	}

	dependencyRejected(dependency: CannoliObject, run: Run): void {
		return;
	}

	async run() {
		// We should never run a floating node, it shouldn't have any dependencies
		throw new Error(
			`Error on floating node ${this.id}: run is not implemented.`
		);
	}

	async mockRun() {
		// We should never run a floating node, it shouldn't have any dependencies
		throw new Error(
			`Error on floating node ${this.id}: mockRun is not implemented.`
		);
	}

	getName(): string {
		const firstLine = this.text.split("\n")[0];
		// Take the first and last characters off the first line
		return firstLine.substring(1, firstLine.length - 1);
	}

	// Content is everything after the first line
	getContent(): string {
		const firstLine = this.text.split("\n")[0];
		return this.text.substring(firstLine.length + 1);
	}

	editContent(newContent: string): void {
		const firstLine = this.text.split("\n")[0];
		this.text = `${firstLine}\n${newContent}`;

		// Emit an update event
		this.emit("update", this, this.status, null);
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: Floating\nName: ${this.getName()}\nContent: ${this.getContent()}\n`
		);
	}
}

export class ProvideEdge extends CannoliEdge {
	name: string | null;
	messages: ChatCompletionRequestMessage[] | undefined;
	addMessages: boolean;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		name: string | null,
		addMessages: boolean
	) {
		super(id, text, graph, isClone, canvasData, source, target);
		this.name = name;
		this.addMessages = addMessages;
	}

	reset(run: Run): void {
		super.reset(run);
		this.messages = [];
	}
}

export class ChatEdge extends ProvideEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, isClone, canvasData, source, target, null, true);
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

	logDetails(): string {
		return super.logDetails() + `Type: Chat ${this.id}`;
	}
}

export class SystemMessageEdge extends ProvideEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, isClone, canvasData, source, target, null, true);
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

	logDetails(): string {
		return super.logDetails() + `Type: SystemMessage\n`;
	}
}

export class WriteEdge extends CannoliEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, isClone, canvasData, source, target);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (typeof content === "string") {
			if (content !== undefined) {
				this.content = content;
			} else {
				throw new Error(
					`Error on Write edge ${this.id}: content is undefined.`
				);
			}

			if (messages !== undefined) {
				throw new Error(
					`Error on Write edge ${this.id}: cannot load messages.`
				);
			}
		} else {
			throw new Error(
				`Error on Write edge ${this.id}: content is a Record.`
			);
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Write\n`;
	}
}

export class LoggingEdge extends WriteEdge {
	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string
	) {
		super(id, text, graph, isClone, canvasData, source, target);
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (content !== undefined) {
			this.content = content;
		} else {
			throw new Error(
				`Error on Logging edge ${this.id}: content is undefined.`
			);
		}

		if (messages !== undefined) {
			// Append the chatHistory to the content as a string
			this.content = `${this.content}\n${JSON.stringify(
				messages,
				null,
				2
			)}`;
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Logging\n`;
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
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		setting: string
	) {
		super(id, text, graph, isClone, canvasData, source, target);
		this.setting = setting;
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
				`Error on Config edge ${this.id}: cannot load messages.`
			);
		}
	}

	logDetails(): string {
		return super.logDetails() + `Type: Config\nSetting: ${this.setting}\n`;
	}
}

export enum SingleVariableEdgeType {
	ListItem = "listItem",
	Choice = "choice",
	Vault = "vault",
}

export class SingleVariableEdge extends ProvideEdge {
	type: SingleVariableEdgeType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		name: string | null,
		addMessages: boolean,
		type: SingleVariableEdgeType
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			source,
			target,
			name,
			addMessages
		);
		this.type = type;
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (typeof content === "string") {
			if (content !== undefined) {
				this.content = content;
			} else {
				throw new Error(
					`Error on SingleVariable edge ${this.id}: content is undefined.`
				);
			}

			if (this.addMessages) {
				if (messages !== undefined) {
					this.messages = messages;
				} else {
					throw new Error(
						`Error on SingleVariable edge ${this.id}: messages undefined.`
					);
				}
			} else {
				if (messages !== undefined) {
					throw new Error(
						`Error on SingleVariable edge ${this.id}: cannot load chatHistory.`
					);
				}
			}
		} else {
			throw new Error(
				`Error on SingleVariable edge ${this.id}: content is a Record.`
			);
		}
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: SingleVariable\nName: ${this.name}\nSubtype: ${this.type}\nAddMessages: ${this.addMessages}\n`
		);
	}
}

export enum MultipleVariableEdgeType {
	List = "list",
	Category = "category",
	Function = "function",
}

export class MultipleVariableEdge extends ProvideEdge {
	type: MultipleVariableEdgeType;

	constructor(
		id: string,
		text: string,
		graph: Record<string, CannoliObject>,
		isClone: boolean,
		canvasData: CanvasEdgeData,
		source: string,
		target: string,
		name: string,
		addMessages: boolean,
		type: MultipleVariableEdgeType
	) {
		super(
			id,
			text,
			graph,
			isClone,
			canvasData,
			source,
			target,
			name,
			addMessages
		);
		this.type = type;
	}

	load({
		content,
		messages,
	}: {
		content?: string | Record<string, string>;
		messages?: ChatCompletionRequestMessage[];
	}): void {
		if (typeof content === "object") {
			if (content !== undefined) {
				this.content = content;
			} else {
				throw new Error(
					`Error on MultipleVariable edge ${this.id}: content is undefined.`
				);
			}

			if (this.addMessages) {
				if (messages !== undefined) {
					this.messages = messages;
				} else {
					throw new Error(
						`Error on MultipleVariable edge ${this.id}: messages undefined.`
					);
				}
			} else {
				if (messages !== undefined) {
					throw new Error(
						`Error on MultipleVariable edge ${this.id}: cannot load messages.`
					);
				}
			}
		} else {
			throw new Error(
				`Error on MultipleVariable edge ${this.id}: content is a string.`
			);
		}
	}

	logDetails(): string {
		return (
			super.logDetails() +
			`Type: MultipleVariable\nName: ${this.name}\nSubtype: ${this.type}\nAddMessages: ${this.addMessages}\n`
		);
	}
}

function ensureStringLength(str: string, maxLength: number): string {
	if (str.length > maxLength) {
		return str.substring(0, maxLength - 3) + "...";
	} else {
		return str;
	}
}
