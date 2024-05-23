/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CanvasData {
    nodes: AllCanvasNodeData[];
    edges: CanvasEdgeData[];
    settings?: Record<string, unknown>;
    args?: Record<string, string>;
}

export type CanvasColor =
    | "1" // red
    | "2" // orange
    | "3" // yellow
    | "4" // green
    | "5" // cyan
    | "6" // purple
    | HexColor; // Allow any hex color

export type HexColor = `#${string}`;


export interface CanvasNodeData {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: CanvasColor;
    text?: string;
    type: string;
    // Support arbitrary keys for forward compatibility
    [key: string]: any;
}

export type AllCanvasNodeData = CanvasFileData | CanvasTextData | CanvasLinkData | CanvasGroupData;

/** A node that is a file, where the file is located somewhere in the vault. */
export interface CanvasFileData extends CanvasNodeData {
    type: 'file';
    file: string;
    /** An optional subpath which links to a heading or a block. Always starts with a `#`. */
    subpath?: string;
}

/** A node that is plaintext. */
export interface CanvasTextData extends CanvasNodeData {
    type: 'text';
    text: string;
}

/** A node that is an external resource. */
export interface CanvasLinkData extends CanvasNodeData {
    type: 'link';
    url: string;
}

/** The background image rendering style */
export type BackgroundStyle = 'cover' | 'ratio' | 'repeat';

/** A node that represents a group. */
export interface CanvasGroupData extends CanvasNodeData {
    type: 'group';
    /** Optional label to display on top of the group. */
    label?: string;
    /** Optional background image, stores the path to the image file in the vault. */
    background?: string;
    /** Optional background image rendering style; defaults to 'cover'. */
    backgroundStyle?: BackgroundStyle;
}

/** The side of the node that a connection is connected to */
export type NodeSide = 'top' | 'right' | 'bottom' | 'left';

/** What to display at the end of an edge */
export type EdgeEnd = 'none' | 'arrow';

/** An edge */
export interface CanvasEdgeData {
    /** The unique ID for this edge */
    id: string;
    /** The node ID and side where this edge starts */
    fromNode: string;
    fromSide: NodeSide;
    /** The starting edge end; defaults to 'none' */
    fromEnd?: EdgeEnd;
    /** The node ID and side where this edge ends */
    toNode: string;
    toSide: NodeSide;
    /** The ending edge end; defaults to 'arrow' */
    toEnd?: EdgeEnd;
    /** The color of this edge */
    color?: CanvasColor;
    /** The text label of this edge, if available */
    label?: string;

    // Support arbitrary keys for forward compatibility
    [key: string]: any;
}




// interface TFile {
//     vault: {
//         cachedRead(file: TFile): Promise<string>;
//         read(file: TFile): Promise<string>;
//         process(file: TFile, onEdit: (data: string) => string): Promise<void>;
//     };
// }

export interface Canvas {
    canvasData: CanvasData;
    subCanvasGroupId?: string;
    editQueue: Promise<unknown>;

    enqueueChangeNodeColor(nodeId: string, newColor?: CanvasColor): Promise<void>;
    enqueueAddErrorNode(nodeId: string, message: string): Promise<void>;
    enqueueAddWarningNode(nodeId: string, message: string): Promise<void>;
    enqueueChangeNodeText(nodeId: string, newText: string): Promise<void>;
    enqueueRemoveAllErrorNodes(): Promise<void>;


}


