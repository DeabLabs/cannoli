import { HumanMessage } from "@langchain/core/messages"
import { GenericFunctionCall, LangchainMessages } from "./providers"

export const messagesWithFnCallPrompts = ({ convertedMessages, fn, function_call }: {
	convertedMessages: LangchainMessages,
	fn: GenericFunctionCall,
	function_call: { name: string }
}) => {
	if (!(typeof fn.parameters.properties === "object") || !fn.parameters.properties) {
		console.warn("Function definition is malformed. Skipping")
		return convertedMessages
	}

	switch (fn.name) {
		case "choice": {
			return [...convertedMessages, new HumanMessage({
				content:
					`
Respond with the choice you would like to make.
Your output format should strictly adhere to JSON formatting. Here is a type definition of the expected JSON format:
---
Record<"choice", string>
---

example input:
- A
- B
- C

example output:
{"choice": "B"}

input:
${
						// TODO: actually validate fns
						// @ts-expect-error
						fn.parameters.properties.choice.enum.map((choice: string) => `- ${choice}`).join("\n")
						}
output:
`.trimStart()
			})]
		}
		case "form": {
			return [...convertedMessages, new HumanMessage({
				content: `
Your task is to generate a value(s) given one or more variable names.
The format of variables is as follows:
- variable_name_1
- variable_name_2
- variable_name_3

For example, if the variable is "- breakfast",
then the variable name is "breakfast".

Your output format should strictly adhere to JSON formatting. Here is a type definition of the expected JSON format:
---
Record<string, string>
---
Do not return anything other then JSON.
The provided type definition should be respected and only valid JSON should be returned.
JSON string values should satisfy the objective.

The necessary information to complete the objective is between ---.
---
Objective: "Provide the requested information for each key."
Variables:
${Object.keys(fn.parameters.properties).map(p => `- ${p}`).join("\n")}
---

Below, return your JSON output.

"""
`.trim()
			})]
		}
		case "note_select": {
			return [...convertedMessages, new HumanMessage({
				content:
					`
Respond with the note you would like to select.
Your output format should strictly adhere to JSON formatting. Here is a type definition of the expected JSON format:
---
Record<"note", string>
---

example input:
- Note A
- Note B
- Note C

example output:
{"note": "Note B"}

input:
${
						// TODO: actually validate fns
						// @ts-expect-error
						fn.parameters.properties.note.enum.map((note_name: string) => `- ${note_name}`).join("\n")
						}
output:
`.trimStart()
			})]
		}
		default: {
			console.warn("Function call prompt not implemented for function: ", fn.name)
			return convertedMessages
		}
	}
}

