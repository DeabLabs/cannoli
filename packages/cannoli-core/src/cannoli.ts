import { Run, RunArgs, Stoppage } from "./run";
import { LLMConfig } from "./providers";
import { CannoliInfo, writeCode } from "./bake";
import { VerifiedCannoliCanvasData } from "./models/graph";

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

export type BakeRuntime = "node" | "deno" | "bun";

export type BakeLanguage = "typescript" | "javascript";

export async function bake({
    language,
    runtime,
    cannoliInfo,
    cannoli,
    cannoliName,
    llmConfigs,
    config,
    envVars,
    // actions,
    // replacers,
    // fetcher,
}: {
    language: BakeLanguage,
    runtime: BakeRuntime,
    cannoliName: string,
    cannoli: unknown,
    llmConfigs: LLMConfig[],
    cannoliInfo?: CannoliInfo,
    config?: Record<string, string | number | boolean>,
    envVars?: Record<string, string>,
    // actions?: Action[],
    // replacers?: Replacer[],
    // fetcher?: ResponseTextFetcher,
}): Promise<{ name: string; fileName: string; code: string } | Error> {
    // Mock run the cannoli
    const [done] = await runWithControl({
        cannoli,
        llmConfigs,
        config,
        envVars,
        isMock: true,
        // actions,
        // replacers,
        // fetcher,
    });

    const stoppage = await done;

    if (stoppage.reason == "error") {
        return new Error("There's an error in the cannoli. Please fix it before baking.");
    }

    // Get the args and results
    const argNames: string[] = stoppage.argNames;
    const resultNames: string[] = stoppage.resultNames;
    const description: string | undefined = stoppage.description;

    let givenArgNames: string[] = [];
    let givenResultNames: string[] = [];

    if (!cannoliInfo) {
        cannoliInfo = {
            argInfo: Object.fromEntries(argNames.map((name) => [name, null])),
            resultInfo: Object.fromEntries(resultNames.map((name) => [name, null])),
            description,
        };
    } else {
        if (cannoliInfo.argInfo) {
            givenArgNames = Object.keys(cannoliInfo.argInfo);
        } else {
            givenArgNames = argNames;
            cannoliInfo.argInfo = Object.fromEntries(argNames.map((name) => [name, null]));
        }

        if (cannoliInfo.resultInfo) {
            givenResultNames = Object.keys(cannoliInfo.resultInfo);
        } else {
            givenResultNames = resultNames;
            cannoliInfo.resultInfo = Object.fromEntries(resultNames.map((name) => [name, null]));
        }

        // Check that they contain the same names
        const argNamesMatch = argNames.length === givenArgNames.length && argNames.every(name => givenArgNames.includes(name));
        const resultNamesMatch = resultNames.length === givenResultNames.length && resultNames.every(name => givenResultNames.includes(name));

        if (!argNamesMatch || !resultNamesMatch) {
            return new Error("Mismatch between arg or result names in the cannoli info and the ones in the cannoli itself.");
        }
    }

    const code = writeCode({
        language,
        runtime,
        cannoli: cannoli as VerifiedCannoliCanvasData,
        llmConfigs,
        cannoliInfo,
        cannoliName,
        config,
        envVars,
    })

    return code;
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
