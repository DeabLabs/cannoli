import type { Run } from "../run";
import {
  AllVerifiedCannoliCanvasNodeData,
  CallNodeType,
  CannoliGraph,
  CannoliObjectKind,
  CannoliObjectStatus,
  EdgeType,
  GroupType,
  NodeType,
  VerifiedCannoliCanvasData,
  VerifiedCannoliCanvasEdgeData,
  VerifiedCannoliCanvasGroupData,
} from "../graph";
import invariant from "tiny-invariant";

export class CannoliObject extends EventTarget {
  // @ts-ignore this is bad, but I don't want to refactor this right now
  run: Run;
  id: string;
  text: string;
  status: CannoliObjectStatus;
  dependencies: string[];
  graph: Record<string, CannoliObject> = {};
  cannoliGraph: CannoliGraph = new CannoliGraph({ nodes: [], edges: [] });
  canvasData: VerifiedCannoliCanvasData;
  originalObject: string | null;
  kind: CannoliObjectKind;
  type: EdgeType | NodeType | GroupType;

  constructor(
    data: AllVerifiedCannoliCanvasNodeData | VerifiedCannoliCanvasEdgeData,
    canvasData: VerifiedCannoliCanvasData,
  ) {
    super();
    this.id = data.id;
    this.text = data.cannoliData.text;
    this.status = data.cannoliData.status;
    this.dependencies = data.cannoliData.dependencies;
    this.originalObject = data.cannoliData.originalObject;
    this.kind = data.cannoliData.kind;
    this.type = data.cannoliData.type;
    this.canvasData = canvasData;
  }

  setRun(run: Run) {
    this.run = run;
  }

  setGraph(graph: Record<string, CannoliObject>, cannoliGraph: CannoliGraph) {
    this.graph = graph;
    this.cannoliGraph = cannoliGraph;
  }

  setupListeners() {
    // For each dependency
    for (const dependency of this.dependencies) {
      // Set up a listener for the dependency's completion event
      this.graph[dependency].addEventListener(
        "update",
        // @ts-ignore
        (event: CustomEvent) => {
          // Assuming that 'obj' and 'status' are properties in the detail of the CustomEvent
          this.dependencyUpdated(event.detail.obj, event.detail.status);
        },
      );
    }
  }

  setStatus(status: CannoliObjectStatus) {
    this.status = status;
    invariant(this.run, "Run is not set");
    if (
      this.kind === CannoliObjectKind.Node ||
      this.kind === CannoliObjectKind.Group
    ) {
      const data = this.canvasData.nodes.find(
        (node) => node.id === this.id,
      ) as AllVerifiedCannoliCanvasNodeData;
      data.cannoliData.status = status;

      if (
        this.type === CallNodeType.StandardCall ||
        this.type === CallNodeType.Choose ||
        this.type === CallNodeType.Form
      ) {
        if (status === CannoliObjectStatus.Pending) {
          if (this.run.config && this.run.config.contentIsColorless) {
            data.color = "6";
          } else {
            data.color = undefined;
          }
        } else if (status === CannoliObjectStatus.Executing) {
          data.color = "3";
        } else if (status === CannoliObjectStatus.Complete) {
          data.color = "4";
        }
      }
    } else if (this.kind === CannoliObjectKind.Edge) {
      const data = this.canvasData.edges.find(
        (edge) => edge.id === this.id,
      ) as VerifiedCannoliCanvasEdgeData;
      data.cannoliData.status = status;
    }
  }

  setText(text: string) {
    this.text = text;
    if (this.kind === CannoliObjectKind.Node) {
      const data = this.canvasData.nodes.find(
        (node) => node.id === this.id,
      ) as AllVerifiedCannoliCanvasNodeData;
      data.cannoliData.text = text;
      data.text = text;
    } else if (this.kind === CannoliObjectKind.Group) {
      const data = this.canvasData.nodes.find(
        (group) => group.id === this.id,
      ) as VerifiedCannoliCanvasGroupData;
      data.cannoliData.text = text;
      data.label = text;
    }
  }

  getAllDependencies(): CannoliObject[] {
    const dependencies: CannoliObject[] = [];
    for (const dependency of this.dependencies) {
      dependencies.push(this.graph[dependency]);
    }

    return dependencies;
  }

  dependencyUpdated(dependency: CannoliObject, status: CannoliObjectStatus) {
    switch (status) {
      case CannoliObjectStatus.Complete:
        this.dependencyCompleted(dependency);
        break;
      case CannoliObjectStatus.Rejected:
        this.dependencyRejected(dependency);
        break;
      case CannoliObjectStatus.Executing:
        this.dependencyExecuting(dependency);
        break;
      default:
        break;
    }
  }

  allDependenciesComplete(): boolean {
    // Get the dependencies as objects
    const dependencies = this.getAllDependencies();

    // For each dependency
    for (const dependency of dependencies) {
      // New logic for edges with versions property
      if (
        this.cannoliGraph.isEdge(dependency) &&
        dependency.versions !== undefined
      ) {
        for (const otherDependency of dependencies) {
          if (
            this.cannoliGraph.isEdge(otherDependency) &&
            otherDependency.text === dependency.text &&
            otherDependency.status !== CannoliObjectStatus.Complete &&
            otherDependency.status !== CannoliObjectStatus.Rejected
          ) {
            // If any other edge with the same name is not complete or rejected, return false
            return false;
          }
        }
      }

      if (dependency.status !== CannoliObjectStatus.Complete) {
        // If the dependency is a non-logging edge
        if (
          this.cannoliGraph.isEdge(dependency) &&
          dependency.type !== EdgeType.Logging
        ) {
          let redundantComplete = false;

          // Check if there are any other edge dependencies that share the same name and type which are complete
          for (const otherDependency of dependencies) {
            if (
              this.cannoliGraph.isEdge(otherDependency) &&
              otherDependency.text === dependency.text &&
              otherDependency.type === dependency.type &&
              otherDependency.status === CannoliObjectStatus.Complete
            ) {
              // If there are, set redundantComplete to true
              redundantComplete = true;
              break;
            }
          }

          // If redundantComplete is false, return false
          if (!redundantComplete) {
            return false;
          }
        } else {
          // If the dependency is not an edge, return false
          return false;
        }
      }
    }
    return true;
  }

  allEdgeDependenciesComplete(): boolean {
    // Get the dependencies as objects
    const dependencies = this.getAllDependencies();

    // For each dependency
    for (const dependency of dependencies) {
      // If the dependency it's not an edge, continue
      if (!this.cannoliGraph.isEdge(dependency)) {
        continue;
      }

      if (dependency.status !== CannoliObjectStatus.Complete) {
        // If the dependency is a non-logging edge
        if (
          this.cannoliGraph.isEdge(dependency) &&
          dependency.type !== EdgeType.Logging
        ) {
          let redundantComplete = false;

          // Check if there are any other edge dependencies that share the same name which are complete
          for (const otherDependency of dependencies) {
            if (
              this.cannoliGraph.isEdge(otherDependency) &&
              otherDependency.text === dependency.text &&
              otherDependency.status === CannoliObjectStatus.Complete
            ) {
              // If there are, set redundantComplete to true
              redundantComplete = true;
              break;
            }
          }

          // If redundantComplete is false, return false
          if (!redundantComplete) {
            return false;
          }
        } else {
          // If the dependency is not an edge, return false
          return false;
        }
      }
    }
    return true;
  }

  executing() {
    this.setStatus(CannoliObjectStatus.Executing);
    const event = new CustomEvent("update", {
      detail: { obj: this, status: CannoliObjectStatus.Executing },
    });
    this.dispatchEvent(event);
  }

  completed() {
    this.setStatus(CannoliObjectStatus.Complete);
    const event = new CustomEvent("update", {
      detail: { obj: this, status: CannoliObjectStatus.Complete },
    });
    this.dispatchEvent(event);
  }

  pending() {
    this.setStatus(CannoliObjectStatus.Pending);
    const event = new CustomEvent("update", {
      detail: { obj: this, status: CannoliObjectStatus.Pending },
    });
    this.dispatchEvent(event);
  }

  reject() {
    this.setStatus(CannoliObjectStatus.Rejected);
    const event = new CustomEvent("update", {
      detail: { obj: this, status: CannoliObjectStatus.Rejected },
    });
    this.dispatchEvent(event);
  }

  tryReject() {
    // Check all dependencies
    const shouldReject = this.getAllDependencies().every((dependency) => {
      if (dependency.status === CannoliObjectStatus.Rejected) {
        // If the dependency is an edge
        if (this.cannoliGraph.isEdge(dependency)) {
          let redundantNotRejected = false;

          // Check if there are any other edge dependencies that share the same name and are not rejected
          for (const otherDependency of this.getAllDependencies()) {
            if (
              this.cannoliGraph.isEdge(otherDependency) &&
              otherDependency.text === dependency.text &&
              otherDependency.status !== CannoliObjectStatus.Rejected
            ) {
              // If there are, set redundantNotRejected to true and break the loop
              redundantNotRejected = true;
              break;
            }
          }

          // If redundantNotRejected is true, return true to continue the evaluation
          if (redundantNotRejected) {
            return true;
          }
        }

        // If the dependency is not an edge or no redundancy was found, return false to reject
        return false;
      }

      // If the current dependency is not rejected, continue the evaluation
      return true;
    });

    // If the object should be rejected, call the reject method
    if (!shouldReject) {
      this.reject();
    }
  }

  ensureStringLength(str: string, maxLength: number): string {
    if (str.length > maxLength) {
      return str.substring(0, maxLength - 3) + "...";
    } else {
      return str;
    }
  }

  reset() {
    this.setStatus(CannoliObjectStatus.Pending);
    const event = new CustomEvent("update", {
      detail: { obj: this, status: CannoliObjectStatus.Pending },
    });
    this.dispatchEvent(event);
  }

  dependencyRejected(dependency: CannoliObject) {
    this.tryReject();
  }

  dependencyCompleted(dependency: CannoliObject) {}

  dependencyExecuting(dependency: CannoliObject) {}

  async execute() {}

  logDetails(): string {
    let dependenciesString = "";
    for (const dependency of this.dependencies) {
      dependenciesString += `\t"${this.graph[dependency].text}"\n`;
    }

    return `Dependencies:\n${dependenciesString}\n`;
  }

  validate() {}
}
