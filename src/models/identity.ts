import type { ProvideEdge } from "./edge";
import type { CannoliObject } from "./object";

const provideEdgeTypes = [
	"chat",
	"system-message",
	"list",
	"function",
	"list-item",
	"select",
	"branch",
	"category",
	"vault",
	"single-variable",
];

export function isProvideEdge(edge: CannoliObject): edge is ProvideEdge {
	return provideEdgeTypes.includes(edge.type);
}
