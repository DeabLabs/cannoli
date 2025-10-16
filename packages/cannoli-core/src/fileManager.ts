import { Reference } from "./graph";

export interface FileManager {
  editNote(
    reference: Reference,
    newContent: string,
    isMock: boolean,
    append?: boolean,
  ): Promise<void | null>;

  getNote(
    reference: Reference,
    isMock: boolean,
    recursionCount?: number,
  ): Promise<string | null>;

  getFile(fileName: string, isMock: boolean): Promise<ArrayBuffer | null>;

  getCanvas(fileName: string, isMock: boolean): Promise<string | null>;

  editSelection(newContent: string, isMock: boolean): void;

  getPropertyOfNote(
    noteName: string,
    propertyName: string,
    yamlFormat: boolean,
  ): Promise<string | null>;

  getAllPropertiesOfNote(
    noteName: string,
    yamlFormat: boolean,
  ): Promise<string | null>;

  editPropertyOfNote(
    noteName: string,
    propertyName: string,
    newValue: string,
  ): Promise<void>;

  createNoteAtExistingPath(
    noteName: string,
    path?: string,
    content?: string,
    verbose?: boolean,
  ): Promise<string | null>;

  createNoteAtNewPath(
    noteName: string,
    path: string,
    content?: string,
    verbose?: boolean,
  ): Promise<string>;

  getNotePath(noteName: string): Promise<string | null>;

  createFolder(path: string, verbose?: boolean): Promise<boolean>;

  moveNote(
    noteName: string,
    newPath: string,
    verbose?: boolean,
  ): Promise<boolean>;
}
