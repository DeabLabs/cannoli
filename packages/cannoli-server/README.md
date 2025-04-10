# Cannoli Server

A companion HTTP server for the Cannoli Obsidian plugin that enables MCP (Machine Capability Provider) and other AI features.

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
