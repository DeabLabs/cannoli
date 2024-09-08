import Anthropic from "@anthropic-ai/sdk";
import { MessageParam, ToolResultBlockParam, ToolUseBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { Tool } from "@anthropic-ai/sdk/resources/messages";
import { cannoliSchemaPrompt } from "./prompt";
import { z } from "zod";
import { SimCanvas } from "./layoutSim";

export type CannoliRecipe = {
    description: string;
    graph: (RecipeVertex | RecipeGroup)[];
    globalVariables: RecipeGlobalVariable[];
};

export type RecipeVertex = {
    name: string;
    kind: 'node' | 'group';
    type: RecipeNodeType | RecipeGroupType;
    incomingArrows: RecipeArrow[];
};

export type RecipeNode = RecipeVertex & {
    kind: 'node';
    type: RecipeNodeType;
    content: string;
};

export type RecipeNodeType =
    'ai' |
    'content' |
    'formatter' |
    'reference' |
    'action';

const nodeTypes = ['ai', 'content', 'formatter', 'reference', 'action'] as const;

export type RecipeGroup = RecipeVertex & {
    kind: 'group';
    type: RecipeGroupType;
    label?: string;
    members: (RecipeNode | RecipeGroup)[];
};

export type RecipeGroupType =
    'basic' |
    'loop' |
    'parallel';

const groupTypes = ['basic', 'loop', 'parallel'] as const;

export type RecipeArrow = {
    source: string;
    type: RecipeArrowType;
    label?: string;
};

export type RecipeArrowType =
    'basic' |
    'variable' |
    'choice' |
    'field' |
    'list' |
    'config';

const arrowTypes = ['basic', 'variable', 'choice', 'field', 'list', 'config'] as const;

export type RecipeGlobalVariable = {
    name: string;
    initialValue: string;
};

export type AddNodeInput = {
    name: string;
    type: RecipeNodeType;
    group?: string;
};

export type SetNodeContentInput = {
    content: string;
};

export type AddArrowInput = {
    source: string;
    target: string;
};

export type SetArrowTypeAndLabelInput = {
    type: RecipeArrowType;
    label?: string;
};

export type AddGroupInput = {
    name: string;
    type: RecipeGroupType;
    label?: string;
};

// Define Zod schemas for input validation
const AddNodeInputSchema = z.object({
    name: z.string(),
    type: z.enum(nodeTypes),
    group: z.string().optional(),
});

const SetNodeContentInputSchema = z.object({
    content: z.string(),
});

const AddArrowInputSchema = z.object({
    source: z.string(),
    target: z.string(),
});

const SetArrowTypeAndLabelInputSchema = z.object({
    type: z.enum(arrowTypes),
    label: z.string().optional(),
});

const AddGroupInputSchema = z.object({
    name: z.string(),
    type: z.enum(groupTypes),
    label: z.string().optional(),
});

export type HandleToolUseResult = {
    result: ToolResultBlockParam,
    tool: Tool | undefined,
    activeVertex: RecipeVertex | undefined,
    activeArrow: RecipeArrow | undefined,
}

export class Generator {
    messages: MessageParam[] = [];
    anthropic: Anthropic;
    recipe: Recipe;
    prompt: string;
    apiKey: string;
    isComplete: boolean;

    messageLimit = 100;

    constructor(prompt: string, apiKey: string) {
        this.prompt = prompt;
        this.apiKey = apiKey;

        this.anthropic = new Anthropic({
            apiKey: apiKey,
            dangerouslyAllowBrowser: true
        });

        this.recipe = new Recipe({
            description: "",
            graph: [],
            globalVariables: []
        });
    }

    async generateCannoli() {
        this.isComplete = false;

        let description: string;
        const initialMessage = this.getInitialMessage();

        try {
            const initialResponse = await this.getResponse(initialMessage);
            if (initialResponse.content[0].type === 'text') {
                description = initialResponse.content[0].text;
                this.recipe.setDescription(description);
                this.messages.push(initialMessage);
                this.messages.push({
                    role: "assistant",
                    content: initialResponse.content
                });
                console.log("Description: ", description);
            } else {
                throw new Error(`Initial response is not text: ${initialResponse}`);
            }
        } catch (error) {
            throw new Error(`Failed to generate initial response: ${error}`);
        }

        let tools = this.getStandardTools();
        let toolToUse: string | undefined;
        let toolResult: ToolResultBlockParam | undefined;
        let activeVertex: RecipeVertex | undefined;
        let activeArrow: RecipeArrow | undefined;

        while (!this.isComplete && this.messages.length < this.messageLimit) {
            let message: MessageParam;

            if (toolResult) {
                message = {
                    role: "user",
                    content: [
                        toolResult
                    ]
                }
            } else {
                message = {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Please continue creating the cannoli. Only use one tool at a time."
                        }
                    ]
                }
            }

            try {
                console.log("Message: ", message);
                const response = await this.getResponse(message, tools, toolToUse);
                console.log("Response: ", response.content);
                this.messages.push(message);
                this.messages.push({
                    role: "assistant",
                    content: response.content
                });

                const toolUse = response.content.find((message) => message.type === 'tool_use');

                if (toolUse) {
                    const toolUseResult = this.handleToolUse(toolUse, activeVertex, activeArrow);
                    activeVertex = toolUseResult.activeVertex;
                    activeArrow = toolUseResult.activeArrow;

                    if (toolUseResult.tool) {
                        toolToUse = toolUseResult.tool.name;
                        tools = [toolUseResult.tool];
                        toolResult = toolUseResult.result;
                    } else {
                        toolResult = toolUseResult.result;
                        tools = this.getStandardTools();
                        toolToUse = undefined;
                    }
                }
            } catch (error) {
                throw new Error(`Failed to generate response: ${error}`);
            }

            console.log("Recipe: ", JSON.stringify(this.recipe.recipe, null, 2));
        }

        return this.recipe;
    }

    getStandardTools(): Tool[] {
        return [this.getAddNodeTool(), this.getAddGroupTool(), this.getAddArrowTool(), this.getFinishCannoliTool()];
    }

    getInitialMessage(): MessageParam {
        return {
            role: 'user',
            content: `Please create a cannoli for the following prompt: ${this.prompt}
        
        Below is a description of the cannoli spec:
        \`\`\`
        ${cannoliSchemaPrompt}
        \`\`\`

        To start, respond with a brief description of the cannoli you'll be creating, explaining the purpose, function, and flow of the cannoli.
        
        Nothing but your description should be in your response.`
        };
    }

    handleToolUse(toolUse: ToolUseBlockParam, activeVertex?: RecipeVertex, activeArrow?: RecipeArrow): HandleToolUseResult {
        const { id, name, input } = toolUse;

        switch (name) {
            case "addNode": {
                const result = AddNodeInputSchema.safeParse(input);
                if (!result.success) {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: `Invalid input: ${result.error.message} `
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    };
                }
                const addNodeInput = result.data;
                const newNode = this.recipe.addNode(addNodeInput.name, addNodeInput.type, addNodeInput.group);
                if (typeof newNode === 'string') {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: newNode
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    }
                } else {
                    return {
                        tool: this.getSetNodeContentTool(newNode),
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: "Node added successfully, now please set the content of the node."
                        },
                        activeVertex: newNode,
                        activeArrow: undefined
                    }
                }
            }

            case "setNodeContent": {
                if (!activeVertex || activeVertex.kind !== 'node') {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: "You can't set the content of a non-node"
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    }
                }

                const result = SetNodeContentInputSchema.safeParse(input);
                if (!result.success) {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: `Invalid input: ${result.error.message} `
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    }
                }
                const setNodeContentInput = result.data;
                this.recipe.setNodeContent(activeVertex as RecipeNode, setNodeContentInput.content);
                return {
                    result: this.getRecipeToolResult(id),
                    tool: undefined,
                    activeVertex: undefined,
                    activeArrow: undefined
                };
            }

            case "addArrow": {
                const result = AddArrowInputSchema.safeParse(input);
                if (!result.success) {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: `Invalid input: ${result.error.message} `
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    };
                }
                const addArrowInput = result.data;
                const newArrow = this.recipe.addArrow(addArrowInput.source, addArrowInput.target);
                if (typeof newArrow === 'string') {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: newArrow
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    }
                } else {
                    return {
                        tool: this.getSetArrowTypeAndLabelTool(newArrow.source, newArrow.target),
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: "Arrow added successfully, now please set the type and label of the arrow."
                        },
                        activeVertex: undefined,
                        activeArrow: newArrow.arrow
                    }
                }
            }

            case "setArrowTypeAndLabel": {
                if (!activeArrow) {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: "You can't set the type and label of a non-existent arrow"
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    }
                }

                const result = SetArrowTypeAndLabelInputSchema.safeParse(input);
                if (!result.success) {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: `Invalid input: ${result.error.message} `
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    };
                }
                const setArrowTypeAndLabelInput = result.data;
                const newArrow = this.recipe.setArrowTypeAndLabel(activeArrow as RecipeArrow, setArrowTypeAndLabelInput.type, setArrowTypeAndLabelInput.label);
                if (typeof newArrow === 'string') {
                    return {
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: newArrow
                        },
                        tool: undefined,
                        activeVertex: undefined,
                        activeArrow: undefined
                    }
                } else {
                    return {
                        tool: undefined,
                        result: this.getRecipeToolResult(id),
                        activeVertex: undefined,
                        activeArrow: undefined
                    }
                }
            }

            case "addGroup": {
                const result = AddGroupInputSchema.safeParse(input);
                if (!result.success) {
                    return {
                        tool: undefined,
                        result: {
                            type: "tool_result",
                            tool_use_id: id,
                            content: `Invalid input: ${result.error.message} `
                        },
                        activeVertex: undefined,
                        activeArrow: undefined
                    }
                } else {
                    const addGroupInput = result.data;
                    const newGroup = this.recipe.addGroup(addGroupInput.name, addGroupInput.type, addGroupInput.label);
                    if (typeof newGroup === 'string') {
                        return {
                            tool: undefined,
                            result: {
                                type: "tool_result",
                                tool_use_id: id,
                                content: newGroup
                            },
                            activeVertex: undefined,
                            activeArrow: undefined
                        }
                    } else {
                        return {
                            tool: undefined,
                            result: this.getRecipeToolResult(id),
                            activeVertex: undefined,
                            activeArrow: undefined
                        }
                    }
                }
            }

            case "completeCannoli": {
                this.isComplete = true;
                return {
                    tool: undefined,
                    result: this.getRecipeToolResult(id),
                    activeVertex: undefined,
                    activeArrow: undefined
                };
            }

            default:
                return {
                    tool: undefined,
                    result: {
                        type: "tool_result",
                        tool_use_id: id,
                        content: "Invalid tool"
                    },
                    activeVertex: undefined,
                    activeArrow: undefined
                };
        }
    }

    getRecipeToolResult(toolUseId: string): ToolResultBlockParam {
        return {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: `Change made successfully. Here is the current state of the cannoli:

\`\`\`json
${JSON.stringify(this.recipe.recipe, null, 2)}
\`\`\`

You can continue to add nodes, arrows, and groups to the cannoli, or you can call the \`completeCannoli\` tool to finish the cannoli.
`
        }
    }

    async getResponse(userMessage: MessageParam, tools?: Tool[], toolToUse?: string) {
        const request: Anthropic.Messages.MessageCreateParamsNonStreaming = {
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 8192,
            system: "You are a cannoli generator. You are given a prompt and a set of tools to use to generate a cannoli.",
            messages: this.messages.concat(userMessage),
            tools: tools,
            tool_choice: toolToUse ? { type: "tool", name: toolToUse } : undefined
        }

        console.log("Request: ", request);

        const response = await this.anthropic.messages.create(request);

        return response;
    }

    getAddNodeTool(): Tool {
        const nodeTypeExplainer = `
Node Types and Their Behavior:

        1. "ai": Use when you want to generate content or make decisions using an AI model.AI nodes can also continue conversations from previous AI nodes and respond to specific prompts or questions.

2. "content": Use for storing static text or data that doesn't need processing. Content nodes can be overwritten by other nodes, making them useful for storing intermediate results.

        3. "formatter": Use when you need to combine or format data from other nodes or variables.Formatters can inject references from other nodes, global variables, or notes, allowing for dynamic content creation.

4. "reference": Use to access or modify specific notes or global variables.Reference nodes can also be written to by other nodes, providing a way to update global state or external content.

5. "action": Use when you need to perform external actions like API calls or specific functions.Action nodes can make HTTP requests or call predefined functions, allowing for integration with external services or custom logic.
`;
        return {
            name: "addNode",
            description: `Add a node to the cannoli with a given name, type and optional group.`,
            input_schema: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "The name of the node. Think of this as a function name, it won't be visible to the user but it should be meaningful, and indicate what the node does.",
                    },
                    type: {
                        type: "string",
                        description: nodeTypeExplainer,
                        enum: nodeTypes,
                    },
                    group: {
                        type: "string",
                        description: "The name of the group that this node should be added to. Note that this will implicitly make the node members of any groups that are parents of this group.",
                    }
                },
                required: ["name", "type"],
            },
        };
    }

    getSetNodeContentTool(node: RecipeNode): Tool {
        return {
            name: "setNodeContent",
            description: `Set the content of a node.The node you'll be setting the content of is ${node.name}, and it's a ${node.type} node.`,
            input_schema: {
                type: "object",
                properties: {
                    content: {
                        type: "string",
                        description: "The content of the node",
                    }
                },
                required: ["content"],
            },
        };
    }

    getAddArrowTool(): Tool {
        return {
            name: "addArrow",
            description: "Add an arrow to the cannoli",
            input_schema: {
                type: "object",
                properties: {
                    source: {
                        type: "string",
                        description: "The name of the source node",
                    },
                    target: {
                        type: "string",
                        description: "The name of the target node",
                    }
                },
                required: ["source", "target"],
            },
        };
    }

    getSetArrowTypeAndLabelTool(source: RecipeVertex, target: RecipeVertex): Tool {
        const arrowTypeExplainer = `
        Arrow Types and Their Behavior:

        1. "basic": Use for simple data flow between nodes.Behavior varies based on source and target node types, making it versatile for many situations.
        
        2. "variable": Use when you need to pass labeled data between nodes.Variable arrows allow for more specific data referencing and can optionally carry conversation history from AI nodes.
        
        3. "choice": Use with AI nodes to create branching logic.Choice arrows let an AI node select one path from multiple options, enabling conditional flows in your cannoli.
        
        4. "field": Use with AI nodes to generate multiple categorized outputs.Similar to choice arrows, but allows the AI to fill in multiple fields instead of selecting just one.
        
        5. "list": Use to distribute items from a list to parallel group copies.List arrows are essential for parallel processing of data sets.
        
        6. "config": Use to set specific configuration options for AI nodes.Config arrows allow dynamic setting of AI provider, model, temperature, and token limits.
        `;

        return {
            name: "setArrowTypeAndLabel",
            description: `Set the type and label of an arrow.The arrow you'll be setting the type and label of is ${source.name} -> ${target.name}.`,
            input_schema: {
                type: "object",
                properties: {
                    type: {
                        type: "string",
                        description: "The type of the arrow. This, along with the source and target node types, determines the behavior of the arrow.\n\n" + arrowTypeExplainer,
                        enum: arrowTypes,
                    },
                    label: {
                        type: "string",
                        description: "The label of the arrow",
                    }
                },
                required: ["type"],
            },
        };
    }

    getAddGroupTool(): Tool {
        const groupTypeExplainer = `
Group Types and Their Behavior:

1. "basic": Use for organizational purposes to group related nodes together. The label can be any descriptive string.

2. "loop": Use to repeat execution of a group of nodes. The label must be a number indicating the number of iterations.

3. "parallel": Use to run the same set of nodes concurrently with different inputs. The label must be a number specifying the number of parallel executions.
`;

        return {
            name: "addGroup",
            description: `Add a group to the cannoli.\n\n${groupTypeExplainer}`,
            input_schema: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "The name of the group",
                    },
                    type: {
                        type: "string",
                        description: "The type of the group",
                        enum: groupTypes,
                    },
                    label: {
                        type: "string",
                        description: "The label of the group",
                    }
                },
                required: ["name", "type"],
            },
        };
    }

    getFinishCannoliTool(): Tool {
        return {
            name: "completeCannoli",
            description: "Call this function when you have no more changes to make to the cannoli.",
            input_schema: {
                type: "object",
                properties: {},
                required: [],
            },
        };
    }
}

class Recipe {
    recipe: CannoliRecipe;
    simCanvas: SimCanvas;

    constructor(recipe: CannoliRecipe) {
        this.recipe = recipe;
    }

    private getVertexByName(name: string): RecipeVertex | null {
        const findVertex = (items: (RecipeVertex | RecipeGroup)[]): RecipeVertex | null => {
            for (const item of items) {
                if (item.name === name) {
                    return item;
                }
                if (item.kind === 'group') {
                    const foundInGroup = findVertex((item as RecipeGroup).members);
                    if (foundInGroup) return foundInGroup;
                }
            }
            return null;
        };

        return findVertex(this.recipe.graph);
    }

    private getArrowByLabel(label: string): { arrow: RecipeArrow; toVertex: RecipeVertex } | null {
        const findArrow = (items: (RecipeVertex | RecipeGroup)[]): { arrow: RecipeArrow; toVertex: RecipeVertex } | null => {
            for (const item of items) {
                const foundArrow = item.incomingArrows.find(arrow => arrow.label === label);
                if (foundArrow) {
                    return { arrow: foundArrow, toVertex: item };
                }
                if (item.kind === 'group') {
                    const foundInGroup = findArrow((item as RecipeGroup).members);
                    if (foundInGroup) return foundInGroup;
                }
            }
            return null;
        };

        return findArrow(this.recipe.graph);
    }

    setDescription(description: string): void {
        this.recipe.description = description;
    }

    addNode(name: string, type: RecipeNodeType, group?: string): RecipeNode | string {
        const validNodeTypes: RecipeNodeType[] = ['ai', 'content', 'formatter', 'reference', 'action'];
        if (!validNodeTypes.includes(type)) {
            const errorMsg = `Invalid node type: ${type}`;
            console.error(errorMsg);
            return errorMsg;
        }

        if (this.getVertexByName(name)) {
            const errorMsg = `A vertex with name "${name}" already exists`;
            console.error(errorMsg);
            return errorMsg;
        }

        const newNode: RecipeNode = {
            name,
            kind: 'node',
            type,
            content: '',
            incomingArrows: []
        };

        if (group) {
            const groupVertex = this.getVertexByName(group);
            if (!groupVertex || groupVertex.kind !== 'group') {
                const errorMsg = `"${group}" is not a valid group`;
                console.error(errorMsg);
                return errorMsg;
            }
            (groupVertex as RecipeGroup).members.push(newNode);
        } else {
            this.recipe.graph.push(newNode);
        }

        return newNode;
    }

    setNodeContent(node: RecipeNode, content: string): void {
        node.content = content;
    }

    addArrow(sourceName: string, targetName: string): { arrow: RecipeArrow; source: RecipeVertex; target: RecipeVertex } | string {
        const sourceVertex = this.getVertexByName(sourceName);
        const targetVertex = this.getVertexByName(targetName);

        if (!sourceVertex) {
            const errorMsg = `Source vertex "${sourceName}" not found`;
            console.error(errorMsg);
            return errorMsg;
        }

        if (!targetVertex) {
            const errorMsg = `Target vertex "${targetName}" not found`;
            console.error(errorMsg);
            return errorMsg;
        }

        const newArrow: RecipeArrow = {
            source: sourceName,
            type: 'basic'
        };

        targetVertex.incomingArrows.push(newArrow);

        return { arrow: newArrow, source: sourceVertex, target: targetVertex };
    }

    setArrowTypeAndLabel(arrow: RecipeArrow, type: RecipeArrowType, label?: string): RecipeArrow | string {
        if (!arrowTypes.includes(type)) {
            return `Invalid arrow type: ${type}`;
        }

        arrow.type = type;

        if (label !== undefined) {
            delete arrow.label;
            if (label !== '') {
                arrow.label = label;
            }
        }

        return arrow;
    }

    addGroup(name: string, type: RecipeGroupType, parentGroup?: string): RecipeGroup | string {
        const validGroupTypes: RecipeGroupType[] = ['basic', 'loop', 'parallel'];
        if (!validGroupTypes.includes(type)) {
            const errorMsg = `Invalid group type: ${type}`;
            console.error(errorMsg);
            return errorMsg;
        }

        if (this.getVertexByName(name)) {
            const errorMsg = `A vertex with name "${name}" already exists`;
            console.error(errorMsg);
            return errorMsg;
        }

        const newGroup: RecipeGroup = {
            name,
            kind: 'group',
            type,
            members: [],
            incomingArrows: []
        };

        if (parentGroup) {
            const parentVertex = this.getVertexByName(parentGroup);
            if (!parentVertex || parentVertex.kind !== 'group') {
                const errorMsg = `"${parentGroup}" is not a valid group`;
                console.error(errorMsg);
                return errorMsg;
            }
            (parentVertex as RecipeGroup).members.push(newGroup);
        } else {
            this.recipe.graph.push(newGroup);
        }

        return newGroup;
    }

    setGroupLabel(groupName: string, label: string | undefined): RecipeGroup | string {
        const vertex = this.getVertexByName(groupName);

        if (!vertex || vertex.kind !== 'group') {
            const errorMsg = `"${groupName}" is not a valid group`;
            console.error(errorMsg);
            return errorMsg;
        }

        const group = vertex as RecipeGroup;

        if (label === undefined || label === '') {
            delete group.label;
        } else {
            group.label = label;
        }

        return group;
    }

    addGlobalVariable(name: string, initialValue: string): RecipeGlobalVariable | string {
        if (this.recipe.globalVariables.some(v => v.name === name)) {
            const errorMsg = `A global variable with name "${name}" already exists`;
            console.error(errorMsg);
            return errorMsg;
        }

        const newVariable: RecipeGlobalVariable = {
            name,
            initialValue
        };

        this.recipe.globalVariables.push(newVariable);
        return newVariable;
    }
}