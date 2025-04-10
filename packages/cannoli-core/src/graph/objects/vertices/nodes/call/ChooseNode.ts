import { EdgeType } from "src/graph";
import { CannoliEdge } from "src/graph/objects/CannoliEdge";
import {
	GenericCompletionResponse,
	GenericFunctionCall,
	GenericCompletionParams,
} from "src/providers";
import { CallNode } from "../CallNode";

export class ChooseNode extends CallNode {
	getFunctions(messages: GenericCompletionResponse[]): GenericFunctionCall[] {
		const choices = this.getBranchChoices();

		// Create choice function
		const choiceFunc = this.run.createChoiceFunction(choices);

		return [choiceFunc];
	}

	loadOutgoingEdges(content: string, request: GenericCompletionParams): void {
		const messages = request.messages;

		// Get the chosen variable from the last message
		const lastMessage = messages[messages.length - 1];
		const choiceFunctionArgs =
			"function_call" in lastMessage &&
			lastMessage.function_call?.arguments;

		if (!choiceFunctionArgs) {
			this.error(`Choice function call has no arguments.`);
			return;
		}

		const parsedVariable = JSON.parse(choiceFunctionArgs);

		// Reject all unselected options
		this.rejectUnselectedOptions(parsedVariable.choice);

		super.loadOutgoingEdges(choiceFunctionArgs, request);
	}

	rejectUnselectedOptions(choice: string) {
		// Call reject on any outgoing edges that aren't the selected one
		for (const edge of this.outgoingEdges) {
			const edgeObject = this.graph[edge];
			if (edgeObject.type === EdgeType.Choice) {
				const branchEdge = edgeObject as CannoliEdge;
				if (branchEdge.text !== choice) {
					branchEdge.reject();
				}
			}
		}
	}

	getBranchChoices(): string[] {
		// Get the unique names of all outgoing choice edges
		const outgoingChoiceEdges = this.getOutgoingEdges().filter((edge) => {
			return edge.type === EdgeType.Choice;
		});

		const uniqueNames = new Set<string>();

		for (const edge of outgoingChoiceEdges) {
			const edgeObject = this.graph[edge.id];
			if (!(edgeObject instanceof CannoliEdge)) {
				throw new Error(
					`Error on object ${edgeObject.id}: object is not a branch edge.`,
				);
			}

			const name = edgeObject.text;

			if (name) {
				uniqueNames.add(name);
			}
		}

		return Array.from(uniqueNames);
	}

	logDetails(): string {
		return super.logDetails() + `Subtype: Choice\n`;
	}

	validate() {
		super.validate();

		// If there are no branch edges, error
		if (
			!this.getOutgoingEdges().some(
				(edge) => edge.type === EdgeType.Choice,
			)
		) {
			this.error(
				`Choice nodes must have at least one outgoing choice edge.`,
			);
		}
	}
}
