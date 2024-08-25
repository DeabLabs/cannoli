import { SimCanvas } from "./layoutSim";

type CanvasColor = string; // Hex format or preset numbers "1" to "6"

type NodeType = "text" | "group";

type Side = "top" | "right" | "bottom" | "left";

interface BaseNode {
    id: string;
    type: NodeType;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: CanvasColor;
}

interface TextNode extends BaseNode {
    type: "text";
    text: string;
}

interface GroupNode extends BaseNode {
    type: "group";
    label?: string;
}

type Node = TextNode | GroupNode;

interface Edge {
    id: string;
    fromNode: string;
    fromSide?: Side;
    toNode: string;
    toSide?: Side;
    toEnd: "arrow";
    color?: CanvasColor;
    label?: string;
}

export interface JsonCanvas {
    nodes: Node[];
    edges: Edge[];
}

// function calculateNodeCenter(node: Node): { x: number; y: number } {
//     return {
//         x: node.x + node.width / 2,
//         y: node.y + node.height / 2
//     };
// }

// function calculateAngle(source: { x: number; y: number }, target: { x: number; y: number }): number {
//     const deltaY = target.y - source.y;
//     const deltaX = target.x - source.x;
//     let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
//     if (angle < 0) angle += 360; // Normalize to 0-360
//     return angle;
// }

// function determineSides(angle: number): { fromSide: Side, toSide: Side } {
//     if (angle <= 45 || angle > 315) return { fromSide: "right", toSide: "left" };
//     if (angle <= 135) return { fromSide: "bottom", toSide: "top" };
//     if (angle <= 225) return { fromSide: "left", toSide: "right" };
//     return { fromSide: "top", toSide: "bottom" };
// }

export function convertSimCanvasToJsonCanvas(simCanvas: SimCanvas): JsonCanvas {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // First, create all nodes
    const nodeMap = new Map<string, Node>();
    for (const vertex of simCanvas.vertices) {
        // Round the position to the nearest integer
        const roundedPosition = {
            x: Math.round(vertex.position.x),
            y: Math.round(vertex.position.y),
        };

        if (vertex.type === "node") {
            const node: TextNode = {
                id: vertex.id,
                type: "text",
                x: roundedPosition.x,
                y: roundedPosition.y,
                width: vertex.width,
                height: vertex.height,
                color: vertex.color,
                text: vertex.text,
            };
            nodes.push(node);
            nodeMap.set(vertex.id, node);
        } else {
            const node: GroupNode = {
                id: vertex.id,
                type: "group",
                x: roundedPosition.x,
                y: roundedPosition.y,
                width: vertex.width,
                height: vertex.height,
                color: vertex.color,
                label: vertex.label,
            };
            nodes.push(node);
            nodeMap.set(vertex.id, node);
        }
    }

    // Then, create all edges
    for (const simEdge of simCanvas.edges) {
        const sourceNode = nodeMap.get(simEdge.source.id);
        const targetNode = nodeMap.get(simEdge.target.id);

        if (sourceNode && targetNode) {
            // const sourceCenter = calculateNodeCenter(sourceNode);
            // const targetCenter = calculateNodeCenter(targetNode);
            // const angle = calculateAngle(sourceCenter, targetCenter);
            // const { fromSide, toSide } = determineSides(angle);

            const edge: Edge = {
                id: simEdge.id,
                fromNode: simEdge.source.id,
                fromSide: simEdge.sourceAnchor,
                toNode: simEdge.target.id,
                toSide: simEdge.targetAnchor,
                toEnd: "arrow",
                color: simEdge.color,
                label: simEdge.label,
            };
            edges.push(edge);
        }
    }

    return { nodes, edges };
}