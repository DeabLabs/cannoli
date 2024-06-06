import { SearchConfig } from "./models/node";

export interface SearchSource {
    name: string;

    search(content: string, config: SearchConfig): Promise<string[] | Error>;
}

