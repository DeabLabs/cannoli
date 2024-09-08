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