/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";

// export interface CanvasData {
//     nodes: AllCanvasNodeData[];
//     edges: CanvasEdgeData[];
//     settings?: Record<string, unknown>;
//     args?: Record<string, string>;
// }



// export type CanvasColor =
//     | "1" // red
//     | "2" // orange
//     | "3" // yellow
//     | "4" // green
//     | "5" // cyan
//     | "6" // purple
//     | HexColor; // Allow any hex color


// export type HexColor = `#${string}`;

export const hexColorSchema = z.custom<`#${string}`>(v => {
    return /^#[0-9a-fA-F]{6}$/.test(v);
});

export type HexColor = z.infer<typeof hexColorSchema>;

export const canvasColorSchema = z.union([z.literal("1"), z.literal("2"), z.literal("3"), z.literal("4"), z.literal("5"), z.literal("6"), hexColorSchema]);

export type CanvasColor = z.infer<typeof canvasColorSchema>;


// export interface CanvasNodeData {
//     id: string;
//     x: number;
//     y: number;
//     width: number;
//     height: number;
//     color?: CanvasColor;
//     text?: string;
//     type: string;
//     // Support arbitrary keys for forward compatibility
//     [key: string]: any;
// }

const canvasNodeDataSchema = z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    color: z.string().optional(),
    text: z.string().optional(),
    type: z.string(),
}).passthrough();

export type CanvasNodeData = z.infer<typeof canvasNodeDataSchema> & {
    [key: string]: any;
};

// export type AllCanvasNodeData = CanvasFileData | CanvasTextData | CanvasLinkData | CanvasGroupData;


// /** A node that is a file, where the file is located somewhere in the vault. */
// export interface CanvasFileData extends CanvasNodeData {
//     type: 'file';
//     file: string;
//     /** An optional subpath which links to a heading or a block. Always starts with a `#`. */
//     subpath?: string;
// }

export const canvasFileDataSchema = canvasNodeDataSchema.merge(z.object({
    type: z.literal('file'),
    file: z.string(),
    subpath: z.string().optional(),
}));

export type CanvasFileData = z.infer<typeof canvasFileDataSchema>;

const canvasTextDataSchema = canvasNodeDataSchema.merge(z.object({
    type: z.literal('text'),
    text: z.string(),
}));

export type CanvasTextData = z.infer<typeof canvasTextDataSchema>;


// /** A node that is plaintext. */
// export interface CanvasTextData extends CanvasNodeData {
//     type: 'text';
//     text: string;
// }

// /** A node that is an external resource. */
// export interface CanvasLinkData extends CanvasNodeData {
//     type: 'link';
//     url: string;
// }

export const canvasLinkDataSchema = canvasNodeDataSchema.merge(z.object({
    type: z.literal('link'),
    url: z.string(),
}));

export type CanvasLinkData = z.infer<typeof canvasLinkDataSchema>;

/** The background image rendering style */
export type BackgroundStyle = 'cover' | 'ratio' | 'repeat';

/** A node that represents a group. */
// export interface CanvasGroupData extends CanvasNodeData {
//     type: 'group';
//     /** Optional label to display on top of the group. */
//     label?: string;
//     /** Optional background image, stores the path to the image file in the vault. */
//     background?: string;
//     /** Optional background image rendering style; defaults to 'cover'. */
//     backgroundStyle?: BackgroundStyle;
// }

export const canvasGroupDataSchema = canvasNodeDataSchema.merge(z.object({
    type: z.literal('group'),
    label: z.string().optional(),
    background: z.string().optional(),
    backgroundStyle: z.enum(['cover', 'ratio', 'repeat']).optional(),
}));

export type CanvasGroupData = z.infer<typeof canvasGroupDataSchema>;

/** The side of the node that a connection is connected to */
// export type NodeSide = 'top' | 'right' | 'bottom' | 'left';

export const nodeSideSchema = z.enum(['top', 'right', 'bottom', 'left']);

export type NodeSide = z.infer<typeof nodeSideSchema>;

/** What to display at the end of an edge */
// export type EdgeEnd = 'none' | 'arrow';

export const edgeEndSchema = z.enum(['none', 'arrow']);

export type EdgeEnd = z.infer<typeof edgeEndSchema>;

/** An edge */
// export interface CanvasEdgeData {
//     /** The unique ID for this edge */
//     id: string;
//     /** The node ID and side where this edge starts */
//     fromNode: string;
//     fromSide: NodeSide;
//     /** The starting edge end; defaults to 'none' */
//     fromEnd?: EdgeEnd;
//     /** The node ID and side where this edge ends */
//     toNode: string;
//     toSide: NodeSide;
//     /** The ending edge end; defaults to 'arrow' */
//     toEnd?: EdgeEnd;
//     /** The color of this edge */
//     color?: CanvasColor;
//     /** The text label of this edge, if available */
//     label?: string;

//     // Support arbitrary keys for forward compatibility
//     [key: string]: any;
// }

export const allCanvasNodeDataSchema = z.union([canvasFileDataSchema, canvasTextDataSchema, canvasLinkDataSchema, canvasGroupDataSchema]);

export type AllCanvasNodeData = z.infer<typeof allCanvasNodeDataSchema>;

export const canvasEdgeDataSchema = z.object({
    id: z.string(),
    fromNode: z.string(),
    fromSide: nodeSideSchema,
    fromEnd: edgeEndSchema.optional(),
    toNode: z.string(),
    toSide: nodeSideSchema,
    toEnd: edgeEndSchema.optional(),
    color: z.string().optional(),
    label: z.string().optional(),
}).passthrough();

export type CanvasEdgeData = z.infer<typeof canvasEdgeDataSchema> & {
    [key: string]: any;
};

export const canvasDataSchema = z.object({
    nodes: z.array(allCanvasNodeDataSchema),
    edges: z.array(canvasEdgeDataSchema),
    settings: z.record(z.any()).optional(),
    args: z.record(z.string()).optional(),
});

export type CanvasData = z.infer<typeof canvasDataSchema>;


// interface TFile {
//     vault: {
//         cachedRead(file: TFile): Promise<string>;
//         read(file: TFile): Promise<string>;
//         process(file: TFile, onEdit: (data: string) => string): Promise<void>;
//     };
// }

export interface Canvas {
    enqueueChangeNodeColor(nodeId: string, newColor?: CanvasColor, isMock?: boolean): Promise<void>;
    enqueueAddErrorNode(nodeId: string, message: string, isMock?: boolean): Promise<void>;
    enqueueAddWarningNode(nodeId: string, message: string, isMock?: boolean): Promise<void>;
    enqueueChangeNodeText(nodeId: string, newText: string, isMock?: boolean): Promise<void>;
    enqueueRemoveAllErrorNodes(isMock?: boolean): Promise<void>;
}


