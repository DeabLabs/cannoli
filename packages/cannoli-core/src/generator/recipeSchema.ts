import { z } from 'zod';

/**
 * A Cannoli is a directed, acyclic graph of nodes, groups, arrows, and global variables.
 * 
 * Cannolis are essentially scripts which leverage Large Language Models (LLMs) to generate content, make decisions, and perform actions.
 * 
 * A cannoli can be fully described by a JSON object with the schema defined below.
 */
export type CannoliRecipe = {
    /**
     * A short description of the purpose and function of the cannoli.
     */
    description: string;
    /**
     * The graph of the cannoli.
     * 
     * The graph is a directed, acyclic graph of nodes, groups, arrows, and global variables.
     */
    graph: (RecipeVertex | RecipeGroup)[];
    /**
     * The global variables of the cannoli.
     * 
     * Global variables are variables that are available to be referenced and injected in the content of all nodes in the cannoli.
     */
    globalVariables: RecipeGlobalVariable[];
};

/**
 * A vertex in a cannoli is a node or a group. Vertices can be connected by arrows.
 */
export type RecipeVertex = {
    /**
     * The name of the vertex.
     * 
     * The name of a vertex must be unique within the graph. It doesn't need to have a particular format (i.e. it can have spaces, or start with a number, etc.) but it should be descriptive.
     * 
     * Vertext names will not affect the execution of the cannoli, but they should be somewhat meaningful to you, to make referencing them easier. Think of them as the names of functions.
     */
    name: string;
    /**
     * The kind of the vertex.
     * 
     * The kind of a vertex is either 'node' or 'group'.
     */
    kind: 'node' | 'group';
    type: RecipeNodeType | RecipeGroupType;
    /**
     * The outgoing arrows of the vertex. In other words, the arrows that come out of the vertex, and carry content to other vertices.
     * 
     * Note that arrows are defined directly on the verteces they come from, not in a separate array on the cannoli object.
     */
    outgoingArrows: RecipeArrow[];
};

/**
 * Nodes are the basic building blocks of a Cannoli.
 * 
 * You can think of nodes as functions. Their incoming arrows are the arguments to the function, and their outgoing arrows are the return values.
 * 
 * There are 3 basic steps to executing a node:
 * 1. Wait until all incoming arrows are filled
 * 2. Set the config of the node based on incoming config-type arrows
 * 3. (Depending on node type) Inject the reference content in the node's content
 * 4. (Depending on node type) Do something with the rendered content
 * 5. Send the rendered content, or the result of the execution, to all outgoing arrows
 */
export type RecipeNode = RecipeVertex & {
    kind: 'node';
    type: RecipeNodeType;
    /**
     * The content of the node.
     * 
     * The content of a node is a string. Depending on the node type, the content can have references to incoming arrows, global variables, or notes in the user's vault.
     * 
     * References look like this:
     * - {{global variable name}}
     * - {{incoming arrow label}}
     * - {{[[note name]]}}
     */
    content: string;
};

/**
 * The types of nodes in a Cannoli. The type of a node determines how its content is rendered and executed.
 */
export type RecipeNodeType =
    /**
     * AI nodes make calls to LLMs. 
     * The references within their content will be injected, then the rendered content will be sent to the LLM, continuing the conversation given by any incoming basic arrows from other AI nodes.
     * 
     * Use good prompting techniques to make sure the LLM understands how it is supposed to answer, such that the subsequent nodes can use the LLM response as they expect. This may include giving specific instructions on the format of the response, like "...nothing else should be in your response", or "...your response should be in JSON format".
     * 
     * References can be to:
     * - Global variables
     * - Notes in the user's vault
     * - Incoming arrows from other nodes
     * 
     * References look like this:
     * - {{global variable name}}
     * - {{incoming arrow label}}
     * - {{[[note name]]}}
     * 
     * The output of the LLM will be sent to the outgoing arrows according to the arrow type, possibly with the updated conversation history, depending on the arrow type.
     */
    'ai' |
    /**
     * Content nodes can store static content, and be overwritten by other nodes.
     * They do not inject references in their content.
     * 
     * When content nodes execute, they send their final content to all outgoing arrows.
     */
    'content' |
    /**
     * Formatter nodes are like content nodes, but they cannot be overwritten, and they will inject references in their content like AI nodes.
     * 
     * When formatter nodes execute, they send the rendered content with injected references to all outgoing arrows.
     */
    'formatter' |
    /**
     * Reference nodes can be used to reference specific notes in the user's vault, and global variables.
     * The content of a reference node should only be a reference and nothing else, like "{{global variable name}}" or "{{[[note name]]}}".
     * 
     * Incoming arrows to reference nodes will write their content they carry to the reference node.
     * 
     * When reference nodes execute, they send the content of the reference to all outgoing arrows.
     */
    'reference' |
    /**
     * Action nodes are used to perform actions, like making HTTP requests or calling specific functions.
     * References in action node content will be injected and the content will be rendered before we parse and execute the action.
     * 
     * There are two main types of actions:
     * - HTTP requests
     * - Function calls
     * 
     * HTTP requests can be defined in two ways:
     * - A URL (this will send a GET request to the URL)
     * - A fetch JSON object with the following properties:
     *   - method: the HTTP method to use (GET, POST, PUT, DELETE, etc.)
     *   - url: the URL to send the request to
     *   - body: the body of the request (only applicable for POST, PUT, and PATCH requests)
     *   - headers: the headers of the request
     * 
     * Function calls are defined in two ways:
     * - The node's content is just the name of the function to call
     * - The first line of the node's content is the name of the function to call, wrapped in single square brackets
     *   - The rest of the node's content will be passed in as the first arument of the function (this is useful when you want to do some templating on the first argument with references, as it saves you using a formatter node.)
     * 
     * You can always use HTTP actions, but you can only use functions if they are included in the list of available actions later in this message.
     */
    'action';

/**
 * Groups can simply be used to organize the cannoli and reduce the number of arrows, but certain group types can also change the way nodes are executed.
 * 
 * Groups can be nested.
 * 
 * Groups can have incoming arrows, but they cannot have outgoing arrows. Incoming arrows will be available to all nodes within the group, which is useful when several nodes need to access the same content, or have the s
 */
export type RecipeGroup = RecipeVertex & {
    kind: 'group';
    type: RecipeGroupType;
    /**
     * The label of the group.
     * 
     * The content of the label DOES affect the execution of the group, depending on the group type, but it is not used as a reference.
     */
    label: string;
    /**
     * The members of the group.
     * 
     * The members of a group are the nodes or groups that are inside the group.
     */
    members: (RecipeNode | RecipeGroup)[];
};

/**
 * The types of groups in a Cannoli.
 */
export type RecipeGroupType =
    /**
     * Basic groups can be used for organizational purposes, and to provide common arrows which are available to be referenced by all nodes within the group.
     * 
     * Basic groups do not change the way nodes are executed.
     * 
     * The label of a basic group must NOT be a number.
     */
    'basic' |
    /**
     * Loop groups are used to repeat the execution of a group of nodes a specified number of times.
     * 
     * The label of a loop group is the number of times the group should be executed.
     * 
     * When all of the nodes within the loop group have executed, the loop group will be executed again, until the number of loops is reached.
     * 
     * Loop groups get more interesting when you have reflexive arrows, meaning arrows that go from a node inside the loop group to the loop group itself.
     * Reflexive arrows are the one place where Cannoli deviates from the traditional graph execution model.
     * When a loop group finishes a particular loop, the content carried by its reflexive arrows will be available to the member nodes in the next loop. This means you can iteratively use the output of previous loops to inform the next loop.
     */
    'loop' |
    /**
     * Parallel groups are used to run the same set of nodes in parallel, but with different input. They work by copying the original group a specified number of times, and running all of the copies in parallel, but with a different input for each copy.
     * 
     * The label of a parallel group is the number of copies there will be of a group. It essentially acts as a limit to the number versions of a group that will be run in parallel.
     * 
     * Parallel groups must have one and only one incoming list arrow
     * 
     * The list arrow (see below) will distribute the items in the list to the parallel group copies. Not all of the parallel group copies need to receive an item from the list, but we will only distribute items to as many copies as there are. That's why the label of a parallel group works as a limit.
     * 
     * Arrows crossing out of parallel groups are merged into a single arrow, which carries the content of all of the arrows joined with newlines. This means it's useful to use a formatter node to format content before you send it out of a parallel group.
     */
    'parallel';

/**
 * Arrows are the connections between nodes and groups. They carry content from one node or group to another. Arrows cannot come from groups, but they can go to groups.
 * 
 * Arrows can be of different types, which can affect how the content carried by the arrow is used, and can even affect the behavior of its source node.
 */
export type RecipeArrow = {
    /**
     * The name of the node or group that the arrow is pointing to.
     */
    toNode: string;
    type: RecipeArrowType;
    /**
     * The label of the arrow.
     * 
     * The label of an arrow can serve several purposes, depending on the arrow type and the types of node it's coming from.
     * Depending on context, the label can be used to:
     * - Define the name by which target nodes can refer to the content of the arrow
     * - Define the JSON path you want to use to extract content from the result of the source node
     * - Define choices or fields for an AI node to choose/fill in.
     * - Define the name of the config variable that the content of the arrow will be used to set.
     */
    label?: string;
};

/**
 * The types of arrows in a Cannoli.
 */
export type RecipeArrowType =
    /**
     * The function of a basic arrow depends on the type of the node it's coming from and the type of the node it's pointing to.
     * 
     * All of the possible combinations of source and target node types are enumerated in the list below.
     * 
     * If it's coming from an AI node, it will carry the LLM response and the conversation history.
     *   - If it's pointing to an AI node, it will provide the conversation history so that it can continue with the next node.
     *   - If it's pointing to a CONTENT or REFERENCE node, it will write the LLM response to the node.
     * 
     * If it's coming from a CONTENT, FORMATTER, REFERENCE or ACTION node, it will carry the result/content of the source node.
     *   - If it's pointing to an AI node, it will pass the content to the LLM as a system message (a special type of message that tells the LLM how it should be answering user messages)
     *   - If it's pointing to a CONTENT node or a REFERENCE node, it will write the content to the node.
     */
    'basic' |
    /**
     * Variable arrows are labeled arrows. Their behavior also depends on the type of the node they're coming from/pointing to.
     * 
     * All of the possible combinations of source and target node types are enumerated in the list below.
     * 
     * If it's coming from an AI node, it will carry the LLM response, but it will only carry conversation history if a "|" is appended to the label.
     * If it's coming from a CONTENT, FORMATTER or REFERENCE node, it will carry the content/result of the node.
     * If it's coming from an ACTION node, its label can be used to define the JSON path of the content you want the arrow to pass to the target node. This is optional. If the path is not valid, the arrow will carry the whole result of the action.
     * 
     * If it's pointing to an AI, FORMATTER, or ACTION node, the content carried by the arrow will be available to be referenced and injected in the target node's content.
     * If it's pointing to a CONTENT or REFERENCE node, the arrow will write the content to the node.
     */
    'variable' |
    /**
     * Choice arrows are a special type of arrow that have an effect on the execution of the source AI node. They must always be labeled, and come from an AI node.
     * 
     * When an AI node has one or more outgoing choice arrows, instead of answering as normal, it will just choose one of the choices based on the label of the arrow.
     * 
     * Only the single chosen choice arrow will be filled, and other choice arrows will be "rejected", along with their descendants.
     * 
     * Choice arrows can be used to create branching conditional and selective logic in a cannoli.
     * 
     * Aside from this property, choice arrows behave like variable arrows, and their content will be available to be referenced and injected in the target node's content.
     * 
     * Similarly to variable arrows, conversation history will be passed to the target node if a "|" is appended to the label.
     */
    'choice' |
    /**
     * Field arrows are similar to choice arrows, but instead of choosing one of the choices, the LLM will pass different strings to each of the outgoing field arrows, based on the label of the arrow.
     * 
     * Field arrows must always be labeled, and come from an AI node.
     * 
     * Field arrows can be used to have a single AI node generate multiple categorized pieces of output.
     * 
     * Aside from this property, field arrows behave like variable arrows, and their content will be available to be referenced and injected in the target node's content.
     * 
     * Similarly to variable arrows, conversation history will be passed to the target node if a "|" is appended to the label.
     */
    'field' |
    /**
     * List arrows are used to distribute the items in a list to the target node.
     * 
     * List arrows can come from any type of node, but they must always be labeled and they must always point to a parallel group.
     * 
     * When list arrows execute, they will parse their input into a list of items thus:
     * - If the input is a valid JSON array, the list will be the array's items, where any non-string values will be converted to strings.
     * - If it's not a valid JSON array, we will try to parse any markdown list items it contains as the items in the list.
     * 
     * The list will then be distributed to the target parallel group copies, where each copy will receive one item from the list.
     * 
     * Nodes inside each copy of the parallel group can access their particular item by using the usual "{{label of list arrow}}" syntax.
     */
    'list' |
    /**
     * Config arrows are used to define the config of AI nodes.
     * 
     * Config arrows must always be labeled, their label must be one of the following:
     * - "provider": the name of the provider to use ("openai", "anthropic", "gemini", "azure", "groq", "ollama")
     * - "model": the name of the model to use (this depends on provider, and will likely be provided by the user)
     * - "temperature": a number between 0 and 1. The temperature to use.
     * - "max_tokens": a number. The maximum number of tokens to use.
     * 
     * The content of the arrow will set the setting defined by the label for the target AI node, or any AI nodes in the group the arrow points to.
     */
    'config';

/**
 * Global variables are variables that are available to be referenced and injected in the content of all nodes in the cannoli. They are defined in the globalVariables array of the recipe.
 * 
 * They can also be written to when referenced in reference nodes, using the syntax "{{name of global variable}}"
 * 
 * References will NOT be injected in the initial value of a global variable.
 * 
 * Global variables are also known as "floating nodes", so the user may refer to them as such.
 */
export type RecipeGlobalVariable = {
    name: string;
    /**
     * The initial value of the global variable. A string.
     */
    initialValue: string;
};

/**
 * In summary, a cannoli is a directed, acyclic graph of nodes, groups, arrows, and global variables.
 * 
 * A cannoli object has three properties:
 * - description: a string
 * - graph: an array of nodes or groups (Arrows are defined directly on the verteces they come from, not in a separate array on the cannoli object.)
 * - globalVariables: an array of global variables
 * 
 * A cannoli node has the following properties:
 * - name: a string
 * - kind: 'node'
 * - type: a node type
 * - content: a string
 * 
 * A cannoli group has the following properties:
 * - name: a string
 * - kind: 'group'
 * - type: a group type
 * - label: a string
 * - members: an array of node or group objects
 * 
 * A cannoli arrow has the following properties:
 * - toNode: a string defining the name of the node or group the arrow is pointing to
 * - type: an arrow type
 * - label: a string or null
 */

// Zod schemas
export const recipeNodeTypeSchema = z.enum(['ai', 'content', 'formatter', 'reference', 'action']);
export const recipeGroupTypeSchema = z.enum(['basic', 'loop', 'parallel']);
export const recipeArrowTypeSchema = z.enum(['basic', 'variable', 'choice', 'field', 'list', 'config']);


export const recipeArrowSchema: z.ZodType<RecipeArrow> = z.object({
    toNode: z.string(),
    type: recipeArrowTypeSchema,
    label: z.string().optional(),
});

export const recipeGlobalVariableSchema: z.ZodType<RecipeGlobalVariable> = z.object({
    name: z.string(),
    initialValue: z.string(),
});

export const recipeVertexSchema: z.ZodType<RecipeVertex> = z.object({
    name: z.string(),
    kind: z.enum(['node', 'group']),
    type: z.union([recipeNodeTypeSchema, recipeGroupTypeSchema]),
    outgoingArrows: z.array(recipeArrowSchema),
});

export const recipeNodeSchema: z.ZodType<RecipeNode> = z.intersection(
    recipeVertexSchema,
    z.object({
        kind: z.literal('node'),
        type: recipeNodeTypeSchema,
        content: z.string(),
    })
);

export const recipeGroupSchema: z.ZodType<RecipeGroup> = z.lazy(() =>
    z.intersection(
        recipeVertexSchema,
        z.object({
            kind: z.literal('group'),
            type: recipeGroupTypeSchema,
            label: z.string(),
            members: z.array(z.union([recipeNodeSchema, z.lazy(() => recipeGroupSchema)])),
        })
    )
);

export const cannoliRecipeSchema: z.ZodType<CannoliRecipe> = z.object({
    description: z.string(),
    graph: z.array(z.union([recipeVertexSchema, recipeGroupSchema])),
    globalVariables: z.array(recipeGlobalVariableSchema),
}).refine(
    (recipe) => {
        const nodeNames = new Set<string>();
        const duplicateNames = new Set<string>();

        const collectNodeNames = (vertex: RecipeVertex | RecipeGroup) => {
            if (nodeNames.has(vertex.name)) {
                duplicateNames.add(vertex.name);
            } else {
                nodeNames.add(vertex.name);
            }
            if (vertex.kind === 'group') {
                (vertex as RecipeGroup).members.forEach(collectNodeNames);
            }
        };
        recipe.graph.forEach(collectNodeNames);

        return duplicateNames.size === 0;
    },
    {
        message: "All vertex names must be unique",
        path: ['graph'],
    }
).refine(
    (recipe) => {
        const nodeNames = new Set<string>();

        // Collect all node names
        const collectNodeNames = (vertex: RecipeVertex | RecipeGroup) => {
            nodeNames.add(vertex.name);
            if (vertex.kind === 'group') {
                (vertex as RecipeGroup).members.forEach(collectNodeNames);
            }
        };
        recipe.graph.forEach(collectNodeNames);

        // Check if all toNode values are valid
        const checkArrows = (vertex: RecipeVertex | RecipeGroup): boolean => {
            if (vertex.outgoingArrows.some(arrow => !nodeNames.has(arrow.toNode))) {
                return false;
            }
            if (vertex.kind === 'group') {
                return (vertex as RecipeGroup).members.every(checkArrows);
            }
            return true;
        };

        return recipe.graph.every(checkArrows);
    },
    {
        message: "All 'toNode' values in arrows must refer to existing nodes",
        path: ['graph'],
    }
);