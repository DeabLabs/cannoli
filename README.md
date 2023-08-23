# Cannoli

Cannoli allows you to build and run no-code LLM scripts using the Obsidian Canvas editor.

## What is a Cannoli?

![Example Cannoli](/assets/exampleCannoli.png)

Cannolis are scripts that leverage the Openai API to read/write to your vault, and take actions using HTTP requests. Cannolis are created in the Obsidian Canvas editor, using cards and arrows to define variables and logic. They can be run within Obsidian using the ribbon icon or the command palette.

Using colors or prefixes, you can create nodes and arrows of different types to define basic logical functions like variables, fields, loops, and branching choices. If a Canvas is a Directed Acyclic Graph and follows the Cannoli schema, it can be run as a cannoli.

## Documentation

You can access a walkthrough folder of sample cannolis in the plugin settings (full docs website forthcoming).

![Cannoli College](/assets/cannoliCollege.png)

## Running Cannolis

Cannolis can be run in several ways:

-   Click the Cannoli ribbon icon to run the current Canvas file as a cannoli

![Icon](/assets/icon.png)

-   Run the "Start/Stop this Cannoli" command in the command palette to run the current Canvas file as a cannoli
-   If a canvas file name ends with ".cno", it will have its own run command in the command palette

## Network Use

Cannoli calls the OpenAI API chat completion endpoint based on the setup of the cannoli being run. Cannoli can send HTTP requests that you define up front.

<a href='https://ko-fi.com/Z8Z1OHPFX' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>
