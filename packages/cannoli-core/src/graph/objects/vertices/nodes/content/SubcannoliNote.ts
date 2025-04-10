import { ContentNode } from "../ContentNode";
import {
  Reference,
  ReferenceType,
  VerifiedCannoliCanvasData,
  VerifiedCannoliCanvasFileData,
  VerifiedCannoliCanvasLinkData,
  VerifiedCannoliCanvasTextData,
} from "src/graph";

export class SubcannoliNode extends ContentNode {
  reference: Reference;

  constructor(
    nodeData:
      | VerifiedCannoliCanvasFileData
      | VerifiedCannoliCanvasLinkData
      | VerifiedCannoliCanvasTextData,
    fullCanvasData: VerifiedCannoliCanvasData,
  ) {
    super(nodeData, fullCanvasData);

    this.reference = {
      name: nodeData.cannoliData.text.replace("{{[[", "").replace("]]}}", ""),
      shouldExtract: false,
      type: ReferenceType.Note,
      includeLink: false,
      includeName: false,
      includeProperties: false,
      subpath: "",
    };
  }

  async execute(): Promise<void> {
    this.executing();

    const content = await this.getContentFromCanvas(this.reference);

    if (content === null) {
      this.error("Could not find subcannoli canvas.");
      return;
    }

    const variableValues = this.getVariableValues(false);

    const args: Record<string, string> = {};

    for (const variable of variableValues) {
      args[variable.name] = variable.content;
    }

    let results: Record<string, string> = {};

    try {
      results = await this.run.subcannoliCallback(
        content,
        args,
        this.run.isMock,
      );
    } catch (error) {
      this.error(`Error executing subcannoli: ${error}`);
      return;
    }

    let resultsString = "";

    // If results is empty, set results string to empty string
    if (Object.keys(results).length > 0) {
      resultsString = JSON.stringify(results, null, 2);
    }

    const outgoingEdges = this.getOutgoingEdges();

    for (const edge of outgoingEdges) {
      if (edge.text in results) {
        edge.load({ content: results[edge.text] });
      } else {
        edge.load({ content: resultsString });
      }
    }

    this.completed();
  }
}
