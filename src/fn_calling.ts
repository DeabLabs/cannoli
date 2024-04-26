import { HumanMessage } from "@langchain/core/messages"
import { GenericFunctionCall, LangchainMessages } from "src/providers"

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
Respond only with json stringified object with the key "choice" and the value of the choice you would like to make.
If you fail to follow these instructions, the user will not understand your response, and will be stuck waiting for infinity.

example input:
- A
- B
- C

example output:
B

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
		default: {
			console.warn("Function call prompt not implemented for function: ", fn.name)
			return convertedMessages
		}
	}
}

