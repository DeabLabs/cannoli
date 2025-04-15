import Cannoli from "./main";
import {
  Reference,
  ReferenceType,
  FileManager,
  CannoliNode,
  ContentNodeType,
} from "@deablabs/cannoli-core";
import { resolveSubpath } from "obsidian";
import { getAPI } from "obsidian-dataview";
import * as yaml from "js-yaml";
import { CustomModal } from "./modals/customModal";

export class VaultInterface implements FileManager {
  private cannoli: Cannoli;

  constructor(cannoli: Cannoli) {
    this.cannoli = cannoli;

    this.replaceDataviewQueries = this.replaceDataviewQueries.bind(this);
    this.replaceSmartConnections = this.replaceSmartConnections.bind(this);
  }

  getPathFromName(name: string): string {
    let path = name;

    if (path.includes("|")) {
      path = path.split("|")[0];
    }

    return path.replace("[[", "").replace("]]", "");
  }

  async editNote(
    reference: Reference,
    newContent: string,
    isMock: boolean,
    append?: boolean,
  ): Promise<void | null> {
    // Only edit the file if we're not mocking
    if (isMock) {
      return;
    }

    const path = this.getPathFromName(reference.name);

    const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file) {
      return null;
    }

    if (append) {
      await this.cannoli.app.vault.process(file, (content) => {
        return content + newContent;
      });
      // If the active file is the file we just edited, update the editor
      if (
        this.cannoli.app.workspace.activeEditor?.file?.basename ===
        file.basename
      ) {
        // If the content is a user template, wait a bit and then move the cursor to the end of the file
        const userTemplate =
          "\n\n" +
          this.cannoli.settings.chatFormatString
            ?.replace("{{role}}", "User")
            .replace("{{content}}", "");

        if (newContent === userTemplate) {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }

        // If the setting is enabled, scroll to the end of the file
        if (this.cannoli.settings.autoScrollWithTokenStream) {
          // Set the cursor to the end of the file
          this.cannoli.app.workspace.activeEditor?.editor?.setCursor(
            this.cannoli.app.workspace.activeEditor?.editor?.lineCount() || 0,
            0,
          );
        }
      }
    } else {
      if (reference.includeProperties) {
        await this.cannoli.app.vault.modify(file, newContent);
      } else {
        await this.cannoli.app.vault.process(file, (content) => {
          // If includeProperties is false, the edit shouldn't change the yaml frontmatter
          const yamlFrontmatter = content.match(/^---\n[\s\S]*?\n---\n/)?.[0];

          if (yamlFrontmatter) {
            return yamlFrontmatter + newContent;
          } else {
            return newContent;
          }
        });
      }
    }

    return;
  }

  async getFile(fileName: string): Promise<ArrayBuffer | null> {
    const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
      fileName,
      "",
    );

    if (!file) {
      return null;
    }

    return await this.cannoli.app.vault.readBinary(file);
  }

  async getCanvas(fileName: string, isMock: boolean): Promise<string | null> {
    const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(
      fileName,
      "",
    );

    if (!file) {
      return null;
    }

    const content = await this.cannoli.app.vault.read(file);

    return content;
  }

  async getNote(
    reference: Reference,
    isMock: boolean,
    recursionCount = 0,
  ): Promise<string | null> {
    // If we're mocking, return a mock response
    if (isMock) {
      return `# ${reference.name}\nMock note content`;
    }

    const path = this.getPathFromName(reference.name);

    const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file) {
      return null;
    }

    // Read the file
    let content = await this.cannoli.app.vault.read(file);

    if (reference.subpath) {
      const metadata = this.cannoli.app.metadataCache.getCache(file.path);

      if (!metadata) return null;

      const subpath = resolveSubpath(metadata, reference.subpath);

      if (!subpath) return null;

      const startLine = subpath.start.line;
      const endLine: number | null = subpath.end?.line ?? null;

      const lines = content.split("\n");

      if (endLine) {
        if (startLine === endLine) {
          return lines[startLine].trim();
        } else {
          content = lines.slice(startLine, endLine).join("\n");
        }
      } else {
        content = lines.slice(startLine).join("\n");
      }

      // If includeLink is true, add the markdown link
      if (reference.includeLink) {
        const link = `[[${file.path}#${reference.subpath}|${file.basename}]]`;
        content = link + "\n\n" + content;
      }

      content = content.trim();

      if (content === "") {
        return null;
      }
    } else {
      // If includeProperties is false, check for yaml frontmatter and remove it
      if (
        reference.includeProperties ??
        this.cannoli.settings.includePropertiesInExtractedNotes
      ) {
        // Empty
      } else {
        const yamlFrontmatter = content.match(/^---\n[\s\S]*?\n---\n/)?.[0];

        if (yamlFrontmatter) {
          content = content.replace(yamlFrontmatter, "");
        }
      }

      // If includeLink is true, add the markdown link
      if (reference.includeLink) {
        const link = `[[${file.path}|${file.basename}]]`;
        content = link + "\n\n" + content;
      }

      // If includeFilenameAsHeader is true, add the filename as a header
      if (
        reference.includeName ??
        this.cannoli.settings.includeFilenameAsHeader
      ) {
        const header = `# ${file.basename}\n`;
        content = header + content;
      }
    }

    const embeddedNotes = content.match(/!\[\[[\s\S]*?\]\]/g);

    if (embeddedNotes) {
      for (const embeddedNote of embeddedNotes) {
        let noteName = embeddedNote.replace("![[", "").replace("]]", "");

        let subpath;

        // Image extensions
        const imageExtensions = [
          ".jpg",
          ".png",
          ".jpeg",
          ".gif",
          ".bmp",
          ".tiff",
          ".webp",
          ".svg",
          ".ico",
          ".jfif",
          ".avif",
        ];
        if (imageExtensions.some((ext) => noteName.endsWith(ext))) {
          continue;
        }

        // If there's a pipe, split and use the first part as the note name
        if (noteName.includes("|")) {
          noteName = noteName.split("|")[0];
        }

        // If there's a "#", split and use the first part as the note name, and the second part as the heading
        if (noteName.includes("#")) {
          const split = noteName.split("#");
          noteName = split[0];
          subpath = split[1];
        }

        // Check for recursive embedded notes
        if (noteName === reference.name) {
          continue;
        }

        // Check for recursion limit (hardcoded to 10 for now)
        if (recursionCount > 10) {
          console.error(
            `Recursion limit reached while extracting note "${noteName}".`,
          );
          continue;
        }

        const noteContent = await this.getNote(
          {
            name: noteName,
            type: ReferenceType.Note,
            shouldExtract: true,
            includeName: true,
            subpath: subpath,
          },
          isMock,
          recursionCount + 1,
        );

        if (noteContent) {
          const blockquotedNoteContent =
            "> " + noteContent.replace(/\n/g, "\n> ");
          content = content.replace(embeddedNote, blockquotedNoteContent);
        }
      }
    }

    // Render dataview queries
    content = await this.replaceDataviewQueries(content, isMock);

    // Render smart connections
    content = await this.replaceSmartConnections(content, isMock);

    return content;
  }

  async replaceDataviewQueries(
    content: string,
    isMock: boolean,
    node?: CannoliNode,
  ): Promise<string> {
    if (node && node.type === ContentNodeType.Http) {
      return content;
    }

    const nonEmbedRegex = /```dataview\n([\s\S]*?)\n```/g;
    const embedRegex = /{{\n```dataview\n([\s\S]*?)\n```\n([^\n]*)}}/g;
    const anyDataviewRegex = /```dataview\n([\s\S]*?)\n```/;

    if (!anyDataviewRegex.test(content)) {
      return content;
    }

    const dvApi = getAPI(this.cannoli.app);
    if (!dvApi) {
      return content;
    }

    // Handle embedded dataview queries

    let embedMatch;
    const embedMatches = [];
    // Extract all matches first
    while ((embedMatch = embedRegex.exec(content)) !== null) {
      embedMatches.push({
        fullMatch: embedMatch[0],
        query: embedMatch[1],
        modifiers: embedMatch[2],
        index: embedMatch.index,
      });
    }

    // Reverse the matches array to process from last to first
    embedMatches.reverse();

    // Process each match asynchronously
    for (const match of embedMatches) {
      let includeName = false;
      let includeProperties = false;
      let includeLink = false;

      if (match.modifiers.includes("!#")) {
        includeName = false;
      } else if (match.modifiers.includes("#")) {
        includeName = true;
      } else {
        includeName = this.cannoli.settings.includeFilenameAsHeader;
      }

      if (match.modifiers.includes("!^")) {
        includeProperties = false;
      } else if (match.modifiers.includes("^")) {
        includeProperties = true;
      } else {
        includeProperties =
          this.cannoli.settings.includePropertiesInExtractedNotes;
      }

      if (match.modifiers.includes("!@")) {
        includeLink = false;
      } else if (match.modifiers.includes("@")) {
        includeLink = true;
      } else {
        includeLink = this.cannoli.settings.includeLinkInExtractedNotes;
      }

      const dvApi = getAPI(this.cannoli.app);
      if (!dvApi) {
        continue;
      }

      const queryResult = await dvApi.queryMarkdown(match.query);
      const result = queryResult.successful
        ? queryResult.value
        : "Invalid dataview query";

      const resultLinksReplaced = await this.replaceLinks(
        result,
        includeName,
        includeProperties,
        includeLink,
        isMock,
      );

      // Replace the original text with the result
      content =
        content.substring(0, match.index) +
        resultLinksReplaced +
        content.substring(match.index + match.fullMatch.length);
    }

    // Handle normal dataview queries
    let nonEmbedMatch;
    const nonEmbedMatches = [];

    while ((nonEmbedMatch = nonEmbedRegex.exec(content)) !== null) {
      nonEmbedMatches.push({
        fullMatch: nonEmbedMatch[0],
        query: nonEmbedMatch[1],
        index: nonEmbedMatch.index,
      });
    }

    // Reverse the matches array to process from last to first
    nonEmbedMatches.reverse();

    // Process each match asynchronously
    for (const match of nonEmbedMatches) {
      const queryResult = await dvApi.queryMarkdown(match.query);
      let result = queryResult.successful
        ? queryResult.value
        : "Invalid Dataview query";

      // Check if the result is a single line list, and if so, remove the bullet point
      if (result.startsWith("- ") && result.split("\n").length === 2) {
        result = result.substring(2);
      }

      // Replace the original text with the result
      content =
        content.substring(0, match.index) +
        result +
        content.substring(match.index + match.fullMatch.length);
    }

    return content;
  }

  async queryDataviewList(query: string): Promise<string[] | Error> {
    const dvApi = getAPI(this.cannoli.app);
    if (!dvApi) {
      return new Error("Dataview plugin not found");
    }

    const testResult = await dvApi.query(query);

    if (!testResult.successful) {
      return new Error(testResult.error);
    } else if (testResult.value.type !== "list") {
      return new Error("Dataview query result must be a list");
    }

    const result = await dvApi.queryMarkdown(query);

    const markdownList = result.successful
      ? result.value
      : "Invalid Dataview query";

    // Turn the markdown list into an array of strings and clean up the list items
    const list = markdownList
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0) // Remove empty lines
      .map((line) => line.replace(/^- /, "")); // Remove the leading "- "

    return list;
  }

  async replaceLinks(
    resultContent: string,
    includeName: boolean,
    includeProperties: boolean,
    includeLink: boolean,
    isMock: boolean,
  ): Promise<string> {
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    let processedContent = "";
    let lastIndex = 0;
    let match;
    while ((match = linkRegex.exec(resultContent)) !== null) {
      processedContent += resultContent.substring(lastIndex, match.index);

      const reference = {
        name: match[1],
        type: ReferenceType.Note,
        shouldExtract: true,
        includeName: includeName,
        includeProperties: includeProperties,
        includeLink: includeLink,
      };

      const noteContent = await this.getNote(reference, isMock);

      // If the processed content ends with "- ", remove it
      if (processedContent.endsWith("- ")) {
        processedContent = processedContent.substring(
          0,
          processedContent.length - 2,
        );
      }

      processedContent += noteContent;
      lastIndex = match.index + match[0].length;
    }
    processedContent += resultContent.substring(lastIndex);

    return processedContent;
  }

  async replaceSmartConnections(
    content: string,
    isMock: boolean,
    node?: CannoliNode,
  ): Promise<string> {
    if (node && node.type === ContentNodeType.Http) {
      return content;
    }

    const nonEmbedRegex = /```smart-connections\n([\s\S]*?)\n```/g;
    const embedRegex =
      /{{([^\n]*)\n```smart-connections\n([\s\S]*?)\n```\n([^\n]*)}}/g;
    const anySCRegex = /```smart-connections\n([\s\S]*?)\n```/;

    if (!anySCRegex.test(content)) {
      return content;
    }

    // This is what we're trying to access: !this.cannoli.app.plugins.plugins["smart-connections"].api
    // We need to try to access it in a way that doesn't throw an error if the plugin isn't found
    try {
      // @ts-ignore - This is a private API
      if (!this.cannoli.app.plugins.plugins["smart-connections"].api) {
        console.error("Smart Connections plugin not found");
        return content;
      }
    } catch (error) {
      return content;
    }

    // Handle embedded dataview queries

    let embedMatch;
    const embedMatches = [];
    // Extract all matches first
    while ((embedMatch = embedRegex.exec(content)) !== null) {
      embedMatches.push({
        fullMatch: embedMatch[0],
        limit: embedMatch[1],
        query: embedMatch[2],
        modifiers: embedMatch[3],
        index: embedMatch.index,
      });
    }

    // Reverse the matches array to process from last to first
    embedMatches.reverse();

    // Process each match asynchronously
    for (const match of embedMatches) {
      let includeName = false;
      let includeProperties = false;
      let includeLink = false;

      if (match.modifiers.includes("!#")) {
        includeName = false;
      } else if (match.modifiers.includes("#")) {
        includeName = true;
      } else {
        includeName = this.cannoli.settings.includeFilenameAsHeader;
      }

      if (match.modifiers.includes("!^")) {
        includeProperties = false;
      } else if (match.modifiers.includes("^")) {
        includeProperties = true;
      } else {
        includeProperties =
          this.cannoli.settings.includePropertiesInExtractedNotes;
      }

      if (match.modifiers.includes("!@")) {
        includeLink = false;
      } else if (match.modifiers.includes("@")) {
        includeLink = true;
      } else {
        includeLink = this.cannoli.settings.includeLinkInExtractedNotes;
      }

      // @ts-ignore - This is a private API
      let result = await this.cannoli.app.plugins.plugins[
        "smart-connections"
      ].api.search(match.query);

      // If there's no limit defined, use the default limit of 5. If the limit is defined, parse it as an integer and truncate the results array
      const limit = match.limit ? parseInt(match.limit) : 5;

      if (result.length > limit) {
        result = result.slice(0, limit);
      }

      // Build the replacement string by retrieving the note content for each result and concatenating them with a newline
      let resultLinksReplaced = "";
      for (const r of result) {
        let noteName = r.path;
        let subpath;

        // If there's a "#" in the path, split and use the first part as the note name, and the second part as the heading
        if (noteName.includes("#")) {
          const split = noteName.split("#");
          noteName = split[0];
          subpath = split[1];
        }

        const reference = {
          name: noteName,
          type: ReferenceType.Note,
          shouldExtract: true,
          includeName: includeName,
          includeProperties: includeProperties,
          includeLink: includeLink,
          subpath: subpath ?? undefined,
        };

        const noteContent = await this.getNote(reference, isMock);

        resultLinksReplaced += noteContent + "\n";
      }

      // Replace the original text with the result
      content =
        content.substring(0, match.index) +
        resultLinksReplaced +
        content.substring(match.index + match.fullMatch.length);
    }

    // Handle normal dataview queries
    let nonEmbedMatch;
    const nonEmbedMatches = [];

    while ((nonEmbedMatch = nonEmbedRegex.exec(content)) !== null) {
      nonEmbedMatches.push({
        fullMatch: nonEmbedMatch[0],
        query: nonEmbedMatch[1],
        index: nonEmbedMatch.index,
      });
    }

    // Reverse the matches array to process from last to first
    nonEmbedMatches.reverse();

    // Process each match asynchronously
    for (const match of nonEmbedMatches) {
      // @ts-ignore - This is a private API
      const results = await this.cannoli.app.plugins.plugins[
        "smart-connections"
      ].api.search(match.query);

      // Build a markdown table of with the columns "Similarity" (results[0].sim) and "Link" (results[i].path)
      let result = "| Similarity | Link |\n| --- | --- |\n";

      // @ts-ignore - This is a private API
      results.forEach((r) => {
        if (typeof r === "object" && r.sim && r.path) {
          result += `| ${r.sim.toFixed(2)} | [[${r.path}]] |\n`;
        }
      });

      // const result = queryResult.successful ? queryResult.value : "Invalid Dataview query";

      // Replace the original text with the result
      content =
        content.substring(0, match.index) +
        result +
        content.substring(match.index + match.fullMatch.length);
    }

    return content;
  }

  async querySmartConnections(query: string, limit: number): Promise<string[]> {
    const results =
      // @ts-expect-error - This is a private API
      await this.cannoli.app.plugins.plugins["smart-connections"].api.search(
        query,
      );

    return results.slice(0, limit).map((r: { path: string }) => {
      let path = r.path;

      // Remove the trailing "#" if it exists
      if (path.endsWith("#")) {
        path = path.slice(0, -1);
      }

      // Extract the filename from the path
      const filename = path.substring(path.lastIndexOf("/") + 1);

      return `[[${filename}]]`;
    });
  }

  async extractNoteContents(
    noteLinks: string[],
    includeName: boolean,
    includeProperties: boolean,
    includeLink: boolean,
    isMock: boolean,
    allowSubpaths: boolean = true,
  ): Promise<string[]> {
    const resultContents = [];
    for (const noteLink of noteLinks) {
      const path = this.getPathFromName(noteLink);

      const [noteName, subpath] = path.split("#");

      const reference: Reference = {
        name: noteName,
        type: ReferenceType.Note,
        shouldExtract: true,
        includeName,
        includeProperties,
        includeLink,
        subpath: allowSubpaths ? (subpath ?? undefined) : undefined,
      };

      const noteContent = await this.getNote(reference, isMock);

      if (noteContent) {
        resultContents.push(noteContent);
      }
    }
    return resultContents;
  }

  // Attempting to replace dataviewjs queries
  // const dataviewsjs = newContent.match(
  // 	/```dataviewjs\n([\s\S]*?)\n```/g
  // );
  // if (dvApi && dataviewsjs && dataviewsjs.length) {
  // 	for (const dataview of dataviewsjs) {
  // 		const sanitizedQuery = dataview.replace("```dataviewjs", "").replace("```", "").trim()

  // 		console.log(sanitizedQuery)

  // 		// Make an empty HTML element to render the dataview output
  // 		const dvOutput = createEl("div");

  // 		// Make an empty/fake component to render the dataview output
  // 		const dvComponent = new Component();

  // 		dvComponent.onload = () => {
  // 			// Do nothing
  // 		}

  // 		const dvContent = await dvApi.executeJs(sanitizedQuery, dvOutput, dvComponent, "")

  // 		newContent = newContent.replace(dataview, dvOutput.innerHTML)

  // 		console.log(dvOutput.innerHTML)
  // 	}
  // }

  editSelection(newContent: string, isMock: boolean) {
    if (isMock) {
      return;
    }

    if (!this.cannoli.app.workspace.activeEditor) {
      return;
    }

    this.cannoli.app.workspace.activeEditor?.editor?.replaceSelection(
      newContent,
    );
  }

  async getPropertyOfNote(
    noteName: string,
    propertyName: string,
    yamlFormat = false,
  ): Promise<string | null> {
    const path = this.getPathFromName(noteName);

    const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file) {
      return null;
    }

    try {
      // Read the file to get the frontmatter
      let frontmatter: Record<string, unknown> = {};
      await this.cannoli.app.fileManager.processFrontMatter(file, (content) => {
        frontmatter = content;
        return content;
      });

      // If frontmatter is null or undefined, return null
      if (!frontmatter) {
        return null;
      }

      const property = frontmatter[propertyName];

      if (typeof property !== "string") {
        if (yamlFormat) {
          return yaml.dump(property);
        } else {
          return JSON.stringify(frontmatter[propertyName], null, 2);
        }
      } else {
        return property;
      }
    } catch (error) {
      console.error("An error occurred while fetching frontmatter:", error);
      return null;
    }
  }

  async getAllPropertiesOfNote(
    noteName: string,
    yamlFormat = false,
  ): Promise<string | null> {
    const path = this.getPathFromName(noteName);

    const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file) {
      return null;
    }

    try {
      // Read the file to get the frontmatter
      let frontmatter: Record<string, unknown> = {};
      await this.cannoli.app.fileManager.processFrontMatter(file, (content) => {
        frontmatter = content;
        return content;
      });

      // If frontmatter is null or undefined, return null
      if (!frontmatter) {
        return null;
      }

      if (!yamlFormat) {
        return JSON.stringify(frontmatter, null, 2);
      } else {
        return yaml.dump(frontmatter);
      }
    } catch (error) {
      console.error("An error occurred while fetching frontmatter:", error);
      return null;
    }
  }

  async editPropertyOfNote(
    noteName: string,
    propertyName: string,
    newValue: string,
  ): Promise<void> {
    const path = this.getPathFromName(noteName);

    const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file) {
      return;
    }

    let parsedNewValue: string[] | string | number | boolean | null = newValue;

    // If the new value is a yaml list (starts with "- "), parse it into an array and remove any empty items
    if (newValue.startsWith("- ")) {
      parsedNewValue = newValue
        .split("\n")
        .map((item) => item.replace("- ", "").trim())
        .filter((item) => item !== "");
    }

    try {
      await this.cannoli.app.fileManager.processFrontMatter(file, (content) => {
        // Parse the frontmatter
        let frontmatter: Record<string, unknown> = {};

        if (content) {
          frontmatter = content;
        }

        // Set the property
        frontmatter[propertyName] = parsedNewValue;

        // Write the frontmatter
        return frontmatter;
      });
      return;
    } catch (error) {
      console.error("An error occurred while editing frontmatter:", error);
      return;
    }
  }

  async createNoteAtExistingPath(
    noteName: string,
    path?: string,
    content?: string,
    verbose = false,
  ): Promise<string | null> {
    // If there are double brackets, remove them
    noteName = this.getPathFromName(noteName);

    // Attempt to create the note, adding or incrementing a number at the end of the note name if it already exists
    let i = 1;

    while (this.cannoli.app.metadataCache.getFirstLinkpathDest(noteName, "")) {
      // If the note name ends with " n", remove the " n" and increment n
      if (noteName.match(/ \d+$/)) {
        noteName = noteName.replace(/ \d+$/, ` ${i.toString()}`);
      } else {
        noteName = `${noteName} ${i.toString()}`;
      }
      i++;
    }

    // Create the path by appending the note name to the path with .md
    const fullPath = `${path ?? ""}/${noteName}.md`;

    // Create the note
    await this.cannoli.app.vault.create(fullPath, content ?? "");

    return `[[${fullPath}|${noteName}]]`;
  }

  async createNoteAtNewPath(
    noteName: string,
    path: string,
    content?: string,
    verbose = false,
  ): Promise<string> {
    // Create the path by appending the note name to the path with .md
    const fullPath = `${path}/${noteName}.md`;

    // Create the note
    await this.cannoli.app.vault.create(fullPath, content ?? "");

    return `[[${fullPath}|${noteName}]]`;
  }

  async getNotePath(noteName: string): Promise<string | null> {
    const path = this.getPathFromName(noteName);

    const file = this.cannoli.app.metadataCache.getFirstLinkpathDest(path, "");

    if (!file) {
      return null;
    }

    return file.path;
  }

  async createFolder(path: string, verbose = false): Promise<boolean> {
    // Check if the path already exists
    const folder = this.cannoli.app.vault.getAbstractFileByPath(path);

    if (folder) {
      return false;
    }

    // Create the folder
    this.cannoli.app.vault.createFolder(path);

    return true;
  }

  async moveNote(
    noteName: string,
    newPath: string,
    verbose = false,
  ): Promise<boolean> {
    // Create the path by appending the note name to the paths with .md
    const newFullPath = `${newPath}/${noteName}.md`;

    const path = this.getPathFromName(noteName);
    const note = this.cannoli.app.metadataCache.getFirstLinkpathDest(path, "");

    if (!note) {
      return false;
    }

    // Move the note
    await this.cannoli.app.vault.rename(note, newFullPath);

    return true;
  }

  openCustomModal(layout: string): Promise<string | Error> {
    return new Promise((resolve) => {
      try {
        const lines = layout.split("\n");
        let title = "Cannoli modal";
        let fixedLayout = layout;

        if (lines.length > 0 && !lines[0].includes("==")) {
          title = lines[0].trim().replace(/^#+\s*/, "");
          fixedLayout = lines.slice(1).join("\n");
        }

        new CustomModal(
          this.cannoli.app,
          fixedLayout,
          (result) => {
            if (result instanceof Error) {
              resolve(result);
            } else {
              resolve(JSON.stringify(result, null, 2));
            }
          },
          title,
        ).open();
      } catch (error) {
        resolve(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
