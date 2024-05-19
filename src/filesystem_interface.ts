import { Reference } from "./models/graph";

export interface FilesystemInterface {
    executeHttpTemplateByName(
        name: string,
        body: string | Record<string, string> | null,
        isMock: boolean
    ): Promise<string | Error>;

    editNote(
        reference: Reference,
        newContent: string,
        isMock: boolean,
        append?: boolean
    ): Promise<void | null>;

    getNote(
        reference: Reference,
        isMock: boolean,
        recursionCount?: number
    ): Promise<string | null>;


    replaceDataviewQueries(content: string, isMock: boolean): Promise<string>;

    replaceLinks(resultContent: string, includeName: boolean, includeProperties: boolean, includeLink: boolean, isMock: boolean): Promise<string>;

    replaceSmartConnections(content: string, isMock: boolean): Promise<string>;

    editSelection(newContent: string, isMock: boolean): void;

    getPropertyOfNote(
        noteName: string,
        propertyName: string,
        yamlFormat: boolean
    ): Promise<string | null>;

    getAllPropertiesOfNote(
        noteName: string,
        yamlFormat: boolean
    ): Promise<string | null>;

    editPropertyOfNote(
        noteName: string,
        propertyName: string,
        newValue: string
    ): Promise<void>


    createNoteAtExistingPath(
        noteName: string,
        path?: string,
        content?: string,
        verbose?: boolean
    ): Promise<string | null>;


    createNoteAtNewPath(
        noteName: string,
        path: string,
        content?: string,
        verbose?: boolean
    ): Promise<boolean>;

    getNotePath(noteName: string): Promise<string | null>;

    createFolder(path: string, verbose?: boolean): Promise<boolean>;

    moveNote(
        noteName: string,
        newPath: string,
        verbose?: boolean
    ): Promise<boolean>;
}

