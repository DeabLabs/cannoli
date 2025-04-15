import {
  VerifiedCannoliCanvasFileData,
  VerifiedCannoliCanvasLinkData,
  VerifiedCannoliCanvasTextData,
  VerifiedCannoliCanvasData,
  AllVerifiedCannoliCanvasNodeData,
} from "src/graph";
import {
  ReceiveInfo,
  Action,
  ActionResponse,
  ActionArgs,
  HttpRequest,
  HttpTemplate,
} from "src/run";
import { z } from "zod";
import { ContentNode } from "../ContentNode";
import { FloatingNode } from "../../../FloatingNode";

export const HTTPConfigSchema = z
  .object({
    url: z.string().optional(),
    method: z.string().optional(),
    headers: z.string().optional(),
    catch: z.coerce.boolean().optional(),
    timeout: z.coerce.number().optional(),
  })
  .passthrough();

export type HttpConfig = z.infer<typeof HTTPConfigSchema>;

// Default http config
export const defaultHttpConfig: HttpConfig = {
  catch: true,
  timeout: 30000,
};

export class HttpNode extends ContentNode {
  receiveInfo: ReceiveInfo | undefined;

  constructor(
    nodeData:
      | VerifiedCannoliCanvasFileData
      | VerifiedCannoliCanvasLinkData
      | VerifiedCannoliCanvasTextData,
    fullCanvasData: VerifiedCannoliCanvasData,
  ) {
    super(nodeData, fullCanvasData);
    this.receiveInfo = nodeData.cannoliData.receiveInfo;
  }

  setReceiveInfo(info: ReceiveInfo) {
    this.receiveInfo = info;
    const data = this.canvasData.nodes.find(
      (node) => node.id === this.id,
    ) as AllVerifiedCannoliCanvasNodeData;
    data.cannoliData.receiveInfo = info;
  }

  logDetails(): string {
    return super.logDetails() + `Subtype: Http\n`;
  }

  private async prepareAndExecuteAction(
    action: Action,
    namedActionContent: string | null,
    config: HttpConfig,
    isLongAction: boolean = false,
  ): Promise<ActionResponse> {
    const { args: argNames, optionalArgs } = this.getActionArgs(action);

    const variableValues = this.getVariableValues(true);

    let isFirstArg = true;

    // Create an object to hold the argument values
    const args: ActionArgs = {};

    // Get the value for each arg name from the variables, and error if any arg is missing
    for (const argName of argNames) {
      // If the arg has argInfo and its category is extra, skip
      if (
        action.argInfo &&
        action.argInfo[argName] &&
        action.argInfo[argName].category === "extra"
      ) {
        continue;
      }

      // If the arg has an argInfo and its category is files, give it the filesystem interface
      if (
        action.argInfo &&
        action.argInfo[argName] &&
        action.argInfo[argName].category === "fileManager"
      ) {
        // If the filesystemInterface is null, error
        if (!this.run.fileManager) {
          return new Error(
            `The action "${action.name}" requires a file interface, but there isn't one in this run.`,
          );
        }
        args[argName] = this.run.fileManager;
        continue;
      }

      // If the arg has an argInfo and its category is fetcher, give it the responseTextFetcher
      if (
        action.argInfo &&
        action.argInfo[argName] &&
        action.argInfo[argName].category === "fetcher"
      ) {
        args[argName] = this.run.fetcher;
        continue;
      }

      // If the argName is in the configKeys, get the value from the config
      if (
        action.argInfo &&
        action.argInfo[argName] &&
        action.argInfo[argName].category === "config"
      ) {
        // Error if the config is not set
        if (!config[argName] && !optionalArgs[argName]) {
          return new Error(
            `Missing value for config parameter "${argName}" in available config. This action "${action.name}" accepts the following config keys:\n${Object.keys(
              action.argInfo,
            )
              .filter((arg) => action.argInfo?.[arg].category === "config")
              .map(
                (arg) => `  - ${arg} ${optionalArgs[arg] ? "(optional)" : ""}`,
              )
              .join("\n")}`,
          );
        }

        if (config[argName]) {
          if (action.argInfo[argName].type === "number") {
            args[argName] = this.coerceValue(
              config[argName] as string,
              argName,
              action.argInfo[argName].type,
            );
          } else {
            args[argName] = config[argName] as string;
          }
        }
        continue;
      }

      // If the argName is in the secretKeys, get the value from the config
      if (
        action.argInfo &&
        action.argInfo[argName] &&
        action.argInfo[argName].category === "secret"
      ) {
        // Error if the secret is not set
        if (!config[argName] && !optionalArgs[argName]) {
          return new Error(
            `Missing value for secret parameter "${argName}" in the cannoli environment.\n\nYou can set these in the "Secrets" section of the Cannoli settings. LLM provider and Val Town keys are currently pulled from their respective settings.\n\nThis action "${action.name}" accepts the following secret keys:\n${Object.keys(
              action.argInfo,
            )
              .filter((arg) => action.argInfo?.[arg].category === "secret")
              .map(
                (arg) => `  - ${arg} ${optionalArgs[arg] ? "(optional)" : ""}`,
              )
              .join("\n")}`,
          );
        }

        if (config[argName]) {
          if (action.argInfo[argName].type === "number") {
            args[argName] = this.coerceValue(
              config[argName] as string,
              argName,
              action.argInfo[argName].type,
            );
          } else {
            args[argName] = config[argName] as string;
          }
        }
        continue;
      }

      if (isFirstArg && namedActionContent) {
        isFirstArg = false;

        if (
          action.argInfo &&
          action.argInfo[argName] &&
          action.argInfo[argName].type
        ) {
          args[argName] = this.coerceValue(
            namedActionContent,
            argName,
            action.argInfo[argName].type,
          );
        } else {
          args[argName] = namedActionContent;
        }
        continue;
      }

      const variableValue = variableValues.find(
        (variableValue) => variableValue.name === argName,
      );
      if (!variableValue && !optionalArgs[argName]) {
        return new Error(
          `Missing value for variable "${argName}" in available arrows. This action "${action.name}" accepts the following variables:\n${argNames
            .map((arg) => `  - ${arg} ${optionalArgs[arg] ? "(optional)" : ""}`)
            .join("\n")}`,
        );
      }

      if (variableValue) {
        if (
          action.argInfo &&
          action.argInfo[argName] &&
          action.argInfo[argName].type
        ) {
          args[argName] = this.coerceValue(
            variableValue.content || "",
            argName,
            action.argInfo[argName].type,
          );
        } else {
          args[argName] = variableValue.content || "";
        }
      }
    }

    const extraArgs: Record<string, string> = {};

    // Collect extra arguments
    for (const variableValue of variableValues) {
      if (!argNames.includes(variableValue.name)) {
        extraArgs[variableValue.name] = variableValue.content || "";
      }
    }

    // If the action has an "extra" category, add the extraArgs to the args
    if (action.argInfo) {
      for (const [argName, argInfo] of Object.entries(action.argInfo)) {
        if (argInfo.category === "extra") {
          args[argName] = extraArgs;
        }
      }
    }

    if (this.run.isMock) {
      if (isLongAction) {
        return { content: "This is a mock response" };
      }

      if (action.resultKeys) {
        // Make an object with the keys and values
        const result = action.resultKeys.reduce<Record<string, string>>(
          (acc, key) => {
            acc[key] = "This is a mock response";
            return acc;
          },
          {},
        );
        return result;
      }

      return "This is a mock response";
    }

    return await action.function(args);
  }

  private coerceValue(
    value: string,
    argName: string,
    type: "number" | "boolean" | "string" | string[] | undefined,
  ): number | boolean | string {
    if (type === "number") {
      const numberValue = parseFloat(value);
      if (isNaN(numberValue)) {
        this.error(
          `Invalid number value: "${value}" for variable: "${argName}"`,
        );
      }
      return numberValue;
    } else if (type === "boolean") {
      if (value !== "true" && value !== "false") {
        this.error(
          `Invalid boolean value: "${value}" for variable: "${argName}"`,
        );
      }
      return value === "true";
    } else if (Array.isArray(type)) {
      if (!type.includes(value)) {
        this.error(
          `Invalid value: "${value}" for variable: "${argName}". Expected one of:\n${type.map((t) => `  - ${t}`).join("\n")}`,
        );
      }
      return value;
    } else {
      return value;
    }
  }

  coerceActionResponseToString(result: ActionResponse): string | Error {
    if (result === undefined || result === null) {
      return "";
    }
    if (result instanceof Error) {
      return result;
    } else if (typeof result === "string") {
      return result;
    } else if (Array.isArray(result)) {
      return JSON.stringify(result);
    } else if (typeof result === "object") {
      const objectKeys = Object.keys(result);

      // Check if there are any outgoing edges whose text isn't a key in the object
      const outgoingEdgeNames = this.outgoingEdges.map(
        (edge) => this.graph[edge].text,
      );
      const keysNotInObject = outgoingEdgeNames.filter(
        (name) => !objectKeys.includes(name),
      );

      // If there are, error
      if (keysNotInObject.length > 0) {
        return new Error(
          `This action returns multiple variables, but there are outgoing arrows that don't match any names of the variables. The variables are: ${objectKeys.join(", ")}. The incorrect outgoing arrows are: ${keysNotInObject.join(", ")}.`,
        );
      }

      return JSON.stringify(result);
    }

    return new Error(`Action returned an unknown type: ${typeof result}.`);
  }

  async execute(): Promise<void> {
    const overrides = this.getConfig(HTTPConfigSchema) as HttpConfig;
    if (overrides instanceof Error) {
      this.error(overrides.message);
      return;
    }

    const config = {
      ...this.run.config,
      ...this.run.secrets,
      ...defaultHttpConfig,
      ...overrides,
    };

    this.executing();

    let content = await this.processReferences([], true);

    // Check if the content is wrapped in triple backticks with the "mcp" language identifier
    if (content.startsWith("```mcp\n") && content.endsWith("\n```")) {
      // If its mock run, return a mock response
      if (this.run.isMock) {
        this.loadOutgoingEdges("This is a mock response");
        this.completed();
        return;
      }
      console.log(content);

      // Extract the content within the mcp block
      const mcpBlock = content.match(/```mcp\n([\s\S]*?)\n```/);
      if (mcpBlock) {
        content = mcpBlock[1];

        const response = await this.run.callGoalAgent({
          messages: [{ role: "user", content }],
        });

        console.log(response);

        if (response instanceof Error) {
          console.log("Error", response);
          this.error(response.message);
          return;
        }

        this.loadOutgoingEdges(response.content);
        this.completed();
        return;
      }
    }

    let maybeActionName = this.getName(content);
    let namedActionContent = null;

    if (maybeActionName !== null) {
      maybeActionName = maybeActionName.toLowerCase().trim();
      namedActionContent = this.getContentCheckName(content);
    } else {
      maybeActionName = content.toLowerCase().trim();
    }

    if (this.run.actions !== undefined && this.run.actions.length > 0) {
      const action = this.run.actions.find(
        (action) => action.name.toLowerCase().trim() === maybeActionName,
      );

      if (action) {
        let actionResponse: ActionResponse;

        if (action.receive && this.receiveInfo) {
          actionResponse = await this.handleReceiveFunction(action);
        } else {
          actionResponse = await this.prepareAndExecuteAction(
            action,
            namedActionContent,
            config,
          );

          if (actionResponse instanceof Error) {
            if (config.catch) {
              this.error(actionResponse.message);
              return;
            } else {
              actionResponse = actionResponse.message;
            }
          }

          if (action.receive) {
            this.setReceiveInfo(actionResponse ?? {});
            actionResponse = await this.handleReceiveFunction(action);
          } else {
            actionResponse = this.coerceActionResponseToString(actionResponse);
          }
        }

        if (actionResponse instanceof Error) {
          this.error(actionResponse.message);
          return;
        }

        this.loadOutgoingEdges(actionResponse);
        this.completed();
        return;
      }
    }

    const request = this.parseContentToRequest(content, config);
    if (request instanceof Error) {
      this.error(request.message);
      return;
    }

    let response = await this.run.executeHttpRequest(
      request,
      config.timeout as number,
    );

    if (response instanceof Error) {
      if (config.catch) {
        this.error(response.message);
        return;
      }
      response = response.message;
    }

    this.loadOutgoingEdges(response);
    this.completed();
  }

  private async handleReceiveFunction(action: Action): Promise<string | Error> {
    let receiveResponse: string | Error;

    if (this.run.isMock) {
      if (action.resultKeys) {
        const result = action.resultKeys.reduce<Record<string, string>>(
          (acc, key) => {
            acc[key] = "This is a mock response";
            return acc;
          },
          {},
        );
        receiveResponse = this.coerceActionResponseToString(result);
      } else {
        receiveResponse = "This is a mock response";
      }
    } else {
      const result = await action.receive!(this.receiveInfo!);
      receiveResponse = this.coerceActionResponseToString(result);
    }

    return receiveResponse;
  }

  getActionArgs(action: Action): {
    args: string[];
    optionalArgs: Record<string, boolean>;
  } {
    const stringifiedFn = action.function.toString();
    // Match the function body to find the destructured object keys
    const argsMatch = stringifiedFn.match(/\(\s*{([^}]*)}\s*\)\s*=>/);
    const args = argsMatch ? argsMatch[1] : "";

    const requiredArgs = args
      ? args
          .split(",")
          .filter((arg) => !arg.includes("="))
          .map((arg: string) => arg.trim())
      : [];
    const optionalArgs = args
      ? args
          .split(",")
          .filter((arg) => arg.includes("="))
          .map((arg: string) => arg.trim().split("=")[0].trim())
      : [];
    const optionalArgsObject: Record<string, boolean> = {};
    optionalArgs.forEach((arg) => (optionalArgsObject[arg] = true));

    return {
      args: [...requiredArgs, ...optionalArgs],
      optionalArgs: optionalArgsObject,
    };
  }

  private parseContentToRequest(
    content: string,
    config: HttpConfig,
  ): HttpRequest | Error {
    // If the url config is set, look for the method and headers, and interpret the content as the body
    if (config.url) {
      const request: HttpRequest = {
        url: config.url,
        method: config.method || "POST",
        headers: config.headers,
        body: content,
      };
      return request;
    }

    // If the content is wrapped in triple backticks with or without a language identifier, remove them
    content = content.replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1").trim();

    if (
      typeof content === "string" &&
      (content.startsWith("http://") || content.startsWith("https://"))
    ) {
      return { url: content, method: "GET" };
    }

    try {
      const request = JSON.parse(content);

      // Evaluate the request
      try {
        // Check that the template has a url and method
        if (!request.url || !request.method) {
          return new Error(`Request is missing a URL or method.`);
        }

        if (request.headers && typeof request.headers !== "string") {
          request.headers = JSON.stringify(request.headers);
        }

        if (request.body && typeof request.body !== "string") {
          request.body = JSON.stringify(request.body);
        }

        return request;
      } catch (e) {
        return new Error(`Action node does not have a valid HTTP request.`);
      }
    } catch (e) {
      // Continue to next parsing method
    }

    const variables = this.getVariables();
    const template = this.getTemplate(content);
    if (template instanceof Error) {
      return template;
    }

    const request = this.convertTemplateToRequest(template, variables);
    if (request instanceof Error) {
      return request;
    }

    return request;
  }

  private getVariables(): string | Record<string, string> | null {
    let variables: string | Record<string, string> | null = null;

    const variableValues = this.getVariableValues(false);
    if (variableValues.length > 0) {
      variables = {};
      for (const variableValue of variableValues) {
        variables[variableValue.name] = variableValue.content || "";
      }
    }

    return variables;
  }

  private getTemplate(name: string): HttpTemplate | Error {
    for (const objectId in this.graph) {
      const object = this.graph[objectId];
      if (object instanceof FloatingNode && object.getName() === name) {
        // If the text is wrapped in triple backticks with or without a language identifier, remove them
        const text = object
          .getContent()
          .replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1")
          .trim();

        try {
          const template = JSON.parse(text) as HttpTemplate;

          // Check that the template has a url and method
          if (!template.url || !template.method) {
            return new Error(
              `Floating node "${name}" does not have a valid HTTP template.`,
            );
          }

          if (template.headers && typeof template.headers !== "string") {
            template.headers = JSON.stringify(template.headers);
          }

          const bodyValue = template.body ?? template.bodyTemplate;

          if (bodyValue && typeof bodyValue !== "string") {
            template.body = JSON.stringify(bodyValue);
          }

          return template;
        } catch (e) {
          return new Error(
            `Floating node "${name}" could not be parsed as an HTTP template.`,
          );
        }
      }
    }

    const settingsTemplate = this.run.httpTemplates.find(
      (template) => template.name === name,
    );
    if (!settingsTemplate) {
      return new Error(
        `Could not get HTTP template with name "${name}" from floating nodes or pre-set templates.`,
      );
    }

    return settingsTemplate;
  }

  private convertTemplateToRequest(
    template: HttpTemplate,
    variables: string | Record<string, string> | null,
  ): HttpRequest | Error {
    const url = this.replaceVariables(template.url, variables);
    if (url instanceof Error) return url;

    const method = this.replaceVariables(template.method, variables);
    if (method instanceof Error) return method;

    let headers: string | Error | undefined;
    if (template.headers) {
      headers = this.replaceVariables(template.headers, variables);
      if (headers instanceof Error) return headers;
    }

    const bodyTemplate = template.body ?? template.bodyTemplate;
    let body: string | Error = "";

    if (bodyTemplate) {
      body = this.parseBodyTemplate(bodyTemplate, variables || "");
      if (body instanceof Error) {
        return body;
      }
    }

    return {
      url,
      method,
      headers: headers ? (headers as string) : undefined,
      body: method.toLowerCase() !== "get" ? body : undefined,
    };
  }

  private replaceVariables(
    template: string,
    variables: string | Record<string, string> | null,
  ): string | Error {
    template = String(template);

    const variablesInTemplate = (template.match(/\{\{.*?\}\}/g) || []).map(
      (v) => v.slice(2, -2),
    );

    if (typeof variables === "string") {
      return template.replace(/{{.*?}}/g, variables);
    }

    if (variables && typeof variables === "object") {
      for (const variable of variablesInTemplate) {
        if (!(variable in variables)) {
          return new Error(
            `Missing value for variable "${variable}" in available arrows. This part of the template requires the following variables:\n${variablesInTemplate
              .map((v) => `  - ${v}`)
              .join("\n")}`,
          );
        }
        template = template.replace(
          new RegExp(`{{${variable}}}`, "g"),
          variables[variable],
        );
      }
    }

    return template;
  }

  private parseBodyTemplate(
    template: string,
    body: string | Record<string, string>,
  ): string | Error {
    template = String(template);

    const variablesInTemplate = (template.match(/\{\{.*?\}\}/g) || []).map(
      (v) => v.slice(2, -2),
    );

    let parsedTemplate = template;

    if (typeof body === "object") {
      for (const variable of variablesInTemplate) {
        if (!(variable in body)) {
          return new Error(
            `Missing value for variable "${variable}" in available arrows. This body template requires the following variables:\n${variablesInTemplate
              .map((v) => `  - ${v}`)
              .join("\n")}`,
          );
        }
        parsedTemplate = parsedTemplate.replace(
          new RegExp(`{{${variable}}}`, "g"),
          body[variable]
            .replace(/\\/g, "\\\\")
            .replace(/\n/g, "\\n")
            .replace(/"/g, '\\"')
            .replace(/\t/g, "\\t"),
        );
      }
    } else {
      for (const variable of variablesInTemplate) {
        parsedTemplate = parsedTemplate.replace(
          new RegExp(`{{${variable}}}`, "g"),
          body
            .replace(/\\/g, "\\\\")
            .replace(/\n/g, "\\n")
            .replace(/"/g, '\\"')
            .replace(/\t/g, "\\t"),
        );
      }
    }

    return parsedTemplate;
  }
}
