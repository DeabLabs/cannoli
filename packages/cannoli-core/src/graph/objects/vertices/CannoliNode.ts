import { pathOr, stringToPath } from "remeda";
import { CannoliObject } from "src/graph/CannoliObject";
import {
  Reference,
  VerifiedCannoliCanvasFileData,
  VerifiedCannoliCanvasLinkData,
  VerifiedCannoliCanvasTextData,
  VerifiedCannoliCanvasData,
  ReferenceType,
  GroupType,
  CannoliObjectStatus,
  ContentNodeType,
  EdgeModifier,
  EdgeType,
} from "src/graph";
import {
  GenericCompletionParams,
  GenericCompletionResponse,
} from "src/providers";
import { ZodSchema, z } from "zod";
import { CannoliEdge } from "../CannoliEdge";
import { CannoliVertex } from "../CannoliVertex";
import { ChatResponseEdge } from "../edges/ChatResponseEdge";
import { CannoliGroup } from "./CannoliGroup";
import { FloatingNode } from "../FloatingNode";

export type VariableValue = {
  name: string;
  content: string;
  edgeId: string | null;
};

export type VersionedContent = {
  content: string;
  versionArray: {
    header: string | null;
    subHeader: string | null;
  }[];
};

export type TreeNode = {
  header: string | null;
  subHeader: string | null;
  content?: string;
  children?: TreeNode[];
};

export class CannoliNode extends CannoliVertex {
  references: Reference[] = [];
  renderFunction: (
    variables: { name: string; content: string }[],
  ) => Promise<string>;

  constructor(
    nodeData:
      | VerifiedCannoliCanvasFileData
      | VerifiedCannoliCanvasLinkData
      | VerifiedCannoliCanvasTextData,
    fullCanvasData: VerifiedCannoliCanvasData,
  ) {
    super(nodeData, fullCanvasData);
    this.references = nodeData.cannoliData.references || [];
    this.renderFunction = this.buildRenderFunction();
  }

  buildRenderFunction() {
    // Replace references with placeholders using an index-based system
    let textCopy = this.text.slice();

    let index = 0;
    // Updated regex pattern to avoid matching newlines inside the double braces
    textCopy = textCopy.replace(/\{\{[^{}\n]+\}\}/g, () => `{{${index++}}}`);

    // Define and return the render function
    const renderFunction = async (
      variables: { name: string; content: string }[],
    ) => {
      // Process embedded notes
      let processedText = await this.processEmbeds(textCopy);

      // Create a map to look up variable content by name
      const varMap = new Map(variables.map((v) => [v.name, v.content]));
      // Replace the indexed placeholders with the content from the variables
      processedText = processedText.replace(
        /\{\{(\d+)\}\}/g,
        (match, index) => {
          // Retrieve the reference by index
          const reference = this.references[Number(index)];
          // Retrieve the content from the varMap using the reference's name
          return varMap.get(reference.name) ?? "{{invalid}}";
        },
      );

      // Run replacer functions
      for (const replacer of this.run.replacers) {
        processedText = await replacer(processedText, this.run.isMock, this);
      }

      return processedText;
    };

    return renderFunction;
  }

  async processEmbeds(content: string): Promise<string> {
    // Check for embedded notes (e.g. ![[Note Name]]), and replace them with the note content
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

        // If there's no fileSystemInterface, throw an error
        if (!this.run.fileManager) {
          throw new Error("No fileManager found");
        }

        const noteContent = await this.run.fileManager.getNote(
          {
            name: noteName,
            type: ReferenceType.Note,
            shouldExtract: true,
            includeName: true,
            subpath: subpath,
          },
          this.run.isMock,
        );

        if (noteContent) {
          const blockquotedNoteContent =
            "> " + noteContent.replace(/\n/g, "\n> ");
          content = content.replace(embeddedNote, blockquotedNoteContent);
        }
      }
    }

    return content;
  }

  async getContentFromNote(reference: Reference): Promise<string | null> {
    // If there's no fileSystemInterface, throw an error
    if (!this.run.fileManager) {
      throw new Error("No fileManager found");
    }

    const note = await this.run.fileManager.getNote(reference, this.run.isMock);

    if (note === null) {
      return null;
    }

    return note;
  }

  async getContentFromCanvas(reference: Reference): Promise<unknown | null> {
    if (!this.run.fileManager) {
      throw new Error("No fileManager found");
    }

    const canvas = await this.run.fileManager.getCanvas(
      reference.name,
      this.run.isMock,
    );

    if (canvas === null) {
      return null;
    }

    const canvasObject = JSON.parse(canvas);

    return canvasObject;
  }

  getContentFromFloatingNode(name: string): string | null {
    for (const object of Object.values(this.graph)) {
      if (object instanceof FloatingNode && object.getName() === name) {
        return object.getContent();
      }
    }
    return null;
  }

  async processReferences(
    additionalVariableValues?: VariableValue[],
    cleanForJson?: boolean,
  ) {
    const variableValues = this.getVariableValues(true);

    if (additionalVariableValues) {
      variableValues.push(...additionalVariableValues);
    }

    const resolvedReferences = await Promise.all(
      this.references.map(async (reference) => {
        let content = "{{invalid reference}}";
        const { name } = reference;

        if (
          (reference.type === ReferenceType.Variable ||
            reference.type === ReferenceType.Selection) &&
          !reference.shouldExtract
        ) {
          // First, try to get the content from variable values
          const variable = variableValues.find(
            (variable: { name: string }) => variable.name === reference.name,
          );

          if (variable) {
            content = variable.content;
          } else {
            // If variable content is null, fall back to floating node
            const floatingContent = this.getContentFromFloatingNode(
              reference.name,
            );
            if (floatingContent !== null) {
              content = floatingContent;
            }
            // If the reference name contains only "#" symbols, replace it with the loop index
            else if (reference.name.match(/^#+$/)) {
              // Depth is the number of hash symbols minus 1
              const depth = reference.name.length - 1;
              const loopIndex = this.getLoopIndex(depth);
              if (loopIndex !== null) {
                content = loopIndex.toString();
              } else {
                content = `{{${reference.name}}}`;
              }
            } else if (this.run.secrets && this.run.secrets[reference.name]) {
              // Check in this.run.secrets
              content = this.run.secrets[reference.name];
            } else {
              // this.warning(`Variable "${reference.name}" not found`);
              content = `{{${reference.name}}}`;
            }
          }
        } else if (
          (reference.type === ReferenceType.Variable ||
            reference.type === ReferenceType.Selection) &&
          reference.shouldExtract
        ) {
          // First, try to get the content from variable values
          const variable = variableValues.find(
            (variable) => variable.name === reference.name,
          );
          if (variable && variable.content) {
            content = variable.content;
          } else {
            // If variable content is null, fall back to floating node
            const floatingContent = this.getContentFromFloatingNode(
              reference.name,
            );
            if (floatingContent !== null) {
              content = floatingContent;
            }
          }

          if (content !== "{{invalid reference}}") {
            // Save original variable name
            const originalName = reference.name;

            // Set reference name to the content of the variable
            reference.name = content;

            // Get the content from the note
            const noteContent = await this.getContentFromNote(reference);

            // Restore original variable name
            reference.name = originalName;
            if (noteContent !== null) {
              content = noteContent;
            } else {
              this.warning(`Note "${content}" not found`);
              content = `{{@${reference.name}}}`;
            }
          } else {
            //this.warning(`Variable "${reference.name}" not found`);
            content = `{{@${reference.name}}}`;
          }
        } else if (reference.type === ReferenceType.Note) {
          if (reference.shouldExtract) {
            const noteContent = await this.getContentFromNote(reference);
            if (noteContent !== null) {
              content = noteContent;
            } else {
              this.warning(`Note "${reference.name}" not found`);
              content = `{{[[${reference.name}]]}}`;
            }
          } else {
            content = reference.name;
          }
        } else if (reference.type === ReferenceType.Floating) {
          if (reference.shouldExtract) {
            const floatingContent = this.getContentFromFloatingNode(
              reference.name,
            );
            if (floatingContent !== null) {
              content = floatingContent;
            } else {
              this.warning(`Floating node "${name}" not found`);
              content = `{{[${reference.name}]}}`;
            }
          }
        }

        if (cleanForJson) {
          content = content
            .replace(/\\/g, "\\\\")
            .replace(/\n/g, "\\n")
            .replace(/"/g, '\\"')
            .replace(/\t/g, "\\t");
        }

        return { name, content };
      }),
    );

    return this.renderFunction(resolvedReferences);
  }

  getLoopIndex(depth: number): number | null {
    const groups = this.groups.map(
      (group) => this.graph[group] as CannoliGroup,
    );

    // Filter to only repeat or forEach groups
    const repeatOrForEachGroups = groups.filter(
      (group) => group.type === GroupType.Repeat || group.fromForEach,
    );

    // Get the group at the specified depth (0 is the most immediate group)
    const group = repeatOrForEachGroups[depth];

    // If group is not there, return null
    if (!group) {
      return null;
    }

    // If group is not a CannoliGroup, return null
    if (!(group instanceof CannoliGroup)) {
      return null;
    }

    // Get the loop index from the group
    const loopIndex = group.currentLoop + 1;

    return loopIndex;
  }

  getVariableValues(includeGroupEdges: boolean): VariableValue[] {
    const variableValues: VariableValue[] = [];

    // Get all available provide edges
    let availableEdges = this.getAllAvailableProvideEdges();

    // If includeGroupEdges is not true, filter for only incoming edges of this node
    if (!includeGroupEdges) {
      availableEdges = availableEdges.filter((edge) =>
        this.incomingEdges.includes(edge.id),
      );
    }

    for (const edge of availableEdges) {
      const edgeObject = this.graph[edge.id];
      if (!(edgeObject instanceof CannoliEdge)) {
        throw new Error(
          `Error on object ${edgeObject.id}: object is not a provide edge.`,
        );
      }

      // If the edge isn't complete, check its status
      if (!(edgeObject.status === CannoliObjectStatus.Complete)) {
        // If the edge is reflexive and not rejected, set its content to an empty string and keep going
        if (
          edgeObject.isReflexive &&
          edgeObject.status !== CannoliObjectStatus.Rejected
        ) {
          edgeObject.setContent("");
        } else if (
          // If the edge is not rejected, not reflexive, or its content is null, skip it
          !(edgeObject.status === CannoliObjectStatus.Rejected) ||
          !edgeObject.isReflexive ||
          edgeObject.content === null
        ) {
          continue;
        }
      }

      let content: string;

      if (edgeObject.content === null) {
        continue;
      }

      if (typeof edgeObject.content === "string" && edgeObject.text) {
        // if the edge has a versions array
        if (edgeObject.versions && edgeObject.versions.length > 0) {
          const allVersions: VersionedContent[] = [
            {
              content: edgeObject.content,
              versionArray: edgeObject.versions.map((version) => ({
                header: version.header,
                subHeader: version.subHeader,
              })),
            },
          ];

          // Find all edges with the same name and add them to the allVersions array
          const edgesWithSameName = this.getAllAvailableProvideEdges().filter(
            (edge) => edge.text === edgeObject.text,
          );
          for (const otherVersion of edgesWithSameName) {
            if (
              otherVersion.id !== edgeObject.id &&
              otherVersion.versions?.length === edgeObject.versions?.length &&
              otherVersion.content !== null
            ) {
              allVersions.push({
                content: otherVersion.content as string,
                versionArray: otherVersion.versions,
              });
            }
          }

          const modifier = edgeObject.edgeModifier;

          let fromFormatterNode = false;

          if (
            this.graph[edgeObject.source].type === ContentNodeType.Formatter
          ) {
            fromFormatterNode = true;
          }

          content = this.renderMergedContent(
            allVersions,
            modifier,
            fromFormatterNode,
            edgeObject.text,
          );
        } else {
          content = edgeObject.content;
        }

        const variableValue = {
          name: edgeObject.text,
          content: content,
          edgeId: edgeObject.id,
        };

        variableValues.push(variableValue);
      } else if (
        typeof edgeObject.content === "object" &&
        !Array.isArray(edgeObject.content)
      ) {
        const multipleVariableValues = [];

        for (const name in edgeObject.content) {
          const variableValue = {
            name: name,
            content: edgeObject.content[name],
            edgeId: edgeObject.id,
          };

          multipleVariableValues.push(variableValue);
        }

        variableValues.push(...multipleVariableValues);
      } else {
        continue;
      }
    }

    // Add the default "NOTE" variable
    if (this.run.currentNote && includeGroupEdges) {
      const currentNoteVariableValue = {
        name: "NOTE",
        content: this.run.currentNote,
        edgeId: "",
      };

      variableValues.push(currentNoteVariableValue);
    }

    // Add the default "SELECTION" variable
    if (this.run.selection && includeGroupEdges) {
      const currentSelectionVariableValue = {
        name: "SELECTION",
        content: this.run.selection,
        edgeId: "",
      };

      variableValues.push(currentSelectionVariableValue);
    }

    // Resolve variable conflicts
    const resolvedVariableValues =
      this.resolveVariableConflicts(variableValues);

    return resolvedVariableValues;
  }

  renderMergedContent(
    allVersions: VersionedContent[],
    modifier: EdgeModifier | null,
    fromFormatterNode: boolean,
    edgeName: string,
  ): string {
    const tree = this.transformToTree(allVersions);
    if (modifier === EdgeModifier.Table) {
      return this.renderAsMarkdownTable(tree, edgeName);
    } else if (modifier === EdgeModifier.List) {
      return this.renderAsMarkdownList(tree);
    } else if (modifier === EdgeModifier.Headers) {
      return this.renderAsMarkdownHeaders(tree);
    } else {
      return this.renderAsParagraphs(tree, fromFormatterNode);
    }
  }

  transformToTree(allVersions: VersionedContent[]): TreeNode {
    const root: TreeNode = { header: null, subHeader: null, children: [] };

    allVersions.forEach((item) => {
      let currentNode = root;

      for (let i = item.versionArray.length - 1; i >= 0; i--) {
        const version = item.versionArray[i];
        if (!currentNode.children) {
          currentNode.children = [];
        }

        let nextNode = currentNode.children.find(
          (child) => child.subHeader === version.subHeader,
        );

        if (!nextNode) {
          nextNode = {
            header: version.header,
            subHeader: version.subHeader,
            children: [],
          };
          currentNode.children.push(nextNode);
        }

        currentNode = nextNode;

        if (i === 0) {
          currentNode.content = item.content;
        }
      }
    });

    return root;
  }

  renderAsParagraphs(tree: TreeNode, fromFormatterNode: boolean): string {
    let result = "";

    if (tree.content) {
      if (fromFormatterNode) {
        result += `${tree.content}`;
      } else {
        result += `${tree.content}\n\n`;
      }
    }

    if (tree.children) {
      tree.children.forEach((child) => {
        result += this.renderAsParagraphs(child, fromFormatterNode);
      });
    }

    return result;
  }

  renderAsMarkdownHeaders(tree: TreeNode, level: number = 0): string {
    let result = "";

    if (level !== 0) {
      result += `${"#".repeat(level)} ${tree.subHeader}\n\n`;
    }

    if (tree.content) {
      result += `${tree.content}\n\n`;
    }

    if (tree.children) {
      tree.children.forEach((child) => {
        result += this.renderAsMarkdownHeaders(child, level + 1);
      });
    }

    return result;
  }

  renderAsMarkdownList(tree: TreeNode, indent: string = ""): string {
    let result = "";

    if (tree.subHeader) {
      result += `${indent}- ${tree.subHeader}\n`;
    }

    if (tree.content) {
      const indentedContent = tree.content
        .split("\n")
        .map((line) => `${indent}    ${line}`)
        .join("\n");
      result += `${indentedContent}\n`;
    }

    if (tree.children) {
      tree.children.forEach((child) => {
        result += this.renderAsMarkdownList(child, indent + "  ");
      });
    }

    return result;
  }

  renderAsMarkdownTable(tree: TreeNode, edgeName: string): string {
    let table = "";

    if (!tree.children) {
      return table;
    }

    // Helper function to replace newlines with <br>
    const replaceNewlines = (text: string | null | undefined): string => {
      return (text ?? "").replace(/\n/g, "<br>");
    };

    // Check if there's only one level
    const isSingleLevel = !tree.children.some(
      (child) => child.children && child.children.length > 0,
    );

    if (isSingleLevel) {
      table = `| ${replaceNewlines(tree.children[0].header)} | ${edgeName} |\n| --- | --- |\n`;

      // Create the table rows
      tree.children.forEach((child) => {
        table +=
          "| " +
          replaceNewlines(child.subHeader) +
          " | " +
          replaceNewlines(child.content) +
          " |\n";
      });
    } else {
      // Extract the headers from the first child
      const headers =
        tree.children[0].children?.map((child) =>
          replaceNewlines(child.subHeader),
        ) ?? [];

      // Create the table header with an empty cell for the main header
      table += "| |" + headers.join(" | ") + " |\n";
      table += "| --- |" + headers.map(() => " --- ").join(" | ") + " |\n";

      // Create the table rows
      tree.children.forEach((child) => {
        table += "| " + replaceNewlines(child.subHeader) + " |";
        child.children?.forEach((subChild) => {
          const content = replaceNewlines(subChild.content);
          table += ` ${content} |`;
        });
        table += "\n";
      });
    }

    return table;
  }

  resolveVariableConflicts(variableValues: VariableValue[]): VariableValue[] {
    const finalVariables: VariableValue[] = [];
    const groupedByName: Record<string, VariableValue[]> = {};

    // Group the variable values by name
    for (const variable of variableValues) {
      if (!groupedByName[variable.name]) {
        groupedByName[variable.name] = [];
      }
      groupedByName[variable.name].push(variable);
    }

    // Iterate through the grouped names
    for (const name in groupedByName) {
      // Get all the variable values for this name
      const variables = groupedByName[name];

      let selectedVariable = variables[0]; // Start with the first variable
      let foundNonEmptyReflexive = false;

      // Iterate through the variables, preferring the reflexive edge if found
      for (const variable of variables) {
        if (!variable.edgeId) {
          // If the variable has no edgeId, it's a special variable given by the node, it always has priority
          selectedVariable = variable;
          break;
        }

        const edgeObject = this.graph[variable.edgeId];

        // Check if edgeObject is an instance of CannoliEdge and if it's reflexive
        if (edgeObject instanceof CannoliEdge && edgeObject.isReflexive) {
          if (edgeObject.content !== "") {
            selectedVariable = variable;
            foundNonEmptyReflexive = true;
            break; // Exit the loop once a reflexive edge with non-empty content is found
          } else if (!foundNonEmptyReflexive) {
            // If no non-empty reflexive edge has been found yet, prefer the first reflexive edge
            selectedVariable = variable;
          }
        }
      }

      // If no non-empty reflexive edge was found, prefer the first non-reflexive edge
      if (!foundNonEmptyReflexive && selectedVariable.content === "") {
        for (const variable of variables) {
          if (!variable.edgeId) {
            this.error(`Variable ${name} has no edgeId`);
            continue;
          }

          const edgeObject = this.graph[variable.edgeId];
          if (!(edgeObject instanceof CannoliEdge) || !edgeObject.isReflexive) {
            selectedVariable = variable;
            break;
          }
        }
      }

      // Add the selected variable to the final array
      finalVariables.push(selectedVariable);
    }

    return finalVariables;
  }

  private parseContent(content: string, path: never): string {
    let contentObject;

    // Try to parse the content as JSON
    try {
      contentObject = JSON.parse(content as string);
    } catch (e) {
      // If parsing fails, return the original content
      return content;
    }

    // If we parsed the content as JSON and it's not an array, use the parsed object
    if (contentObject && !Array.isArray(contentObject)) {
      // Get the value from the parsed text
      const value = pathOr(contentObject, path, content);

      // If the value is a string, return it
      if (typeof value === "string") {
        return value;
      } else {
        // Otherwise, return the stringified value
        return JSON.stringify(value, null, 2);
      }
    }

    // If we didn't parse the content as JSON, return the original content
    return content;
  }

  loadOutgoingEdges(content: string, request?: GenericCompletionParams) {
    let itemIndex = 0;
    let listItems: string[] = [];

    if (
      this.outgoingEdges.some((edge) => this.graph[edge].type === EdgeType.Item)
    ) {
      if (this.type === ContentNodeType.Http) {
        // Parse the text of the edge with remeda
        const path = stringToPath(
          this.graph[
            this.outgoingEdges.find(
              (edge) => this.graph[edge].type === EdgeType.Item,
            )!
          ].text,
        );
        listItems = this.getListArrayFromContent(
          this.parseContent(content, path),
        );
      } else {
        listItems = this.getListArrayFromContent(content);
      }
    }

    for (const edge of this.outgoingEdges) {
      const edgeObject = this.graph[edge];
      let contentToLoad = content;

      // If it's coming from an httpnode
      if (this.type === ContentNodeType.Http) {
        // Parse the text of the edge with remeda
        const path = stringToPath(edgeObject.text);
        contentToLoad = this.parseContent(content, path);
      }

      if (
        edgeObject instanceof CannoliEdge &&
        !(edgeObject instanceof ChatResponseEdge) &&
        edgeObject.type !== EdgeType.Item
      ) {
        edgeObject.load({
          content: contentToLoad,
          request: request,
        });
      } else if (
        edgeObject instanceof CannoliEdge &&
        edgeObject.type === EdgeType.Item
      ) {
        const item = listItems[itemIndex];

        // If we exceed the list items, reject the edge
        if (!item) {
          edgeObject.reject();
          continue;
        }

        edgeObject.load({
          content: item,
          request: request,
        });
        itemIndex++;
      }
    }
  }

  getListArrayFromContent(content: string): string[] {
    // Attempt to parse the content as JSON
    try {
      const jsonArray = JSON.parse(content);
      if (Array.isArray(jsonArray)) {
        return jsonArray.map((item) =>
          typeof item === "string" ? item : JSON.stringify(item),
        );
      }
    } catch (e) {
      // If parsing fails, continue with markdown list parsing
    }

    // First pass: look for markdown list items, and return the item at the index
    const lines = content.split("\n");

    // Filter out the lines that don't start with "- " or a number followed by ". "
    const listItems = lines.filter(
      (line) => line.startsWith("- ") || /^\d+\. /.test(line),
    );

    // Return the list items without the "- " or the number and ". "
    return listItems.map((item) =>
      item.startsWith("- ") ? item.substring(2) : item.replace(/^\d+\. /, ""),
    );
  }

  dependencyCompleted(dependency: CannoliObject): void {
    if (
      this.allDependenciesComplete() &&
      this.status === CannoliObjectStatus.Pending
    ) {
      this.execute();
    }
  }

  getNoteOrFloatingReference(): Reference | null {
    const notePattern = /^{{\[\[([^\]]+)\]\]([\W]*)}}$/;
    const floatingPattern = /^{{\[([^\]]+)\]}}$/;
    const currentNotePattern = /^{{NOTE([\W]*)}}$/;

    const strippedText = this.text.trim();

    let match = notePattern.exec(strippedText);
    if (match) {
      const reference: Reference = {
        name: match[1],
        type: ReferenceType.Note,
        shouldExtract: false,
      };

      const modifiers = match[2];
      if (modifiers) {
        if (modifiers.includes("!#")) {
          reference.includeName = false;
        } else if (modifiers.includes("#")) {
          reference.includeName = true;
        }

        if (modifiers.includes("!$")) {
          reference.includeProperties = false;
        } else if (modifiers.includes("$")) {
          reference.includeProperties = true;
        }

        if (modifiers.includes("!@")) {
          reference.includeLink = false;
        } else if (modifiers.includes("@")) {
          reference.includeLink = true;
        }
      }
      return reference;
    }

    match = floatingPattern.exec(strippedText);
    if (match) {
      const reference = {
        name: match[1],
        type: ReferenceType.Floating,
        shouldExtract: false,
      };
      return reference;
    }

    match = currentNotePattern.exec(strippedText);
    if (match && this.run.currentNote) {
      const reference: Reference = {
        name: this.run.currentNote,
        type: ReferenceType.Note,
        shouldExtract: false,
      };

      const modifiers = match[1];
      if (modifiers) {
        if (modifiers.includes("!#")) {
          reference.includeName = false;
        } else if (modifiers.includes("#")) {
          reference.includeName = true;
        }

        if (modifiers.includes("!$")) {
          reference.includeProperties = false;
        } else if (modifiers.includes("$")) {
          reference.includeProperties = true;
        }

        if (modifiers.includes("!@")) {
          reference.includeLink = false;
        } else if (modifiers.includes("@")) {
          reference.includeLink = true;
        }
      }
      return reference;
    }

    return null;
  }

  logDetails(): string {
    let groupsString = "";
    groupsString += `Groups: `;
    for (const group of this.groups) {
      groupsString += `\n\t-"${this.ensureStringLength(
        this.graph[group].text,
        15,
      )}"`;
    }

    let incomingEdgesString = "";
    incomingEdgesString += `Incoming Edges: `;
    for (const edge of this.incomingEdges) {
      incomingEdgesString += `\n\t-"${this.ensureStringLength(
        this.graph[edge].text,
        15,
      )}"`;
    }

    let outgoingEdgesString = "";
    outgoingEdgesString += `Outgoing Edges: `;
    for (const edge of this.outgoingEdges) {
      outgoingEdgesString += `\n\t-"${this.ensureStringLength(
        this.graph[edge].text,
        15,
      )}"`;
    }

    return (
      `[] Node ${this.id} Text: "${this.text}"\n${incomingEdgesString}\n${outgoingEdgesString}\n${groupsString}\n` +
      super.logDetails()
    );
  }

  validate(): void {
    super.validate();

    // Nodes can't have any incoming list edges
    if (
      this.incomingEdges.filter(
        (edge) => this.graph[edge].type === EdgeType.List,
      ).length > 0
    ) {
      this.error(`Nodes can't have any incoming list edges.`);
    }
  }

  getSpecialOutgoingEdges(): CannoliEdge[] {
    // Get all special outgoing edges
    const specialOutgoingEdges = this.getOutgoingEdges().filter((edge) => {
      return (
        edge.type === EdgeType.Field ||
        edge.type === EdgeType.Choice ||
        edge.type === EdgeType.List ||
        edge.type === EdgeType.Variable
      );
    });

    return specialOutgoingEdges;
  }

  specialOutgoingEdgesAreHomogeneous(): boolean {
    const specialOutgoingEdges = this.getSpecialOutgoingEdges();

    if (specialOutgoingEdges.length === 0) {
      return true;
    }

    const firstEdgeType = specialOutgoingEdges[0].type;

    for (const edge of specialOutgoingEdges) {
      if (edge.type !== firstEdgeType) {
        return false;
      }
    }

    return true;
  }

  getAllAvailableProvideEdges(): CannoliEdge[] {
    const availableEdges: CannoliEdge[] = [];

    // Get the incoming edges of all groups
    for (const group of this.groups) {
      const groupObject = this.graph[group];
      if (!(groupObject instanceof CannoliVertex)) {
        throw new Error(`Error on node ${this.id}: group is not a vertex.`);
      }

      const groupIncomingEdges = groupObject.getIncomingEdges();

      availableEdges.push(...groupIncomingEdges);
    }

    // Get the incoming edges of this node
    const nodeIncomingEdges = this.getIncomingEdges();

    availableEdges.push(...nodeIncomingEdges);

    // Filter out all logging, and write edges
    const filteredEdges = availableEdges.filter(
      (edge) =>
        edge.type !== EdgeType.Logging &&
        edge.type !== EdgeType.Write &&
        edge.type !== EdgeType.Config,
    );

    return filteredEdges as CannoliEdge[];
  }

  private updateConfigWithValue(
    runConfig: Record<string, unknown>,
    content: string | Record<string, string> | null,
    schema: ZodSchema,
    setting?: string | null,
  ): void {
    // Ensure the schema is a ZodObject to access its shape
    if (!(schema instanceof z.ZodObject)) {
      this.error("Provided schema is not a ZodObject.");
      return;
    }

    if (typeof content === "string") {
      if (setting) {
        runConfig[setting] = content;
      }
    } else if (typeof content === "object") {
      for (const key in content) {
        runConfig[key] = content[key];
      }
    }

    try {
      // Validate and transform the final runConfig against the schema
      const parsedConfig = schema.parse(runConfig);
      Object.assign(runConfig, parsedConfig); // Update runConfig with the transformed values
    } catch (error) {
      if (error instanceof z.ZodError) {
        this.error(`Error setting config: ${error.errors[0].message}`);
      } else {
        this.error(`Error setting config: ${error}`);
      }
    }
  }

  private processSingleEdge(
    runConfig: Record<string, unknown>,
    edgeObject: CannoliEdge,
    schema: ZodSchema,
  ): void {
    if (
      typeof edgeObject.content === "string" ||
      typeof edgeObject.content === "object"
    ) {
      this.updateConfigWithValue(
        runConfig,
        edgeObject.content,
        schema,
        edgeObject.text,
      );
    } else {
      this.error(`Config edge has invalid content.`);
    }
  }

  private processEdges(
    runConfig: Record<string, unknown>,
    edges: CannoliEdge[],
    schema: ZodSchema,
  ): void {
    for (const edgeObject of edges) {
      if (!(edgeObject instanceof CannoliEdge)) {
        throw new Error(
          `Error processing config edges: object is not an edge.`,
        );
      }
      this.processSingleEdge(runConfig, edgeObject, schema);
    }
  }

  private processGroups(
    runConfig: Record<string, unknown>,
    schema: ZodSchema,
  ): void {
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const group = this.graph[this.groups[i]];
      if (group instanceof CannoliGroup) {
        const configEdges = group
          .getIncomingEdges()
          .filter((edge) => edge.type === EdgeType.Config);
        this.processEdges(runConfig, configEdges, schema);
      }
    }
  }

  private processNodes(
    runConfig: Record<string, unknown>,
    schema: ZodSchema,
  ): void {
    const configEdges = this.getIncomingEdges().filter(
      (edge) => edge.type === EdgeType.Config,
    );
    this.processEdges(runConfig, configEdges, schema);
  }

  getConfig(schema: ZodSchema): Record<string, unknown> {
    const runConfig = {
      enableVision: this.run.config?.enableVision ?? true,
    };

    this.processGroups(runConfig, schema);
    this.processNodes(runConfig, schema);

    return runConfig;
  }

  getPrependedMessages(): GenericCompletionResponse[] {
    const messages: GenericCompletionResponse[] = [];
    const systemMessages: GenericCompletionResponse[] = [];

    // Get all available provide edges
    const availableEdges = this.getAllAvailableProvideEdges();

    // filter for only incoming edges of this node
    const directEdges = availableEdges.filter((edge) =>
      this.incomingEdges.includes(edge.id),
    );

    // Filter for indirect edges (not incoming edges of this node)
    const indirectEdges = availableEdges.filter(
      (edge) => !this.incomingEdges.includes(edge.id),
    );

    for (const edge of directEdges) {
      const edgeObject = this.graph[edge.id];
      if (!(edgeObject instanceof CannoliEdge)) {
        throw new Error(
          `Error on object ${edgeObject.id}: object is not a provide edge.`,
        );
      }

      const edgeMessages = edgeObject.messages;

      if (!edgeMessages || edgeMessages.length < 1) {
        continue;
      }

      // If the edge is crossing a group, check if there are any indirect edges pointing to that group
      for (const group of edgeObject.crossingInGroups) {
        const indirectEdgesToGroup = indirectEdges.filter(
          (edge) => edge.target === group,
        );

        // Filter for those indirect edges that have addMessages = true and are of the same type
        const indirectEdgesToAdd = indirectEdgesToGroup.filter(
          (edge) =>
            this.graph[edge.id] instanceof CannoliEdge &&
            (this.graph[edge.id] as CannoliEdge).addMessages &&
            (this.graph[edge.id] as CannoliEdge).type === edgeObject.type,
        );

        // For each indirect edge, add its messages without overwriting
        for (const indirectEdge of indirectEdgesToAdd) {
          const indirectEdgeObject = this.graph[indirectEdge.id];
          if (!(indirectEdgeObject instanceof CannoliEdge)) {
            throw new Error(
              `Error on object ${indirectEdgeObject.id}: object is not a provide edge.`,
            );
          }

          const indirectEdgeMessages = indirectEdgeObject.messages;

          if (!indirectEdgeMessages || indirectEdgeMessages.length < 1) {
            continue;
          }

          edgeMessages.push(...indirectEdgeMessages);
        }
      }

      // Separate system messages from other messages
      if (edge.type === EdgeType.SystemMessage) {
        for (const msg of edgeMessages) {
          if (
            !systemMessages.some((m) => m.content === msg.content) &&
            !messages.some((m) => m.content === msg.content)
          ) {
            systemMessages.push(msg);
          }
        }
      } else {
        messages.push(...edgeMessages);
      }
    }

    // If messages is empty and there are no incoming edges with addMessages = true, try it with indirect edges
    if (messages.length === 0) {
      for (const edge of indirectEdges) {
        const edgeObject = this.graph[edge.id];
        if (!(edgeObject instanceof CannoliEdge)) {
          throw new Error(
            `Error on object ${edgeObject.id}: object is not a provide edge.`,
          );
        }

        const edgeMessages = edgeObject.messages;

        if (!edgeMessages || edgeMessages.length < 1) {
          continue;
        }

        // Separate system messages from other messages
        if (edge.type === EdgeType.SystemMessage) {
          for (const msg of edgeMessages) {
            if (
              !systemMessages.some((m) => m.content === msg.content) &&
              !messages.some((m) => m.content === msg.content)
            ) {
              systemMessages.push(msg);
            }
          }
        } else {
          messages.push(...edgeMessages);
        }
      }
    }

    // Combine system messages and other messages
    const combinedMessages = [...systemMessages, ...messages];

    // Remove duplicate system messages from the combined message stack
    const uniqueMessages = combinedMessages.filter(
      (msg, index, self) =>
        msg.role !== "system" ||
        self.findIndex((m) => m.content === msg.content) === index,
    );

    return uniqueMessages;
  }
}
