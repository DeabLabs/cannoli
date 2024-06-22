import { FileManager } from "./fileManager";
import { Action, Replacer, ResponseTextFetcher, Run, RunArgs, Stoppage } from "./run";
import { LLMConfig } from "./providers";

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

export async function bake(
    cannoli: unknown,
    llmConfigs: LLMConfig[],
    fileManager?: FileManager,
    actions?: Action[],
    replacers?: Replacer[],
    fetcher?: ResponseTextFetcher,
    config?: Record<string, unknown>,
    envVars?: Record<string, string>,
): Promise<{
    argNames: string[];
    resultNames: string[];
    cannoliFunction: (args: Record<string, string>) => Promise<Record<string, string>>;
}> {
    // Mock run the cannoli
    const [done] = await runWithControl({
        cannoli,
        llmConfigs,
        fileManager,
        actions,
        replacers,
        fetcher,
        config,
        envVars,
        isMock: true,
    });

    const stoppage = await done;

    if (stoppage.reason == "error") {
        throw new Error("There's an error in the cannoli. Please fix it before baking.");
    }

    // Get the args and results
    const argNames: string[] = stoppage.argNames;
    const resultNames: string[] = stoppage.resultNames;

    // Build the function
    const cannoliFunction = async (args: Record<string, string>): Promise<Record<string, string>> => {
        const missingArgs = argNames.filter(arg => !(arg in args));
        if (missingArgs.length > 0) {
            throw new Error(`Missing required arguments: ${missingArgs.join(", ")}`);
        }

        return run({
            cannoli,
            llmConfigs,
            args,
            fileManager,
            actions,
            replacers,
            fetcher,
            config,
            envVars,
        });
    };

    return { argNames, resultNames, cannoliFunction };
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
