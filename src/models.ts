import { EventEmitter } from "events";

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
	dependencies: (CannoliObject | CannoliObject[])[];
	dependents: CannoliObject[];

	constructor(id: string, text: string) {
		super();
		this.id = id;
		this.text = text;
		this.status = CannoliObjectStatus.Pending;
		this.dependencies = [];
		this.dependents = [];
	}

	validate() {}

	logDetails() {}

	addDependency(dependency: CannoliObject | CannoliObject[]) {
		this.dependencies.push(dependency);

		// If its an array, add listeners to each element
		if (Array.isArray(dependency)) {
			for (const element of dependency) {
				element.on(CannoliObjectStatus.Complete, () => {
					if (this.canExecute()) {
						this.execute();
					}
				});

				element.on(CannoliObjectStatus.Rejected, () => {
					if (this.canReject()) {
						this.reject();
					}
				});
			}
		}
		// If its not an array, add listeners to the element
		else {
			// Set up a listener for the dependency's completion event
			dependency.on(CannoliObjectStatus.Complete, (obj, mock) => {
				if (this.canExecute(mock)) {
					this.execute(mock);
				}
			});

			// Set up a listener for the dependency's rejection event
			dependency.on(CannoliObjectStatus.Rejected, (obj, mock) => {
				if (this.canReject(mock)) {
					this.reject(mock);
				}
			});
		}
	}

	addDependent(dependent: CannoliObject) {
		this.dependents.push(dependent);
	}

	canExecute(mock?: MockRun): boolean {
		// Check if all dependencies have status "complete", and for each dependency that is an array, check if one of the elements has status "complete" (if more than one element has status "complete", error)
		return this.dependencies.every((dependency) => {
			if (Array.isArray(dependency)) {
				const completeDependencies = dependency.filter(
					(dependency) =>
						dependency.status === CannoliObjectStatus.Complete
				);
				if (completeDependencies.length > 1) {
					throw new Error(
						`Error on object ${this.id}: more than one dependency has status "Complete". Check that edges with the same variable are coming from different branches of a choice node.`
					);
				} else if (completeDependencies.length === 1) {
					return true;
				} else {
					return false;
				}
			} else {
				return dependency.status === CannoliObjectStatus.Complete;
			}
		});
	}

	async execute(mock?: MockRun) {
		this.status = CannoliObjectStatus.Executing;
		this.emit(CannoliObjectStatus.Executing, this, mock);

		if (mock) {
			await this.mockRun();
		} else {
			await this.run();
		}

		this.status = CannoliObjectStatus.Complete;
		this.emit(CannoliObjectStatus.Complete, this, mock);
	}

	async run() {}

	async mockRun() {}

	canReject(run: Run): boolean {
		if (mock) {
			//
		} else {
			// Check all dependencies
			return this.dependencies.every((dependency) => {
				// If it's an array and all elements have status "rejected", return true, if not, continue
				if (Array.isArray(dependency)) {
					if (
						dependency.every(
							(dependency) =>
								dependency.status ===
								CannoliObjectStatus.Rejected
						)
					) {
						return true;
					}
				} else {
					// If it's not an array and has status "rejected", return true, if not, continue
					if (dependency.status === CannoliObjectStatus.Rejected) {
						return true;
					}
				}
			});
		}
	}

	reject(mock?: MockRun) {
		this.status = CannoliObjectStatus.Rejected;
		this.emit(CannoliObjectStatus.Rejected, this, mock);
	}

	reset() {
		this.status = CannoliObjectStatus.Pending;
	}
}

export class CannoliVertex extends CannoliObject {
	outgoingEdges: CannoliEdge[];
	incomingEdges: CannoliEdge[];

	constructor(id: string, text: string) {
		super(id, text);
		this.outgoingEdges = [];
		this.incomingEdges = [];
	}

	addOutgoingEdge(edge: CannoliEdge) {
		this.outgoingEdges.push(edge);
	}

	addIncomingEdge(edge: CannoliEdge) {
		this.incomingEdges.push(edge);
	}

	// Add any specific methods related to Vertex functionality here
}
