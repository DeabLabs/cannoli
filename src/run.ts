import { CannoliGraph } from "./cannoli";

export class Run {
	isMock: boolean;
	usage: {
		[model: string]: {
			promptTokens: number;
			completionTokens: number;
			apiCalls: number;
		};
	};
	cannoli: CannoliGraph | null;

	constructor(isMock: boolean, cannoli?: CannoliGraph) {
		this.isMock = isMock;
		this.cannoli = cannoli ?? null;
		this.usage = {};
	}
}
