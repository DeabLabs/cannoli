export const cannoliSchemaPrompt = `
# Cannoli Schema

A Cannoli is a directed, acyclic graph of nodes, groups, arrows, and global variables. Cannolis are essentially scripts which leverage Large Language Models (LLMs) to generate content, make decisions, and perform actions.

A cannoli can be fully described by a JSON object with the schema defined below.

## Cannoli

- **description**: A short description of the purpose and function of the cannoli.
- **graph**: The graph of the cannoli. It's a directed, acyclic graph of nodes, groups, arrows, and global variables.
- **globalVariables**: The global variables of the cannoli. These are variables available to be referenced and injected in the content of all nodes in the cannoli.

## Vertex

A vertex in a cannoli is a node or a group. Vertices can be connected by arrows.

- **name**: The name of the vertex. Must be unique within the graph.
- **kind**: The kind of the vertex ('node' or 'group').
- **type**: The type of the vertex (NodeType or GroupType).
- **outgoingArrows**: The outgoing arrows of the vertex.

## Node

Nodes are the basic building blocks of a Cannoli. You can think of nodes as functions.

- Inherits properties from Vertex
- **kind**: 'node'
- **type**: NodeType
- **content**: The content of the node (string with possible references)

## NodeType

The types of nodes in a Cannoli:

- **ai**: AI nodes make calls to LLMs.
- **content**: Content nodes store static content and can be overwritten.
- **formatter**: Formatter nodes are like content nodes but inject references.
- **reference**: Reference nodes reference specific notes or global variables.
- **action**: Action nodes perform actions like HTTP requests or function calls.

## Group

Groups can organize the cannoli and reduce the number of arrows.

- Inherits properties from Vertex
- **kind**: 'group'
- **type**: GroupType
- **label**: The label of the group.
- **members**: The members of the group (nodes or groups).

## GroupType

The types of groups in a Cannoli:

- **basic**: For organizational purposes.
- **loop**: Repeat execution of a group of nodes.
- **parallel**: Run the same set of nodes in parallel with different inputs.

## Arrow

Arrows are the connections between nodes and groups.

- **toNode**: The name of the node or group the arrow is pointing to.
- **type**: ArrowType
- **label**: The label of the arrow (optional).

## ArrowType

The types of arrows in a Cannoli:

- **basic**: Function depends on source and target node types.
- **variable**: Labeled arrows with behavior depending on node types.
- **choice**: Special type affecting execution of source AI node.
- **field**: Similar to choice arrows but for multiple categorized outputs.
- **list**: Distribute items in a list to target parallel group.
- **config**: Define the config of AI nodes.

## GlobalVariable

Global variables are available to be referenced and injected in all nodes.

- **name**: The name of the global variable.
- **initialValue**: The initial value of the global variable (string).

## Summary

In summary, a cannoli is a directed, acyclic graph of nodes, groups, arrows, and global variables.

A cannoli object has three properties:
- description: a string
- graph: an array of nodes or groups (Arrows are defined directly on the vertices they come from, not in a separate array on the cannoli object.)
- globalVariables: an array of global variables

A cannoli node has the following properties:
- name: a string
- kind: 'node'
- type: a node type
- content: a string

A cannoli group has the following properties:
- name: a string
- kind: 'group'
- type: a group type
- label: a string
- members: an array of node or group objects

A cannoli arrow has the following properties:
- toNode: a string defining the name of the node or group the arrow is pointing to
- type: an arrow type
- label: a string or null
`;

export const cannoliRecipeInstructionsPrompt = `Don't respond with JSON yet. First, respond with a brief plan explaining the structure of the cannoli you will generate. This should be a rough outline describing the basic flow of the cannoli.`;

export const cannoliRecipeJsonPrompt = `Now, respond with the JSON representation of the cannoli you described in the plan. Nothing but the raw JSON object should be in your response. Ensure it adheres to the schema defined above.`;