import { EdgeModifier, EdgeType } from "src/graph";
import { CannoliEdge } from "src/graph/objects/CannoliEdge";
import {
  GenericCompletionResponse,
  GenericFunctionCall,
  GenericCompletionParams,
} from "src/providers";
import { CallNode } from "../CallNode";

export class FormNode extends CallNode {
  getFunctions(messages: GenericCompletionResponse[]): GenericFunctionCall[] {
    // Get the names of the fields
    const fields = this.getFields();

    const fieldsWithNotes: { name: string; noteNames?: string[] }[] = [];

    // If one of the outgoing edges has a vault modifier of type "note", get the note names and pass it into that field
    const noteEdges = this.getOutgoingEdges().filter(
      (edge) => edge.edgeModifier === EdgeModifier.Note,
    );

    for (const item of fields) {
      // If the item matches the name of one of the note edges
      if (noteEdges.find((edge) => edge.text === item)) {
        // Get the note names
        const noteNames = this.findNoteReferencesInMessages(messages);

        fieldsWithNotes.push({ name: item, noteNames: noteNames });
      } else {
        fieldsWithNotes.push({ name: item });
      }
    }

    // Generate the form function
    const formFunc = this.run.createFormFunction(fieldsWithNotes);

    return [formFunc];
  }

  getFields(): string[] {
    // Get the unique names of all outgoing field edges
    const outgoingFieldEdges = this.getOutgoingEdges().filter((edge) => {
      return edge.type === EdgeType.Field;
    });

    const uniqueNames = new Set<string>();

    for (const edge of outgoingFieldEdges) {
      const edgeObject = this.graph[edge.id];
      if (!(edgeObject instanceof CannoliEdge)) {
        throw new Error(
          `Error on object ${edgeObject.id}: object is not a field edge.`,
        );
      }

      const name = edgeObject.text;

      if (name) {
        uniqueNames.add(name);
      }
    }

    return Array.from(uniqueNames);
  }

  loadOutgoingEdges(content: string, request: GenericCompletionParams): void {
    const messages = request.messages;

    // Get the fields from the last message
    const lastMessage = messages[messages.length - 1];
    const formFunctionArgs =
      "function_call" in lastMessage && lastMessage.function_call?.arguments;

    if (!formFunctionArgs) {
      this.error(`Form function call has no arguments.`);
      return;
    }

    // Parse the fields from the arguments
    const fields = JSON.parse(formFunctionArgs);

    for (const edge of this.outgoingEdges) {
      const edgeObject = this.graph[edge];
      if (edgeObject instanceof CannoliEdge) {
        // If the edge is a field edge, load it with the content of the corresponding field
        if (
          edgeObject instanceof CannoliEdge &&
          edgeObject.type === EdgeType.Field
        ) {
          const name = edgeObject.text;

          if (name) {
            const fieldContent = fields[name];

            if (fieldContent) {
              // If it has a note modifier, add double brackets around the note name
              if (edgeObject.edgeModifier === EdgeModifier.Note) {
                edgeObject.load({
                  content: `[[${fieldContent}]]`,
                  request: request,
                });
              } else {
                edgeObject.load({
                  content: fieldContent,
                  request: request,
                });
              }
            }
          }
        } else {
          edgeObject.load({
            content: formFunctionArgs,
            request: request,
          });
        }
      }
    }
  }

  logDetails(): string {
    return super.logDetails() + `Subtype: Form\n`;
  }
}
