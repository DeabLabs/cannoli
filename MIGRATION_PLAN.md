# Migration from LangChain to Vercel AI SDK - Status

## Overview

Successfully migrated core functionality from LangChain to Vercel AI SDK while maintaining API compatibility.

## Completed ✅

### Dependencies

- ✅ Installed AI SDK dependencies (`ai@^5.0.81`, `@ai-sdk/*` packages)
- ✅ Updated `zod` to `^3.25.76` for compatibility
- ✅ Removed old LangChain provider packages while keeping core dependencies for MCP tools

### Core Functionality

- ✅ All providers working (openai, anthropic, groq, gemini, ollama via OpenAI-compatible API, azure_openai via @ai-sdk/azure)
- ✅ Tool calling fully functional (choice, note_select, form)
- ✅ Streaming responses working
- ✅ Message conversion working correctly
- ✅ Hello world and basic cannolis working

### Key Fixes Applied

1. **Tool Arguments**: AI SDK uses `toolCall.input` instead of `toolCall.args` for tool call arguments
2. **Tool Choice**: Added `toolChoice: { type: "tool", toolName: function_call.name }` to force specific tool calls
3. **Message Filtering**: Filter out messages with `function_call` and `tool` roles in `convertToAIMessages` to avoid "No tool call found" errors (these are handled externally by the cannoli system)
4. **Tool Definitions**: Updated to use AI SDK's `tool()` helper with `inputSchema` instead of `parameters`

### Files Modified

- ✅ `packages/cannoli-core/src/providers.ts` - Complete rewrite using AI SDK
- ✅ `packages/cannoli-core/src/fn_calling.ts` - Updated to AI SDK tool format
- ✅ `packages/cannoli-core/package.json` - Updated dependencies

## Remaining Tasks

### Goal Completion (MCP Tools)

- [ ] Convert MCP tools from LangChain format to AI SDK format
- [ ] Implement proper tool execution in custom agent loop
- Currently uses simplified implementation without full tool execution

### Cleanup

- [ ] Remove remaining LangChain imports where possible
- [ ] Keep `@langchain/core` and `@langchain/mcp-adapters` for MCP tools until full conversion
- [ ] Update goal completion to properly execute tools and handle responses

## Testing Recommendations

- ✅ Basic completions
- ✅ Tool calling (choice, note_select, form)
- ✅ Streaming
- ✅ All providers
- [ ] Goal completion with MCP tools
- [ ] Complex multi-turn conversations
- [ ] Vision/image inputs
- [ ] Edge cases and error handling

## Notes

- The migration maintains backward compatibility with existing GenericCompletionParams/Response types
- All cannolis should work the same as before
- Hello world works perfectly
- Choice nodes, form nodes, and note_select nodes work correctly
