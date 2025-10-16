import {
  VerifiedCannoliCanvasGroupData,
  VerifiedCannoliCanvasData,
  CannoliObjectStatus,
  EdgeType,
} from "src/graph";
import { CannoliEdge } from "../../CannoliEdge";
import { CannoliGroup } from "../CannoliGroup";

export class RepeatGroup extends CannoliGroup {
  constructor(
    groupData: VerifiedCannoliCanvasGroupData,
    fullCanvasData: VerifiedCannoliCanvasData,
  ) {
    super(groupData, fullCanvasData);

    this.currentLoop = groupData.cannoliData.currentLoop ?? 0;
    this.maxLoops = groupData.cannoliData.maxLoops ?? 1;
  }

  async execute(): Promise<void> {
    this.setStatus(CannoliObjectStatus.Executing);
    const event = new CustomEvent("update", {
      detail: { obj: this, status: CannoliObjectStatus.Executing },
    });
    this.dispatchEvent(event);
  }

  resetMembers() {
    // For each member
    for (const member of this.getMembers()) {
      // Reset the member
      member.reset();
      // Reset the member's outgoing edges whose target isn't this group
      for (const edge of member.outgoingEdges) {
        const edgeObject = this.graph[edge] as CannoliEdge;

        if (edgeObject.getTarget() !== this) {
          edgeObject.reset();
        }
      }
    }
  }

  membersFinished(): void {
    this.setCurrentLoop(this.currentLoop + 1);
    this.setText(`${this.currentLoop}/${this.maxLoops}`);

    if (
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.currentLoop < this.maxLoops! &&
      this.allEdgeDependenciesComplete()
    ) {
      if (!this.run.isMock) {
        // Sleep for 20ms to allow complete color to render
        setTimeout(() => {
          this.resetMembers();

          const event = new CustomEvent("update", {
            detail: {
              obj: this,
              status: CannoliObjectStatus.VersionComplete,
              message: this.currentLoop.toString(),
            },
          });

          this.dispatchEvent(event);

          this.executeMembers();
        }, 20);
      } else {
        this.resetMembers();
        this.executeMembers();
      }
    } else {
      this.setStatus(CannoliObjectStatus.Complete);
      const event = new CustomEvent("update", {
        detail: { obj: this, status: CannoliObjectStatus.Complete },
      });
      this.dispatchEvent(event);
    }
  }

  executeMembers(): void {
    // For each member
    for (const member of this.getMembers()) {
      member.dependencyCompleted(this);
    }
  }

  reset(): void {
    super.reset();
    this.setCurrentLoop(0);
    this.setText(`0/${this.maxLoops}`);
  }

  logDetails(): string {
    return super.logDetails() + `Type: Repeat\nMax Loops: ${this.maxLoops}\n`;
  }

  validate(): void {
    super.validate();

    // Repeat groups must have a valid label number
    if (this.maxLoops === null) {
      this.error(
        `Repeat groups loops must have a valid number in their label. Please ensure the label is a positive integer.`,
      );
    }

    // Repeat groups can't have incoming edges of type list
    const listEdges = this.incomingEdges.filter(
      (edge) => this.graph[edge].type === EdgeType.List,
    );

    if (listEdges.length !== 0) {
      this.error(`Repeat groups can't have incoming edges of type list.`);
    }

    // Repeat groups can't have any outgoing edges
    if (this.outgoingEdges.length !== 0) {
      this.error(`Repeat groups can't have any outgoing edges.`);
    }
  }
}
