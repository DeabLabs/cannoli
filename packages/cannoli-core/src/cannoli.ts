import { Run, RunArgs, Stoppage } from "./run";

export async function runWithControl({
    cannoli,
    llmConfigs,
    args,
    fileManager,
    persistor,
    actions,
    replacers,
    fetcher,
    config,
    envVars,
    isMock,
    resume,
    onFinish,
}: RunArgs): Promise<[Promise<Stoppage>, () => void]> {
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
        replacers,
        isMock,
        fetcher,
        config,
        envVars,
        resume,
    });

    run.start();

    return [done, () => run.stop()];
}

export async function run({
    cannoli,
    llmConfigs,
    args,
    fileManager,
    persistor,
    actions,
    replacers,
    fetcher,
    config,
    envVars,
    isMock,
    resume,
}: RunArgs): Promise<Record<string, string>> {
    const [done] = await runWithControl({
        cannoli,
        llmConfigs,
        args,
        fileManager,
        persistor,
        actions,
        replacers,
        fetcher,
        config,
        envVars,
        isMock,
        resume,
    });

    const stoppage = await done;

    if (stoppage.reason === "error") {
        throw new Error("Error occurred during the run.");
    }

    return stoppage.results;
}
