export class Run {
	isMock: boolean;
	usage: {
		[model: string]: {
			promptTokens: number;
			completionTokens: number;
			apiCalls: number;
		};
	};

	constructor(isMock: boolean) {
		this.isMock = isMock;
		this.usage = {};
	}
}
