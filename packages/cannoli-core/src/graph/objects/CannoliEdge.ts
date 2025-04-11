import {
  GenericCompletionResponse,
  GenericCompletionParams,
} from "src/providers";
import { CannoliObject } from "../CannoliObject";
import {
  EdgeModifier,
  VerifiedCannoliCanvasEdgeData,
  VerifiedCannoliCanvasData,
  EdgeType,
  CannoliObjectStatus,
} from "../../graph";
import { CannoliVertex } from "./CannoliVertex";
import { CannoliGroup } from "./vertices/CannoliGroup";

export class CannoliEdge extends CannoliObject {
  source: string;
  target: string;
  crossingInGroups: string[];
  crossingOutGroups: string[];
  isReflexive: boolean;
  addMessages: boolean;
  edgeModifier: EdgeModifier | null;
  content: string | Record<string, string> | null;
  messages: GenericCompletionResponse[] | null;
  versions:
    | {
        header: string | null;
        subHeader: string | null;
      }[]
    | null;

  constructor(
    edgeData: VerifiedCannoliCanvasEdgeData,
    fullCanvasData: VerifiedCannoliCanvasData,
  ) {
    super(edgeData, fullCanvasData);
    this.source = edgeData.fromNode;
    this.target = edgeData.toNode;
    this.crossingInGroups = edgeData.cannoliData.crossingInGroups;
    this.crossingOutGroups = edgeData.cannoliData.crossingOutGroups;
    this.isReflexive = edgeData.cannoliData.isReflexive;
    this.addMessages = edgeData.cannoliData.addMessages;
    this.edgeModifier = edgeData.cannoliData.edgeModifier
      ? edgeData.cannoliData.edgeModifier
      : null;
    this.content = edgeData.cannoliData.content
      ? edgeData.cannoliData.content
      : null;
    this.messages = edgeData.cannoliData.messages
      ? edgeData.cannoliData.messages
      : null;
    this.versions = edgeData.cannoliData.versions
      ? edgeData.cannoliData.versions
      : null;

    // Overrwite the addMessages for certain types of edges
    if (
      this.type === EdgeType.Chat ||
      this.type === EdgeType.SystemMessage ||
      this.type === EdgeType.ChatResponse ||
      this.type === EdgeType.ChatConverter
    ) {
      this.addMessages = true;
    }
  }

  getSource(): CannoliVertex {
    return this.graph[this.source] as CannoliVertex;
  }

  getTarget(): CannoliVertex {
    return this.graph[this.target] as CannoliVertex;
  }

  setContent(content: string | Record<string, string> | undefined) {
    this.content = content ?? "";
    const data = this.canvasData.edges.find(
      (edge) => edge.id === this.id,
    ) as VerifiedCannoliCanvasEdgeData;
    data.cannoliData.content = content ?? "";
  }

  setMessages(messages: GenericCompletionResponse[] | undefined) {
    this.messages = messages ?? null;
    const data = this.canvasData.edges.find(
      (edge) => edge.id === this.id,
    ) as VerifiedCannoliCanvasEdgeData;
    data.cannoliData.messages = messages;
  }

  setVersionHeaders(index: number, header: string, subheader: string) {
    if (this.versions) {
      this.versions[index].header = header;
      this.versions[index].subHeader = subheader;

      const data = this.canvasData.edges.find(
        (edge) => edge.id === this.id,
      ) as VerifiedCannoliCanvasEdgeData;
      data.cannoliData.versions = this.versions;
    }
  }

  load({
    content,
    request,
  }: {
    content?: string | Record<string, string>;
    request?: GenericCompletionParams;
  }): void {
    // If there is a versions array
    if (this.versions) {
      let versionCount = 0;
      for (const group of this.crossingOutGroups) {
        const groupObject = this.graph[group] as CannoliGroup;
        // Get the incoming item edge, if there is one
        const itemEdge = groupObject.incomingEdges.find(
          (edge) => this.graph[edge].type === EdgeType.Item,
        );
        if (itemEdge) {
          // Get the item edge object
          const itemEdgeObject = this.graph[itemEdge] as CannoliEdge;

          // Set the version header to the name of the list edge
          this.setVersionHeaders(
            versionCount,
            itemEdgeObject.text,
            itemEdgeObject.content as string,
          );

          versionCount++;
        }
      }
    }

    this.setContent(content);

    if (this.addMessages) {
      this.setMessages(
        request && request.messages ? request.messages : undefined,
      );
    }
  }

  async execute(): Promise<void> {
    this.completed();
  }

  dependencyCompleted(dependency: CannoliObject): void {
    if (
      this.allDependenciesComplete() &&
      this.status === CannoliObjectStatus.Pending
    ) {
      // console.log(
      // 	`Executing edge with loaded content: ${
      // 		this.content
      // 	} and messages:\n${JSON.stringify(this.messages, null, 2)}`
      // );
      this.execute();
    }
  }

  logDetails(): string {
    // Build crossing groups string of the text of the crossing groups
    let crossingGroupsString = "";
    crossingGroupsString += `Crossing Out Groups: `;
    for (const group of this.crossingOutGroups) {
      crossingGroupsString += `\n\t-"${this.ensureStringLength(
        this.graph[group].text,
        15,
      )}"`;
    }
    crossingGroupsString += `\nCrossing In Groups: `;
    for (const group of this.crossingInGroups) {
      crossingGroupsString += `\n\t-"${this.ensureStringLength(
        this.graph[group].text,
        15,
      )}"`;
    }

    return (
      `--> Edge ${this.id} Text: "${
        this.text ?? "undefined string"
      }"\n"${this.ensureStringLength(
        this.getSource().text ?? "undefined string",
        15,
      )}--->"${this.ensureStringLength(
        this.getTarget().text ?? "undefined string",
        15,
      )}"\n${crossingGroupsString}\nisReflexive: ${
        this.isReflexive
      }\nType: ${this.type}\n` + super.logDetails()
    );
  }

  reset() {
    if (!this.isReflexive) {
      super.reset();
    }
  }
}
