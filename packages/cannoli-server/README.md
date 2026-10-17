# Cannoli Server

A companion HTTP server for the Cannoli Obsidian plugin that enables MCP (Machine Capability Provider) and other AI features.

You provide standard MCP server configuration, and the server will manage launching them and proxying their
contents to the Cannoli plugin in Obsidian.

## Installation / Usage

```bash
npx -y @deablabs/cannoli-server
```

View the help message by running:

```bash
npx -y @deablabs/cannoli-server --help
```

When launched for the first time, a secret key will be generated and displayed in the console. This key is used to authenticate with the Cannoli plugin. You can find / update the server secret in the [server's config file](#configuration).

## Features

- Settings management API (read/update)
- Full CRUD API for managing multiple MCP servers
- Support for both HTTP and stdio-based MCP servers
- MCP server proxy (coming soon)
- Long-running services that are not possible to run within the Obsidian Electron context (coming soon)

## API Documentation

All server endpoints are fully documented using OpenAPI. You can access the API documentation in two ways:

- Interactive API Reference UI: `http://localhost:3333/docs`
- Raw OpenAPI Specification: `http://localhost:3333/openapi`

The documentation includes detailed information about all endpoints, request/response schemas, and example usage.

## Server Types

### HTTP Servers

HTTP servers communicate with remote MCP providers over HTTP/HTTPS. Configuration options:

- `type`: Must be "http"
- `url`: The base URL of the MCP server (required)
- `headers`: Optional HTTP headers to include with each request
- `apiKey`: Optional API key (can also be included in headers)
- `enabled`: Whether the server is active

### STDIO Servers

STDIO servers run local processes and communicate via standard input/output. Configuration options:

- `type`: Must be "stdio"
- `command`: The command to execute (required)
- `args`: Array of command line arguments
- `cwd`: Working directory for the process
- `env`: Environment variables for the process
- `installCommand`: Optional command to run if the main command is not found
- `apiKey`: Optional API key (may be needed for some MCP providers)
- `enabled`: Whether the server is active

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build
pnpm build
```

## Configuration

The server stores configuration in a platform-specific directory:

- **MacOS/Linux**: `~/.config/@deablabs/cannoli-server/settings.json`
- **Windows**: `%APPDATA%\@deablabs\cannoli-server\settings.json`

If the settings file doesn't exist, a default one will be created.

Environment variables:

- `PORT`: The port to run the server on (default: 3333)
- `CONFIG_DIR`: Override the default configuration directory

### Web search in goal nodes

New Cannoli Server settings include [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
for free web search and page fetching, with no account or API key. Anonymous search
uses Fast mode and is subject to the service's free-tier limits.

Start Cannoli Server, enter its URL and generated secret in the Cannoli plugin's
server settings, then run a goal node asking it to find current information and
include source URLs. The agent can discover and call the search and fetch tools
through Cannoli's existing SSE connection. Queries and requested URLs go to
Parallel when the agent uses these tools; starting the server alone does not
connect to Parallel.

Saved settings are preserved, including empty server lists. Existing installations
can add this entry in the plugin's MCP server configuration editor:

```json
{
  "id": "parallel-search",
  "name": "Parallel Search",
  "type": "http",
  "url": "https://search.parallel.ai/mcp",
  "headers": {},
  "enabled": true
}
```

Set `enabled` to `false` or remove the entry to disable it. Explicit server URLs,
headers and credentials stay in effect; a failing configured server does not fall
back to another provider. HTTP servers use Streamable HTTP. An optional `apiKey`
is sent as a Bearer token, unless an explicit `Authorization` header is supplied.
Cannoli's local server secret is never forwarded as the remote server credential.

Malformed or unreadable saved settings now stop startup instead of replacing the
file with enabled defaults. Correct the file before restarting.
