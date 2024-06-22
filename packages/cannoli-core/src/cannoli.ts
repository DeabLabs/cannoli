import { FilesystemInterface } from "./filesystem_interface";
import { ResponseTextFetcher, Run, Stoppage } from "./run";
import { LLMConfig } from "./providers";
import { Persistor } from "./persistor";

export type ArgInfo = {
    category: "config" | "env" | "arg" | "files" | "fetcher";
    type?: "string" | "number" | "boolean" | string[];
    displayName?: string;
    description?: string;
}

export type ActionArgs = {
    [key: string]: string | number | boolean | FilesystemInterface | ResponseTextFetcher | undefined;
};

export type ActionResponse = string | string[] | Record<string, string | string[]> | void | Error | Promise<string | string[] | Record<string, string | string[]> | void | Error>;

export type ReceiveInfo = string | string[] | Record<string, string | string[]>

export type Action = {
    name: string;
    function: (args: ActionArgs) => ActionResponse;
    receive?: (receiveInfo: ReceiveInfo) => ActionResponse;
    displayName?: string;
    description?: string;
    argInfo?: Record<string, ArgInfo>;
    resultKeys?: string[];
};

export class Cannoli {
    private llmConfigs: LLMConfig[];
    private fileSystemInterface: FilesystemInterface | undefined;
    private actions: Action[] | undefined;
    private fetcher: ResponseTextFetcher | undefined;
    private config: Record<string, unknown> | undefined;

    constructor({
        llmConfigs,
        fileSystemInterface,
        actions,
        fetcher,
        config,
    }: {
        llmConfigs: LLMConfig[];
        fileSystemInterface?: FilesystemInterface;
        actions?: Action[];
        fetcher?: ResponseTextFetcher;
        config?: Record<string, unknown>;
    }) {
        this.llmConfigs = llmConfigs;
        this.fileSystemInterface = fileSystemInterface;
        this.actions = actions;
        this.fetcher = fetcher;
        this.config = config;
    }

    async run({
        cannoliJSON,
        args,
        persistor,
        isMock,
    }: {
        cannoliJSON: unknown;
        args?: Record<string, string>;
        persistor?: Persistor;
        isMock?: boolean;
    }): Promise<Stoppage> {
        const [done] = this.runWithControl({
            cannoliJSON,
            args,
            persistor,
            isMock,
        });

        return done;
    }

    runWithControl({
        cannoliJSON,
        args,
        persistor,
        isMock,
    }: {
        cannoliJSON: unknown;
        args?: Record<string, string>;
        persistor?: Persistor;
        isMock?: boolean;
    }): [Promise<Stoppage>, () => void] {
        let resolver: (stoppage: Stoppage) => void;
        const done = new Promise<Stoppage>((resolve) => {
            resolver = resolve;
        });

        const run = new Run({
            llmConfigs: this.llmConfigs,
            cannoliJSON: cannoliJSON,
            args: args,
            persistor: persistor,
            onFinish: (stoppage: Stoppage) => {
                resolver(stoppage);
            },
            fileSystemInterface: this.fileSystemInterface,
            actions: this.actions,
            isMock: isMock,
            fetcher: this.fetcher,
            config: this.config,
        });

        run.start();

        return [done, () => run.stop()];
    }

    async bake(
        cannoliJSON: unknown,
    ): Promise<(args: Record<string, string>) => Promise<Record<string, string>>> {
        // Mock run the cannoli
        const stoppage = await this.run({
            cannoliJSON,
            isMock: true,
        });

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

            return this.run({
                cannoliJSON,
                args,
            }).then((stoppage) => {
                // Assuming stoppage contains the results in some form
                const results: Record<string, string> = {};

                resultNames.forEach((name) => {
                    results[name] = stoppage.results[name];
                });

                return results;
            });
        };

        return cannoliFunction;
    }
}
