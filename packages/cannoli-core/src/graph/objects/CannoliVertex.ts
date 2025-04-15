import {
  getIncomingEdgesFromData,
  getOutgoingEdgesFromData,
} from "src/factory";
import { CannoliObject } from "../CannoliObject";
import {
  AllVerifiedCannoliCanvasNodeData,
  VerifiedCannoliCanvasData,
  CannoliObjectStatus,
} from "../../graph";
import { CannoliEdge } from "./CannoliEdge";
import { CannoliGroup } from "./vertices/CannoliGroup";

export class CannoliVertex extends CannoliObject {
  outgoingEdges: string[];
  incomingEdges: string[];
  groups: string[]; // Sorted from immediate parent to most distant

  constructor(
    vertexData: AllVerifiedCannoliCanvasNodeData,
    fullCanvasData: VerifiedCannoliCanvasData,
  ) {
    super(vertexData, fullCanvasData);
    this.outgoingEdges = getOutgoingEdgesFromData(this.id, this.canvasData);
    this.incomingEdges = getIncomingEdgesFromData(this.id, this.canvasData);
    this.groups = vertexData.cannoliData.groups;
  }

  getOutgoingEdges(): CannoliEdge[] {
    return this.outgoingEdges.map((edge) => this.graph[edge] as CannoliEdge);
  }

  getIncomingEdges(): CannoliEdge[] {
    return this.incomingEdges.map((edge) => this.graph[edge] as CannoliEdge);
  }

  getGroups(): CannoliGroup[] {
    return this.groups.map((group) => this.graph[group] as CannoliGroup);
  }

  createRectangle(x: number, y: number, width: number, height: number) {
    return {
      x,
      y,
      width,
      height,
      x_right: x + width,
      y_bottom: y + height,
    };
  }

  encloses(
    a: ReturnType<typeof this.createRectangle>,
    b: ReturnType<typeof this.createRectangle>,
  ): boolean {
    return (
      a.x <= b.x &&
      a.y <= b.y &&
      a.x_right >= b.x_right &&
      a.y_bottom >= b.y_bottom
    );
  }

  overlaps(
    a: ReturnType<typeof this.createRectangle>,
    b: ReturnType<typeof this.createRectangle>,
  ): boolean {
    const horizontalOverlap = a.x < b.x_right && a.x_right > b.x;
    const verticalOverlap = a.y < b.y_bottom && a.y_bottom > b.y;
    const overlap = horizontalOverlap && verticalOverlap;
    return overlap && !this.encloses(a, b) && !this.encloses(b, a);
  }

  error(message: string) {
    this.setStatus(CannoliObjectStatus.Error);
    const event = new CustomEvent("update", {
      detail: {
        obj: this,
        status: CannoliObjectStatus.Error,
        message: message,
      },
    });
    this.dispatchEvent(event);
    console.error(message);
  }

  warning(message: string) {
    this.setStatus(CannoliObjectStatus.Warning);
    const event = new CustomEvent("update", {
      detail: {
        obj: this,
        status: CannoliObjectStatus.Warning,
        message: message,
      },
    });
    this.dispatchEvent(event);
    console.error(message); // Consider changing this to console.warn(message);
  }

  validate() {
    super.validate();
  }
}
