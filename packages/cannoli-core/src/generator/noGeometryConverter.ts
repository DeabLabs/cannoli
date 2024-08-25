import { CanvasColor, SimCanvas, SimEdge, SimGroup, SimNode, SimVertex, Vector2D } from "./layoutSim";
import { CannoliRecipe, RecipeArrow, RecipeGroup, RecipeNode } from "./recipeSchema";

interface UnlinkedSimEdge {
    id: string;
    source: SimVertex;
    targetName: string;
    color?: CanvasColor;
    label?: string;
}

interface DimensionOptions {
    charWidth: number;
    lineHeight: number;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
}

function calculateNodeDimensions(text: string, options: DimensionOptions): { width: number, height: number } {
    const lines = text.split('\n');
    const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b);

    let width = longestLine.length * options.charWidth;
    width = Math.max(options.minWidth, Math.min(width, options.maxWidth));

    let totalLines = 0;
    for (const line of lines) {
        const wrappedLines = Math.ceil((line.length * options.charWidth) / width);
        totalLines += wrappedLines;
    }

    let height = totalLines * options.lineHeight;
    height = Math.max(options.minHeight, Math.min(height, options.maxHeight));

    return { width, height };
}

export function convertRecipeStringToCanvasNoGeometry(recipeString: string): SimCanvas {
    const converter = new RecipeToNoGeometryCanvasConverter(recipeString);

    return converter.getCanvas();
}

class RecipeToNoGeometryCanvasConverter {
    private recipe: CannoliRecipe;
    private canvasNodesWithNames: {
        [key: string]: SimVertex;
    } = {};
    private canvasEdgesWithoutToNodeId: UnlinkedSimEdge[] = [];
    private canvasEdges: SimEdge[] = [];

    constructor(recipeString: string) {
        const recipeObject = JSON.parse(recipeString);

        this.recipe = recipeObject as CannoliRecipe;

        // this.recipe = cannoliRecipeSchema.parse(recipeObject);

        // console.log("zod parsed recipe", this.recipe);

        this.canvasNodesWithNames = this.getCanvasNodesWithNames();
        this.canvasEdges = this.getLinkedEdges();
    }

    public getCanvas(): SimCanvas {
        return {
            vertices: Object.values(this.canvasNodesWithNames),
            edges: this.canvasEdges,
        };
    }

    private getCanvasNodesWithNames(): {
        [key: string]: SimVertex;
    } {
        for (const node of this.recipe.graph) {
            if (node.kind === "node") {
                this.canvasNodesWithNames[node.name] = this.recipeNodeToCanvasNode(node as RecipeNode, null);
            } else if (node.kind === "group") {
                this.canvasNodesWithNames[node.name] = this.recipeGroupToCanvasNode(node as RecipeGroup, null);
            } else {
                throw new Error(`Unknown node kind: ${node.kind}`);
            }
        }

        return this.canvasNodesWithNames;
    }

    private getLinkedEdges(): SimEdge[] {
        const edgesWithTargetNode: SimEdge[] = [];

        // Loop through all edges without a toNode and use the name to find the toNode
        for (const edge of this.canvasEdgesWithoutToNodeId) {
            const targetNode = this.canvasNodesWithNames[edge.targetName];
            if (!targetNode) {
                throw new Error(`To node not found: ${edge.targetName}`);
            }

            edgesWithTargetNode.push({
                ...edge,
                target: targetNode,
                sourceAnchor: "bottom",
                targetAnchor: "top",
                lastAnchorChangeTime: 0,
            });
        }

        return edgesWithTargetNode;
    }

    private recipeNodeToCanvasNode(node: RecipeNode, directParent: SimGroup | null): SimNode {
        let color: CanvasColor = undefined;
        let content: string = node.content;

        switch (node.type) {
            case "ai":
                break;
            case "content":
                color = "6";
                break;
            case "formatter":
                color = "6";
                content = `""${content}""`;
                break;
            case "reference":
                color = "6";
                break;
            case "action":
                color = "2";
                break;
            default:
                throw new Error(`Unknown node type: ${node.type}`);
        }

        const nodeId = generateId();

        const dimensionOptions: DimensionOptions = {
            charWidth: 9,
            lineHeight: 35,
            minWidth: 150,
            maxWidth: 400,
            minHeight: 60,
            maxHeight: 1000
        };

        const { width, height } = calculateNodeDimensions(content, dimensionOptions);

        const simNode: SimNode = {
            id: nodeId,
            type: "node",
            text: content,
            color,
            directParent,
            position: new Vector2D(0, 0),
            velocity: new Vector2D(0, 0),
            width,
            height,
            anchored: false,
            noGravity: false,
            verticallyAnchored: false,
        };

        node.outgoingArrows.forEach((arrow) => {
            const newEdge = this.recipeArrowToCanvasEdge(arrow, simNode);
            this.canvasEdgesWithoutToNodeId.push(newEdge);
        });

        return simNode;
    }

    private recipeGroupToCanvasNode(group: RecipeGroup, directParent: SimGroup | null): SimGroup {
        let color: CanvasColor = undefined;
        let label: string | undefined = group.label;

        switch (group.type) {
            case "basic":
                label = undefined;
                break;
            case "loop":
                break;
            case "parallel":
                color = "5";
                break;
            default:
                throw new Error(`Unknown group type: ${group.type}`);
        }

        const groupId = generateId();

        const simGroup: SimGroup = {
            id: groupId,
            type: "group",
            label,
            color,
            directParent,
            children: [],
            position: new Vector2D(0, 0),
            velocity: new Vector2D(0, 0),
            width: 100,
            height: 100,
            anchored: false,
            noGravity: false,
            verticallyAnchored: false,
        };

        group.outgoingArrows.forEach((arrow) => {
            const newEdge = this.recipeArrowToCanvasEdge(arrow, simGroup);
            this.canvasEdgesWithoutToNodeId.push(newEdge);
        });

        group.members.forEach((member) => {
            if (member.kind === "node") {
                const newNode = this.recipeNodeToCanvasNode(member as RecipeNode, simGroup);
                simGroup.children.push(newNode);
                this.canvasNodesWithNames[member.name] = newNode;
            } else {
                const newGroup = this.recipeGroupToCanvasNode(member as RecipeGroup, simGroup);
                simGroup.children.push(newGroup);
                this.canvasNodesWithNames[member.name] = newGroup;
            }
        });

        return simGroup;
    }

    private recipeArrowToCanvasEdge(arrow: RecipeArrow, fromNode: SimVertex): UnlinkedSimEdge {
        let color: CanvasColor = undefined;
        let label: string | undefined = arrow.label;

        switch (arrow.type) {
            case "basic":
                label = undefined;
                break;
            case "variable":
                break;
            case "choice":
                color = "3";
                break;
            case "field":
                color = "6";
                break;
            case "list":
                color = "5";
                break;
            case "config":
                color = "2";
                break;
            default:
                throw new Error(`Unknown arrow type: ${arrow.type}`);
        }

        return {
            id: generateId(),
            label,
            source: fromNode,
            targetName: arrow.toNode, // This is the name, not the id yet
            color,
        };
    }
}

function generateId(): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < 16; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}