import { CannoliObject } from "./models";

class Run {
	id: string;
	usage: {
		[model: string]: {
			promptTokens: number;
			completionTokens: number;
			apiCalls: number;
		};
	};
	graph: CannoliObject;
}
