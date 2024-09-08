import { convertSimCanvasToJsonCanvas, JsonCanvas } from "./jsonCanvas";

export type CanvasColor = string | "1" | "2" | "3" | "4" | "5" | "6" | undefined; // Hex format or preset colors "1" to "6"

export type VertexType = "node" | "group";

export interface BaseSimVertex {
    id: string;
    type: VertexType;
    directParent: SimGroup | null;
    color?: CanvasColor;
    position: Vector2D;
    velocity: Vector2D;
    width: number;
    height: number;
    anchored: boolean;
    noGravity: boolean;
    verticallyAnchored: boolean;
}

export interface SimNode extends BaseSimVertex {
    type: "node";
    text: string;
}

export interface SimGroup extends BaseSimVertex {
    type: "group";
    label?: string;
    children: SimVertex[];
}

export type SimVertex = SimNode | SimGroup;

export interface SimEdge {
    id: string;
    source: SimVertex;
    target: SimVertex;
    sourceAnchor: "top" | "bottom" | "left" | "right";
    targetAnchor: "top" | "bottom" | "left" | "right";
    color?: CanvasColor;
    label?: string;
    lastAnchorChangeTime: number; // New property
}

export type SimCanvas = {
    vertices: SimVertex[];
    edges: SimEdge[];
}

interface ConnectedComponent {
    nodes: SimNode[];
    rootNode: SimNode;
}

export class Vector2D {
    constructor(public x: number, public y: number) { }

    add(v: Vector2D): Vector2D {
        return new Vector2D(this.x + v.x, this.y + v.y);
    }

    subtract(v: Vector2D): Vector2D {
        return new Vector2D(this.x - v.x, this.y - v.y);
    }

    multiply(scalar: number): Vector2D {
        return new Vector2D(this.x * scalar, this.y * scalar);
    }

    divide(scalar: number): Vector2D {
        return new Vector2D(this.x / scalar, this.y / scalar);
    }

    magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    normalize(): Vector2D {
        const mag = this.magnitude();
        return mag > 0 ? this.divide(mag) : new Vector2D(0, 0);
    }

    static distance(v1: Vector2D, v2: Vector2D): number {
        return v1.subtract(v2).magnitude();
    }
}

export class LayoutSimulator {
    canvas: SimCanvas;
    writeCallback: ((jsonCanvas: JsonCanvas) => Promise<void>) | undefined;
    time: number;

    // Simulation parameters
    // Total number of simulation steps. Increasing this allows for more settling time but increases computation.
    duration = 10000;

    // Strength of repulsion between nodes. Higher values push nodes apart more forcefully.
    repulsionStrength = 2000;

    // Stiffness of edges. Higher values make edges behave more like rigid rods.
    edgeSpringConstant = 0.03;

    // Desired length of edges. Increasing this spreads connected nodes further apart.
    edgeLength = 100;

    // Velocity reduction per step. Lower values (closer to 0) result in more movement, higher values (closer to 1) stabilize the layout faster.
    damping = 0.6;

    // Downward force applied to non-anchored nodes. Increasing y value pulls nodes downward more strongly.
    gravity = new Vector2D(0, 0.5);

    // Simulated mass of nodes. Higher values make nodes more resistant to force-based movement.
    vertexMass = 1;

    // Minimum space between node borders. Increasing this forces more space between nodes.
    minBorderDistance = 50;

    // Multiplier for repulsion when nodes overlap. Higher values separate overlapping nodes more aggressively.
    overlapRepulsionFactor = 8;

    // Speed limit for node movement. Lowering this can lead to more stable but slower layout convergence.
    maxVelocity = 10;

    // Padding between groups and their children
    groupPadding = 20;

    // Time steps before allowing another anchor change, to prevent bistable edge flipping
    anchorChangeCooldown = 300;

    // Affects how large the size of the initial square for a connected component is, higher values mean larger squares
    initializationAreaFactor = 7;

    // Strength of sideways gravity for non-origin root nodes. Higher values pull nodes towards the center more strongly.
    sidewaysGravityStrength = 0.003;

    private rootNodes: Set<string> = new Set();
    private originRootNode: SimNode | null = null;

    constructor(canvas: SimCanvas, writeCallback?: (jsonCanvas: JsonCanvas) => Promise<void>) {
        this.canvas = canvas;
        this.writeCallback = writeCallback;
        this.time = 0;
    }

    async simulate() {
        console.log("simulating layout");
        this.initializeVertices();
        while (this.time < this.duration) {
            const { currentJsonCanvas } = this.step();
            if (this.writeCallback) {
                await this.writeCallback(currentJsonCanvas);
            }
        }
        console.log("final json canvas:", convertSimCanvasToJsonCanvas(this.canvas));
    }

    step(): { currentJsonCanvas: JsonCanvas, noGroupOverlap: boolean } {
        this.applyForces();
        this.updatePositions();
        this.updateAllGroups();
        this.time += 1;
        return { currentJsonCanvas: convertSimCanvasToJsonCanvas(this.canvas), noGroupOverlap: true };
    }

    isSourceNode(vertex: SimVertex): boolean {
        return !this.canvas.edges.some(edge => edge.target.id === vertex.id);
    }

    private findConnectedComponents(): ConnectedComponent[] {
        const components: ConnectedComponent[] = [];
        const visited = new Set<string>();

        for (const vertex of this.canvas.vertices) {
            if (vertex.type === 'node' && !visited.has(vertex.id)) {
                const component = this.exploreComponent(vertex as SimNode, visited);
                const rootNode = this.findComponentRootNode(component);
                components.push({ nodes: component, rootNode });
            }
        }

        return components;
    }

    private exploreComponent(startNode: SimNode, visited: Set<string>): SimNode[] {
        const component: SimNode[] = [];
        const stack = [startNode];

        while (stack.length > 0) {
            const node = stack.pop()!;
            if (!visited.has(node.id)) {
                visited.add(node.id);
                component.push(node);

                // Add both incoming and outgoing connections
                this.canvas.edges.forEach(edge => {
                    if (edge.source.id === node.id && edge.target.type === 'node') {
                        stack.push(edge.target as SimNode);
                    }
                    if (edge.target.id === node.id && edge.source.type === 'node') {
                        stack.push(edge.source as SimNode);
                    }
                });
            }
        }

        return component;
    }

    private findComponentRootNode(component: SimNode[]): SimNode {
        return component.reduce((maxNode, currentNode) => {
            const maxDescendants = this.countDescendants(maxNode.id);
            const currentDescendants = this.countDescendants(currentNode.id);
            return currentDescendants > maxDescendants ? currentNode : maxNode;
        });
    }

    private arrangeRootNodes(components: ConnectedComponent[]): Map<string, Vector2D> {
        const rootPositions = new Map<string, Vector2D>();
        const sortedComponents = components.sort((a, b) => b.nodes.length - a.nodes.length);

        let xOffset = 0;
        const yPosition = 0;
        const spacing = Math.sqrt(this.calculateTotalNodeArea() * this.initializationAreaFactor);

        sortedComponents.forEach((component, index) => {
            if (index === 0) {
                rootPositions.set(component.rootNode.id, new Vector2D(0, yPosition));
            } else {
                xOffset += spacing;
                const xPosition = index % 2 === 0 ? xOffset : -xOffset;
                rootPositions.set(component.rootNode.id, new Vector2D(xPosition, yPosition));
            }
        });

        return rootPositions;
    }

    initializeVertices() {
        this.initializeNodes();
        this.initializeGroups();
    }

    private countDescendants(nodeId: string): number {
        let count = 0;
        const stack = [nodeId];
        const visited = new Set<string>();

        while (stack.length > 0) {
            const currentId = stack.pop()!;
            if (!visited.has(currentId)) {
                visited.add(currentId);
                count++;

                this.canvas.edges
                    .filter(edge => edge.source.id === currentId)
                    .forEach(edge => stack.push(edge.target.id));
            }
        }

        return count - 1; // Subtract 1 to exclude the node itself
    }

    private initializeNodes() {
        const components = this.findConnectedComponents();
        const rootPositions = this.arrangeRootNodes(components);

        components.forEach((component, index) => {
            const rootPosition = rootPositions.get(component.rootNode.id)!;
            const componentArea = this.calculateComponentArea(component.nodes);
            const componentRadius = Math.sqrt(componentArea * this.initializationAreaFactor);

            this.rootNodes.add(component.rootNode.id);
            if (index === 0) {
                this.originRootNode = component.rootNode;
            }

            component.nodes.forEach(node => {
                node.velocity = new Vector2D(0, 0);

                if (node === component.rootNode) {
                    node.position = rootPosition;
                    if (node === this.originRootNode) {
                        node.anchored = true; // Fully anchor the origin root node
                    } else {
                        node.verticallyAnchored = true; // Other root nodes are vertically anchored
                        node.anchored = false;
                    }
                } else if (this.isSourceNode(node)) {
                    node.position = new Vector2D(
                        rootPosition.x + (Math.random() - 0.5) * componentRadius,
                        rootPosition.y
                    );
                    node.noGravity = true;
                } else {
                    node.position = new Vector2D(
                        rootPosition.x + (Math.random() - 0.5) * componentRadius,
                        rootPosition.y + Math.random() * componentRadius
                    );
                    node.anchored = false;
                    node.noGravity = false;
                }
            });
        });
    }

    private calculateComponentArea(nodes: SimNode[]): number {
        return nodes.reduce((total, node) => total + node.width * node.height, 0);
    }

    private calculateTotalNodeArea(): number {
        return this.canvas.vertices.reduce((total, vertex) => {
            if (vertex.type === 'node') {
                return total + vertex.width * vertex.height;
            }
            return total;
        }, 0);
    }

    private initializeGroups() {
        const groups = this.canvas.vertices.filter(v => v.type === 'group') as SimGroup[];
        const processedGroups = new Set<string>();

        // Function to process a group and its subgroups
        const processGroup = (group: SimGroup) => {
            // First, process all subgroups
            const subgroups = group.children.filter(child => child.type === 'group') as SimGroup[];
            for (const subgroup of subgroups) {
                if (!processedGroups.has(subgroup.id)) {
                    processGroup(subgroup);
                }
            }

            // Now that all subgroups are processed, calculate this group's size and position
            this.calculateGroupSizeAndPosition(group);
            processedGroups.add(group.id);
        };

        // Process all top-level groups
        const topLevelGroups = groups.filter(group => !group.directParent);
        for (const group of topLevelGroups) {
            if (!processedGroups.has(group.id)) {
                processGroup(group);
            }
        }
    }

    private calculateGroupSizeAndPosition(group: SimGroup) {
        const boundaries = this.calculateGroupBoundaries(group.children);

        group.width = boundaries.right - boundaries.left + 2 * this.groupPadding;
        group.height = boundaries.bottom - boundaries.top + 2 * this.groupPadding;
        group.position = new Vector2D(boundaries.left - this.groupPadding, boundaries.top - this.groupPadding);
    }

    private calculateGroupBoundaries(children: SimVertex[]): {
        left: number;
        right: number;
        top: number;
        bottom: number;
    } {
        if (children.length === 0) {
            return { left: 0, right: 0, top: 0, bottom: 0 };
        }

        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;

        children.forEach(child => {
            left = Math.min(left, child.position.x);
            right = Math.max(right, child.position.x + child.width);
            top = Math.min(top, child.position.y);
            bottom = Math.max(bottom, child.position.y + child.height);
        });

        return { left, right, top, bottom };
    }

    applyForces() {
        for (const edge of this.canvas.edges) {
            this.applySpringForce(edge);
        }

        for (let i = 0; i < this.canvas.vertices.length; i++) {
            for (let j = i + 1; j < this.canvas.vertices.length; j++) {
                this.applyRepulsionForce(this.canvas.vertices[i], this.canvas.vertices[j]);
            }
            this.applyGravity(this.canvas.vertices[i]);
        }
    }

    applySpringForce(edge: SimEdge) {
        // Skip spring force if source and target are related by ancestry
        if (this.areRelatedByAncestry(edge.source, edge.target)) {
            return;
        }

        // Find optimal anchors
        const { sourceAnchor, targetAnchor, distance } = this.findOptimalAnchors(edge.source, edge.target);

        // Check if we should update the anchors
        if (this.time - edge.lastAnchorChangeTime >= this.anchorChangeCooldown &&
            (edge.sourceAnchor !== sourceAnchor || edge.targetAnchor !== targetAnchor)) {
            edge.sourceAnchor = sourceAnchor;
            edge.targetAnchor = targetAnchor;
            edge.lastAnchorChangeTime = this.time;
        }

        const sourceAnchorPos = this.getAnchorPositions(edge.source)[edge.sourceAnchor];
        const targetAnchorPos = this.getAnchorPositions(edge.target)[edge.targetAnchor];

        const force = targetAnchorPos.subtract(sourceAnchorPos);
        const displacement = distance - this.edgeLength;
        const normalizedForce = force.normalize();
        const springForce = normalizedForce.multiply(this.edgeSpringConstant * displacement);

        if (!edge.source.anchored) {
            edge.source.velocity = edge.source.velocity.add(springForce.divide(this.vertexMass));
        }
        if (!edge.target.anchored) {
            edge.target.velocity = edge.target.velocity.subtract(springForce.divide(this.vertexMass));
        }
    }

    private getAnchorPositions(vertex: SimVertex): Record<"top" | "bottom" | "left" | "right", Vector2D> {
        const { position, width, height } = vertex;
        return {
            top: new Vector2D(position.x + width / 2, position.y),
            bottom: new Vector2D(position.x + width / 2, position.y + height),
            left: new Vector2D(position.x, position.y + height / 2),
            right: new Vector2D(position.x + width, position.y + height / 2)
        };
    }

    private findOptimalAnchors(source: SimVertex, target: SimVertex): { sourceAnchor: "top" | "bottom" | "left" | "right", targetAnchor: "top" | "bottom" | "left" | "right", distance: number } {
        const sourceAnchors = this.getAnchorPositions(source);
        const targetAnchors = this.getAnchorPositions(target);

        let minDistance = Infinity;
        let optimalSourceAnchor: "top" | "bottom" | "left" | "right" = "top";
        let optimalTargetAnchor: "top" | "bottom" | "left" | "right" = "top";

        for (const [sourceAnchor, sourcePos] of Object.entries(sourceAnchors)) {
            for (const [targetAnchor, targetPos] of Object.entries(targetAnchors)) {
                const distance = Vector2D.distance(sourcePos, targetPos);
                if (distance < minDistance) {
                    minDistance = distance;
                    optimalSourceAnchor = sourceAnchor as "top" | "bottom" | "left" | "right";
                    optimalTargetAnchor = targetAnchor as "top" | "bottom" | "left" | "right";
                }
            }
        }

        return { sourceAnchor: optimalSourceAnchor, targetAnchor: optimalTargetAnchor, distance: minDistance };
    }

    private areRelatedByAncestry(vertex1: SimVertex, vertex2: SimVertex): boolean {
        return (
            (vertex1.type === 'group' && this.isAncestor(vertex1 as SimGroup, vertex2)) ||
            (vertex2.type === 'group' && this.isAncestor(vertex2 as SimGroup, vertex1))
        );
    }

    private isAncestor(group: SimGroup, vertex: SimVertex): boolean {
        let current: SimVertex | null = vertex;
        while (current && current.directParent) {
            if (current.directParent === group) {
                return true;
            }
            current = current.directParent;
        }
        return false;
    }

    applyRepulsionForce(vertex1: SimVertex, vertex2: SimVertex) {
        // Skip repulsion if one vertex is an ancestor of the other
        if (
            (vertex1.type === 'group' && this.isAncestor(vertex1 as SimGroup, vertex2)) ||
            (vertex2.type === 'group' && this.isAncestor(vertex2 as SimGroup, vertex1))
        ) {
            return;
        }

        // Calculate the vector between the centers of the two rectangles
        const center1 = vertex1.position.add(new Vector2D(vertex1.width / 2, vertex1.height / 2));
        const center2 = vertex2.position.add(new Vector2D(vertex2.width / 2, vertex2.height / 2));
        const centerDiff = center2.subtract(center1);

        // Calculate the distance between borders (can be negative if overlapping)
        const dx = Math.abs(centerDiff.x) - (vertex1.width + vertex2.width) / 2;
        const dy = Math.abs(centerDiff.y) - (vertex1.height + vertex2.height) / 2;
        const borderDistance = Math.max(dx, dy);

        // Always apply force, but increase it significantly for overlaps
        const distance = Math.max(borderDistance, 1); // Prevent division by zero
        const overlapFactor = borderDistance < 0 ? this.overlapRepulsionFactor : 1;

        const force = centerDiff.normalize();
        const repulsionForce = force.multiply(this.repulsionStrength * overlapFactor / (distance * distance));

        if (!vertex1.anchored) {
            vertex1.velocity = vertex1.velocity.subtract(repulsionForce.divide(this.vertexMass));
        }
        if (!vertex2.anchored) {
            vertex2.velocity = vertex2.velocity.add(repulsionForce.divide(this.vertexMass));
        }
    }

    applyGravity(vertex: SimVertex) {
        if (!vertex.noGravity && !vertex.anchored) {
            // Apply normal downward gravity
            vertex.velocity = vertex.velocity.add(this.gravity);
        }

        // Apply sideways gravity for non-origin root nodes
        if (this.rootNodes.has(vertex.id) && vertex !== this.originRootNode) {
            const sidewaysGravity = new Vector2D(-vertex.position.x * this.sidewaysGravityStrength, 0);
            vertex.velocity = vertex.velocity.add(sidewaysGravity);
        }
    }

    updatePositions() {
        for (const vertex of this.canvas.vertices) {
            if (vertex.anchored) continue; // Skip fully anchored vertices

            // Apply existing damping to velocity
            vertex.velocity = vertex.velocity.multiply(this.damping);

            // Limit velocity to maxVelocity
            if (vertex.velocity.magnitude() > this.maxVelocity) {
                vertex.velocity = vertex.velocity.normalize().multiply(this.maxVelocity);
            }

            let newPosition = vertex.position.add(vertex.velocity);

            // If vertically anchored, only allow horizontal movement
            if (vertex.verticallyAnchored) {
                newPosition = new Vector2D(newPosition.x, vertex.position.y);
            }

            // Check for collisions with other vertices
            let collision = false;
            for (const otherVertex of this.canvas.vertices) {
                if (vertex !== otherVertex && this.rectanglesOverlap(
                    { ...vertex, position: newPosition },
                    otherVertex
                )) {
                    collision = true;
                    break;
                }
            }

            // If no collision, update the position
            if (!collision) {
                vertex.position = newPosition;
            } else {
                // If collision occurs, reduce velocity and try a smaller move
                vertex.velocity = vertex.velocity.multiply(0.5);
                let adjustedPosition = vertex.position.add(vertex.velocity);
                if (vertex.verticallyAnchored) {
                    adjustedPosition = new Vector2D(adjustedPosition.x, vertex.position.y);
                }
                vertex.position = adjustedPosition;
            }
        }
    }

    updateAllGroups() {
        const groups = this.canvas.vertices.filter(v => v.type === 'group') as SimGroup[];
        for (const group of groups) {
            this.updateGroupBoundaries(group);
        }
    }

    updateGroupBoundaries(group: SimGroup) {
        const boundaries = this.calculateGroupBoundaries(group.children);
        const padding = this.groupPadding;

        group.width = boundaries.right - boundaries.left + 2 * padding;
        group.height = boundaries.bottom - boundaries.top + 2 * padding;
        group.position = new Vector2D(boundaries.left - padding, boundaries.top - padding);
    }

    rectanglesOverlap(r1: SimVertex, r2: SimVertex): boolean {
        return (
            r1.position.x < r2.position.x + r2.width &&
            r1.position.x + r1.width > r2.position.x &&
            r1.position.y < r2.position.y + r2.height &&
            r1.position.y + r1.height > r2.position.y
        );
    }
}