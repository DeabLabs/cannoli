// import { Configuration, OpenAIApi } from "openai";
// // import { ErrorModal } from "main";
// import { Vault, TFile } from "obsidian";
// import { Canvas } from "./canvas";

// import { CannoliObject } from "./models/object";
// import { CannoliFactory } from "./factory";
// import { Run, Stoppage } from "./run";

// export class CannoliGraph {
// 	graph: Record<string, CannoliObject>;

// 	constructor(canvasFile: TFile, apiKey: string, vault: Vault) {
// 		this.graph = {};

// 		const configuration = new Configuration({ apiKey: apiKey });
// 		delete configuration.baseOptions.headers["User-Agent"];

// 		// Create an instance of OpenAI
// 		this.openai = new OpenAIApi(configuration);
// 	}

// 	async initialize(verbose = false) {

// 	}

// 	async run(onFinish: (stoppage: Stoppage) => void) {
// 		const run = new Run({
// 			graph: this.graph,
// 			onFinish,
// 			cannoli: this,
// 			vault: this.vault,
// 		});

// 		run.reset();

// 		await run.start();
// 	}

// setCompleteListeners() {
// 	for (const object of Object.values(this.graph)) {
// 		object.on("update", (object, status, run) => {
// 			if (status === CannoliObjectStatus.Complete) {
// 				this.nodeCompleted();
// 			}
// 		});
// 	}
// }

// nodeCompleted() {
// 	// Check if all objects are complete or rejected
// 	for (const object of Object.values(this.graph)) {
// 		if (
// 			object.status !== CannoliObjectStatus.Complete &&
// 			object.status !== CannoliObjectStatus.Rejected
// 		) {
// 			return;
// 		}
// 	}

// 	// If all objects are complete or rejected, call runCompleted
// 	this.runCompleted();
// }

// runCompleted() {
// 	this.resolveRunCompleted();
// }

// async mockRun() {
// 	const mockRun = new Run({
// 		graph: this.graph,
// 		isMock: true,
// 		cannoli: this,
// 	});

// 	await mockRun.start();

// 	console.log("Mock run completed");
// }

// executeRootObjects(run: Run) {
// 	for (const object of Object.values(this.graph)) {
// 		if (object.dependencies.length === 0) {
// 			object.execute(run);
// 		}
// 	}
// }

// async reset() {
// 	// Create a promise
// 	const completedPromise = new Promise<void>((resolve) => {
// 		// Create a run
// 		const run = new Run({
// 			graph: this.graph,
// 			isMock: false,
// 			onFinish: () => {
// 				resolve();
// 			},
// 		});

// 		// Reset the status of all objects
// 		for (const object of Object.values(this.graph)) {
// 			object.reset(run);
// 		}
// 	});

// 	// Await the promise
// 	await completedPromise;
// }

// createRunPromise() {
// 	this.runCompletedPromise = new Promise((resolve) => {
// 		this.resolveRunCompleted = resolve;
// 	});
// }
// }
