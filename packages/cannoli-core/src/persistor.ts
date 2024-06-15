/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { AllVerifiedCannoliCanvasNodeData, VerifiedCannoliCanvasData, VerifiedCannoliCanvasEdgeData } from "./models/graph";

export const hexColorSchema = z.custom<`#${string}`>(v => {
	return /^#[0-9a-fA-F]{6}$/.test(v);
});

export type HexColor = z.infer<typeof hexColorSchema>;

export const canvasColorSchema = z.union([z.literal("1"), z.literal("2"), z.literal("3"), z.literal("4"), z.literal("5"), z.literal("6"), hexColorSchema]);

export type CanvasColor = z.infer<typeof canvasColorSchema>;

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

export const canvasLinkDataSchema = canvasNodeDataSchema.merge(z.object({
	type: z.literal('link'),
	url: z.string(),
}));

export type CanvasLinkData = z.infer<typeof canvasLinkDataSchema>;

/** The background image rendering style */
export type BackgroundStyle = 'cover' | 'ratio' | 'repeat';

export const canvasGroupDataSchema = canvasNodeDataSchema.merge(z.object({
	type: z.literal('group'),
	label: z.string().optional(),
	background: z.string().optional(),
	backgroundStyle: z.union([z.literal('cover'), z.literal('ratio'), z.literal('repeat')]).optional(),
}));

export type CanvasGroupData = z.infer<typeof canvasGroupDataSchema>;

export const nodeSideSchema = z.union([z.literal('top'), z.literal('right'), z.literal('bottom'), z.literal('left')]);

export type NodeSide = z.infer<typeof nodeSideSchema>;

export const edgeEndSchema = z.union([z.literal('none'), z.literal('arrow')]);

export type EdgeEnd = z.infer<typeof edgeEndSchema>;

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

export interface Persistor {
	start(canvasData: VerifiedCannoliCanvasData): Promise<void>;
	editNode(newNode: AllVerifiedCannoliCanvasNodeData): Promise<void>;
	editEdge(newEdge: VerifiedCannoliCanvasEdgeData): Promise<void>;
	addError(nodeId: string, message: string): Promise<void>;
	addWarning(nodeId: string, message: string): Promise<void>;
	editOriginalParallelGroupLabel(originalGroupId: string, label: string): Promise<void>;
}


