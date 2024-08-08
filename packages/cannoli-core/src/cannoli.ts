import { Run, RunArgs, Stoppage } from "./run";

export function run({
    cannoli,
    llmConfigs,
    args,
    fileManager,
    persistor,
    actions,
    httpTemplates,
    replacers,
    fetcher,
    config,
    secrets,
    isMock,
    resume,
    onFinish,
}: RunArgs): [Promise<Stoppage>, () => void] {
    let resolver: (stoppage: Stoppage) => void;
    const done = new Promise<Stoppage>((resolve) => {
        resolver = resolve;
    });

    const run = new Run({
        llmConfigs,
        cannoli,
        args,
        persistor,
        onFinish: (stoppage: Stoppage) => {
            resolver(stoppage);
            if (onFinish) onFinish(stoppage);
        },
        fileManager,
        actions,
        httpTemplates,
        replacers,
        isMock,
        fetcher,
        config,
        secrets,
        resume,
    });

    run.start();

    return [done, () => run.stop()];
}

export async function resultsRun({
    cannoli,
    llmConfigs,
    args,
    fileManager,
    persistor,
    actions,
    httpTemplates,
    replacers,
    fetcher,
    config,
    secrets,
    isMock,
    resume,
}: RunArgs): Promise<Record<string, string>> {
    const [done] = run({
        cannoli,
        llmConfigs,
        args,
        fileManager,
        persistor,
        actions,
        httpTemplates,
        replacers,
        fetcher,
        config,
        secrets,
        isMock,
        resume,
    });

    const stoppage = await done;

    if (stoppage.reason === "error") {
        throw new Error(`Error occurred during the run: ${stoppage.message}`);
    }

    return stoppage.results;
}
