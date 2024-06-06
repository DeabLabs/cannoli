import { FilesystemInterface } from "./filesystem_interface";
import { Messenger } from "./messenger";
import { ResponseTextFetcher, Run, Stoppage } from "./run";
import { SearchSource } from "./search_source";
import { LLMProvider } from "./providers";
import { Canvas } from "./canvas_interface";

export type Action = {
    name: string;
    function: (...args: string[]) => string | Error | Promise<string | Error>;
}

export class Cannoli {
    private llm: LLMProvider;
    private settings: Record<string, string | boolean | number> | undefined;
    private fileSystemInterface: FilesystemInterface | undefined;
    private actions: Action[] | undefined;
    private messengers: Messenger[] | undefined;
    private searchSources: SearchSource[] | undefined;
    private fetcher: ResponseTextFetcher | undefined;

    constructor({
        llm,
        settings,
        fileSystemInterface,
        actions,
        messengers,
        searchSources,
        fetcher,
    }: {
        llm: LLMProvider;
        settings?: Record<string, string | boolean | number>;
        fileSystemInterface?: FilesystemInterface;
        actions?: Action[];
        messengers?: Messenger[];
        searchSources?: SearchSource[];
        fetcher?: ResponseTextFetcher;
    }) {
        this.llm = llm;
        this.settings = settings;
        this.fileSystemInterface = fileSystemInterface;
        this.actions = actions;
        this.messengers = messengers;
        this.searchSources = searchSources;
        this.fetcher = fetcher;
    }

    runWithControl({
        cannoliJSON,
        args,
        canvas,
        isMock,
    }: {
        cannoliJSON: unknown;
        args?: Record<string, string>;
        canvas?: Canvas;
        isMock?: boolean;
    }): [Promise<Stoppage>, () => void] {
        let resolver: (stoppage: Stoppage) => void;
        const done = new Promise<Stoppage>((resolve) => {
            resolver = resolve;
        });

        const run = new Run({
            llm: this.llm,
            cannoliJSON: cannoliJSON,
            settings: this.settings,
            args: args,
            canvas: canvas,
            onFinish: (stoppage: Stoppage) => {
                resolver(stoppage);
            },
            fileSystemInterface: this.fileSystemInterface,
            actions: this.actions,
            messengers: this.messengers,
            searchSources: this.searchSources,
            isMock: isMock,
            fetcher: this.fetcher,
        });

        run.start();

        return [done, () => run.stop()];
    }

    async run({
        cannoliJSON,
        args,
        canvas,
        isMock,
    }: {
        cannoliJSON: unknown;
        args?: Record<string, string>;
        canvas?: Canvas;
        isMock?: boolean;
    }): Promise<Stoppage> {
        const [done] = this.runWithControl({
            cannoliJSON,
            args,
            canvas,
            isMock,
        });

        return done;
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
        const argNames: string[] = []; // Implement later
        const resultNames: string[] = []; // Implement later

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
