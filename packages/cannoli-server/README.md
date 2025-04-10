# Cannoli Server

A companion HTTP server for the Cannoli Obsidian plugin that enables MCP (Machine Capability Provider) and other AI features.

## Features

- Settings management API (read/update)
- Full CRUD API for managing multiple MCP servers
- Support for both HTTP and stdio-based MCP servers
- MCP server proxy (coming soon)
- Long-running services that are not possible to run within the Obsidian Electron context (coming soon)

## API Endpoints

### GET /status

Returns the current server status and settings.

**Response:**

```json
{
 "status": "ok",
 "version": "1.0.0",
 "settings": {
  "mcpServers": [
   {
    "id": "http-server",
    "name": "Main HTTP MCP Server",
    "type": "http",
    "url": "https://example.com/mcp",
    "headers": {
     "Authorization": "Bearer token"
    },
    "enabled": true
   },
   {
    "id": "stdio-server",
    "name": "Local STDIO MCP Server",
    "type": "stdio",
    "command": "npx",
    "args": ["@anthropic/anthropic-mcp", "serve"],
    "env": {
     "ANTHROPIC_API_KEY": "sk-xxx"
    },
    "enabled": true
   }
  ],
  "defaultMcpServerId": "http-server",
  "proxyEnabled": false,
  "createdAt": "2023-09-01T00:00:00.000Z",
  "updatedAt": "2023-09-01T00:00:00.000Z"
 },
 "configPath": "/home/user/.config/@deablabs/cannoli-server/settings.json"
}
```

### MCP Server Endpoints

#### GET /mcp-servers

Returns a list of all configured MCP servers.

**Response:**

```json
{
 "status": "ok",
 "servers": [
  {
   "id": "http-server",
   "name": "Main HTTP MCP Server",
   "type": "http",
   "url": "https://example.com/mcp",
   "headers": {
    "Authorization": "Bearer token"
   },
   "enabled": true
  },
  {
   "id": "stdio-server",
   "name": "Local STDIO MCP Server",
   "type": "stdio",
   "command": "npx",
   "args": ["@anthropic/anthropic-mcp", "serve"],
   "env": {
    "ANTHROPIC_API_KEY": "sk-xxx"
   },
   "enabled": true
  }
 ],
 "defaultServerId": "http-server"
}
```

#### GET /mcp-servers/:id

Returns information about a specific MCP server.

**Response:**

```json
{
 "status": "ok",
 "server": {
  "id": "http-server",
  "name": "Main HTTP MCP Server",
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
   "Authorization": "Bearer token"
  },
  "enabled": true
 },
 "isDefault": true
}
```

#### POST /mcp-servers

Creates a new MCP server.

**HTTP Server Request Example:**

```json
{
 "name": "New HTTP Server",
 "type": "http",
 "url": "https://test.example.com/mcp",
 "headers": {
  "Authorization": "Bearer api-key"
 },
 "apiKey": "optional-api-key",
 "enabled": true,
 "setAsDefault": true
}
```

**STDIO Server Request Example:**

```json
{
 "name": "Local STDIO Server",
 "type": "stdio",
 "command": "npx",
 "args": ["@anthropic/anthropic-mcp", "serve"],
 "cwd": "/optional/working/directory",
 "env": {
  "ANTHROPIC_API_KEY": "sk-xxx",
  "DEBUG": "true"
 },
 "installCommand": "npm install -g @anthropic/anthropic-mcp",
 "enabled": true,
 "setAsDefault": false
}
```

**Response:**

```json
{
 "status": "ok",
 "server": {
  "id": "generated-id",
  "name": "New HTTP Server",
  "type": "http",
  "url": "https://test.example.com/mcp",
  "headers": {
   "Authorization": "Bearer api-key"
  },
  "apiKey": "optional-api-key",
  "enabled": true
 },
 "isDefault": true
}
```

#### PUT /mcp-servers/:id

Updates an existing MCP server.

**HTTP Server Update Example:**

```json
{
 "name": "Updated HTTP Server",
 "url": "https://updated.example.com/mcp",
 "headers": {
  "Authorization": "Bearer new-token"
 },
 "enabled": false,
 "setAsDefault": false
}
```

**STDIO Server Update Example:**

```json
{
 "name": "Updated STDIO Server",
 "command": "python",
 "args": ["-m", "mcp_provider.serve"],
 "env": {
  "OPENAI_API_KEY": "sk-xxx"
 },
 "enabled": true,
 "setAsDefault": true
}
```

**Response:**

```json
{
 "status": "ok",
 "server": {
  "id": "server1",
  "name": "Updated HTTP Server",
  "type": "http",
  "url": "https://updated.example.com/mcp",
  "headers": {
   "Authorization": "Bearer new-token"
  },
  "apiKey": "existing-api-key",
  "enabled": false
 },
 "isDefault": true
}
```

#### DELETE /mcp-servers/:id

Deletes an MCP server.

**Response:**

```json
{
 "status": "ok",
 "message": "Server server1 deleted successfully",
 "newDefaultId": "server2"
}
```

#### POST /mcp-servers/:id/set-default

Sets a server as the default MCP server.

**Response:**

```json
{
 "status": "ok",
 "message": "Server server2 set as default"
}
```

### PATCH /settings

Updates the server settings (general purpose endpoint).

**Request Body Example:**

```json
{
 "proxyEnabled": true
}
```

**Response:**

```json
{
 "status": "ok",
 "settings": {
  "mcpServers": [
   {
    "id": "http-server",
    "name": "Main HTTP MCP Server",
    "type": "http",
    "url": "https://example.com/mcp",
    "headers": {
     "Authorization": "Bearer token"
    },
    "enabled": true
   },
   {
    "id": "stdio-server",
    "name": "Local STDIO MCP Server",
    "type": "stdio",
    "command": "npx",
    "args": ["@anthropic/anthropic-mcp", "serve"],
    "env": {
     "ANTHROPIC_API_KEY": "sk-xxx"
    },
    "enabled": true
   }
  ],
  "defaultMcpServerId": "http-server",
  "proxyEnabled": true,
  "createdAt": "2023-09-01T00:00:00.000Z",
  "updatedAt": "2023-09-01T12:34:56.789Z"
 }
}
```

### GET /settings/raw

Returns the raw settings JSON file. This endpoint is useful for debugging or for direct access to the settings file. If the file doesn't exist, it will be created with default settings.

**Response:**

```json
{
 "mcpServers": [
  {
   "id": "http-server",
   "name": "Main HTTP MCP Server",
   "type": "http",
   "url": "https://example.com/mcp",
   "headers": {
    "Authorization": "Bearer token"
   },
   "enabled": true
  },
  {
   "id": "stdio-server",
   "name": "Local STDIO MCP Server",
   "type": "stdio",
   "command": "npx",
   "args": ["@anthropic/anthropic-mcp", "serve"],
   "env": {
    "ANTHROPIC_API_KEY": "sk-xxx"
   },
   "enabled": true
  }
 ],
 "defaultMcpServerId": "http-server",
 "proxyEnabled": false,
 "createdAt": "2023-09-01T00:00:00.000Z",
 "updatedAt": "2023-09-01T00:00:00.000Z"
}
```

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
