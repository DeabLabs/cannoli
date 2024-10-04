import { Run, RunArgs, Stoppage } from "./run";

export function run({ onFinish, ...args }: RunArgs): [Promise<Stoppage>, () => void] {
	let resolver: (stoppage: Stoppage) => void;
	const done = new Promise<Stoppage>((resolve) => {
		resolver = resolve;
	});

	const run = new Run({
		...args,
		onFinish: (stoppage: Stoppage) => {
			resolver(stoppage);
			if (onFinish) onFinish(stoppage);
		},
	});

	run.start();

	return [done, () => run.stop()];
}

export async function resultsRun(args: RunArgs): Promise<Record<string, string>> {
	const [done] = run({ ...args });

	const stoppage = await done;

	if (stoppage.reason === "error") {
		throw new Error(`Error occurred during the run: ${stoppage.message}`);
	}

	return stoppage.results;
}
