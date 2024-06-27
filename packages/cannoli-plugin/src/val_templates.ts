export const cannoliServerCode = `
import { Hono } from "npm:hono";
import { bearerAuth } from "npm:hono/bearer-auth";

const app = new Hono();

const token = Deno.env.get("cannoli");

app.use("/*", bearerAuth({ token }));

app.all("/:cannoliName", async (c) => {
  try {
    const { cannoliName } = c.req.param();
    const cannoliFunction = await importCannoliFunction(cannoliName);

    const args = await parseArgs(c);
    const results = await callCannoliFunction(cannoliFunction, args);

    return c.json(results);
  } catch (error) {
    return c.text(\`Error: \${error.message}\`, 500);
  }
});

async function fetchUserProfile(): Promise<{ username: string }> {
  const response = await fetch(\`https://api.val.town/v1/me\`, {
    headers: {
      Authorization: \`Bearer \${Deno.env.get("valtown")}\`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch val.town profile");
  }

  return await response.json();
}

async function importCannoliFunction(cannoliName: string): Promise<Function> {
  try {
    const profile = await fetchUserProfile();
    const username = profile.username;
    const importPath = \`https://esm.town/v/\${username}/\${cannoliName}\`;
    const module = await import(\${importPath});
    return module.default || module[\${cannoliName}];
  } catch (error) {
    throw new Error(\`Error importing cannoli function: \${error.message}\`);
  }
}

async function parseArgs(c: any): Promise<Record<string, unknown> | string> {
  let args: Record<string, unknown> | string = {};
  if (c.req.method === "POST") {
    try {
      args = await c.req.json();
    } catch {
      args = await c.req.text();
      if (!args) {
        args = {};
      }
    }
  } else if (c.req.method === "GET") {
    const sp = new URLSearchParams(c.req.url.split("?")[1]);
    if (sp.toString().includes("=")) {
      args = {};
      sp.forEach((value, key) => {
        (args as Record<string, unknown>)[key] = value;
      });
    } else {
      args = sp.toString();
      if (!args) {
        args = {};
      }
    }
  }
  return args;
}

async function callCannoliFunction(
  cannoliFunction: Function,
  args: Record<string, unknown> | string,
): Promise<Record<string, string>> {
  const fnStr = cannoliFunction.toString();
  const paramsStr = fnStr.match(/(([^)]*))/)?.[1] || "";
  const params = paramsStr.split(",").map(param => param.split("=")[0].trim()).filter(param => param !== "");

  let coercedArgs: unknown[] = [];

  if (typeof args === "string") {
    if (params.length === 1) {
      coercedArgs = [args];
    } else {
      throw new Error("Cannoli expects multiple parameters but received a single string argument.");
    }
  } else {
    const missingParams = params.filter(param => !(param in args));
    const nonStringParams = params.filter(param => typeof args[param] !== "string");
    let errorMessages = [];
    if (missingParams.length) errorMessages.push(\`Missing required parameters: \${missingParams.join(", ")}\`);
    if (nonStringParams.length) errorMessages.push(\`Parameters expect string values: \${nonStringParams.join(", ")}\`);
    if (errorMessages.length) throw new Error(errorMessages.join(". "));

    coercedArgs = params.map(param => args[param]);
  }

  try {
    const result = await cannoliFunction(...coercedArgs);
    if (result === undefined) return {};
    if (typeof result === "string") return { result };
    if (typeof result === "object" && result !== null)
      return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, String(value)]));
    return {};
  } catch (error) {
    throw new Error(\`Error executing cannoli function: \${error.message}\`);
  }
}

export default app.fetch.bind(app);
`

const cannoliServerReadmeTemplate = `# Cannoli Server Endpoint

This HTTP endpoint can be used to execute baked Cannolis stored as scripts in your Val Town account. Cannolis are functions that take one or more string parameters and return one or more string results. You can specify which Cannoli to use via the URL path, and provide parameters through either the query string (GET request) or the request body (POST request).

## How to use

1. **Setup Authorization**:
   - Set a \`cannoli\` Env variable in your Val Town settings to something only you know.
   - Set up any other Env variables used by your cannolis, including LLM provider keys.
   - LLM provider API keys look like this by default: \`PROVIDER_API_KEY\`, but you can check the specifics in the \`LLMConfig\` array for a particular cannoli

2. **Endpoint URL**:
   - \`https://{{username}}-cannoliserver.web.val.run/cannoliName\`
   - Replace \`cannoliName\` with the name of the Cannoli you want to execute.

3. **Request Methods**:
   - **GET**: Pass parameters in the query string.
   - **POST**: Pass parameters in the request body as JSON or plain text.

## Requests
   - The parameters expected by a cannoli are defined by their named input nodes (See the section in the Cannoli College on input and output nodes to learn how to set these up)
   - When a cannoli is run with parameters, the content of each corresponding named input node is set to the parameter value before starting the run

### GET Request

curl -X GET 'https://{{username}}-cannoliserver.web.val.run/mamaMia?poppa=value1&pia=value2' \\
     -H 'Authorization: Bearer \`cannoli\`'

### POST Request

curl -X POST 'https://{{username}}-cannoliserver.web.val.run/mamaMia' \\
     -H 'Authorization: Bearer \`cannoli\`' \\
     -H 'Content-Type: application/json' \\
     -d '{"poppa": "value1", "pia": "value2"}'

## Responses
   - Responses to this endpoint are objects with string properties
   - Each property contains the contents of one of the named output nodes after the run has completed (see the Cannoli College section on input and output nodes to learn how to set these up)

### Example response

{ \\
  "planet": "Jupiter", \\
  "explanation": "I don't really know tbh." \\
}

## Privacy and sharing

This Val is unlisted by default, meaning only people with the link can see and use it, but any cannoli you call through this Val will use your API keys, so we secure it with the \`cannoli\` Env variable of your Val Town account.

When you bake a Cannoli from Obsidian, it is private by default, but it can still be imported by this val. Cannolis are just scripts that export a function, so you can make them public if you'd like, and share them so they can be imported anywhere or forked and used by others' Cannoli Server vals.

All LLM provider keys and other defined Env variables are referenced through the Val environment, but check that you haven't copied an API key into the canvas itself before sharing.
`;

export function generateCannoliServerReadme(username: string): string {
  return cannoliServerReadmeTemplate.replace(/{{username}}/g, username);
}
