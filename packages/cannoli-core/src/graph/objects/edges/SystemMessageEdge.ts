import { GenericCompletionParams } from "src/providers";
import { CannoliEdge } from "../CannoliEdge";

export class SystemMessageEdge extends CannoliEdge {
	load({
		content,
		request,
	}: {
		content?: string | Record<string, string>;
		request?: GenericCompletionParams;
	}): void {
		if (content) {
			this.setMessages([
				{
					role: "system",
					content: content as string,
				},
			]);
		}
	}
}
