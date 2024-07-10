import { runWithControl } from "./cannoli";
import { FileManager } from "./fileManager";
import { VerifiedCannoliCanvasData } from "./models/graph";
import { LLMConfig } from "./providers";
import { Action, HttpTemplate } from "./run";

export enum CannoliParamType {
    String = "string",
    Array = "array",
    Object = "object",
    Void = "void",
}

export enum CannoliReturnType {
    String = "string",
    Object = "object",
    Void = "void",
}

export type CannoliFunctionInfo = {
    name: string;
    canvasName: string;
    params: Record<string, string>;
    returns: Record<string, string>;
    description: string;
    paramType: CannoliParamType;
    returnType: CannoliReturnType;
}

export type BakeRuntime = "node" | "deno" | "bun";

export type BakeLanguage = "typescript" | "javascript";

export async function bake({
    language,
    runtime,
    changeIndentToFour,
    cannoli,
    canvasName,
    llmConfigs,
    config,
    envVars,
    actions,
    httpTemplates,
    dynamicParamAndReturnTypes,
    includeTypes,
    includeMetadata,
    forValtown,
    fileManager,
    // replacers,
    // fetcher,
}: {
    language: BakeLanguage,
    runtime: BakeRuntime,
    canvasName: string,
    cannoli: unknown,
    llmConfigs: LLMConfig[],
    fileManager?: FileManager,
    config?: Record<string, string | number | boolean>,
    envVars?: Record<string, string>,
    changeIndentToFour?: boolean,
    actions?: Action[],
    httpTemplates?: HttpTemplate[],
    dynamicParamAndReturnTypes?: boolean;
    includeTypes?: boolean;
    includeMetadata?: boolean;
    forValtown?: boolean;
    // replacers?: Replacer[],
    // fetcher?: ResponseTextFetcher,
}): Promise<{
    fileName: string;
    code: string;
    cannoliInfo: CannoliFunctionInfo
} | Error> {
    // Mock run the cannoli
    const [done] = await runWithControl({
        cannoli,
        llmConfigs,
        config,
        envVars,
        isMock: true,
        actions,
        httpTemplates,
        // replacers,
        // fetcher,
    });

    const stoppage = await done;

    if (stoppage.reason == "error") {
        return new Error("There's an error in the cannoli. Please fix it before baking.");
    }

    // TODO: Implement getting param and result descriptions from the stoppage
    const argNames: string[] = stoppage.argNames;
    const resultNames: string[] = stoppage.resultNames;

    let paramType: CannoliParamType;
    let returnType: CannoliReturnType;

    if (dynamicParamAndReturnTypes) {
        paramType = argNames.length === 1
            ? CannoliParamType.String
            : argNames.length > 1 && argNames.length < 4
                ? CannoliParamType.Array
                : argNames.length >= 4
                    ? CannoliParamType.Object
                    : CannoliParamType.Void;

        returnType = resultNames.length === 1
            ? CannoliReturnType.String
            : resultNames.length > 1
                ? CannoliReturnType.Object
                : CannoliReturnType.Void;
    } else {
        paramType = argNames.length > 0 ? CannoliParamType.Object : CannoliParamType.Void;
        returnType = resultNames.length > 0 ? CannoliReturnType.Object : CannoliReturnType.Void;
    }

    const functionName = toCamelCase(canvasName);

    const cannoliInfo: CannoliFunctionInfo = {
        name: functionName,
        canvasName: canvasName,
        params: Object.fromEntries(argNames.map((name) => [name, ""])) as Record<string, string>,
        returns: Object.fromEntries(resultNames.map((name) => [name, ""])) as Record<string, string>,
        description: stoppage.description || "",
        paramType: paramType,
        returnType: returnType,
    };

    // Filter out llmconfig without baseURL or apiKey
    const llmConfigsWithBaseURLorAPIKey = llmConfigs?.filter((config) => config.baseURL || config.apiKey)

    // Filter out llmconfig who's provider is not in stoppage.providersReferenced, except for the first one
    const llmConfigsWithReferencedProvider = llmConfigsWithBaseURLorAPIKey?.filter((config, index) => stoppage.providersReferenced.names.includes(config.provider) || index === 0);

    // Filter out actions without importInfo
    const actionsWithImportInfo = actions?.filter((action) => action.importInfo);

    const actionsOrHttpTemplatesReferenced = stoppage.actionsOrHttpTemplatesReferenced;

    // Filter out actions and http templates that are not referenced
    const referencedActions = actionsWithImportInfo?.filter((action) => actionsOrHttpTemplatesReferenced.names.includes(action.name));
    const referencedHttpTemplates = httpTemplates?.filter((template) => actionsOrHttpTemplatesReferenced.names.includes(template.name));

    const envVarsReferenced: string[] = [];

    // Check each env var
    outerLoop:
    for (const [key] of Object.entries(envVars || {})) {
        for (const action of referencedActions || []) {
            if (action.argInfo && Object.keys(action.argInfo).includes(key)) {
                envVarsReferenced.push(key);
                continue outerLoop;
            }
        }

        for (const template of referencedHttpTemplates || []) {
            if (template.url && template.url.includes(`{{${key}}}`)) {
                envVarsReferenced.push(key);
                continue outerLoop;
            }
            if (template.headers && template.headers.includes(`{{${key}}}`)) {
                envVarsReferenced.push(key);
                continue outerLoop;
            }
            if (template.body && template.body.includes(`{{${key}}}`)) {
                envVarsReferenced.push(key);
                continue outerLoop;
            }
            if (template.bodyTemplate && template.bodyTemplate.includes(`{{${key}}}`)) {
                envVarsReferenced.push(key);
                continue outerLoop;
            }
        }

        // Check if {{key}} is in the cannoli
        if (JSON.stringify(cannoli).includes(`{{${key}}}`)) {
            envVarsReferenced.push(key);
            continue outerLoop;
        }
    }

    const filteredEnvVars = Object.fromEntries(
        Object.entries(envVars || {}).filter(([key]) => envVarsReferenced.includes(key))
    );

    const result = writeCode({
        language,
        runtime,
        changeIndentToFour,
        cannoli: cannoli as VerifiedCannoliCanvasData,
        llmConfigs: llmConfigsWithReferencedProvider,
        cannoliInfo,
        functionName,
        config,
        envVars: filteredEnvVars,
        actions: referencedActions,
        httpTemplates: referencedHttpTemplates,
        includeTypes,
        includeMetadata,
        forValtown,
    });

    if (result instanceof Error) {
        return result;
    }

    // const apiKeyWarning = checkForAPIKeys(result.code);

    return {
        ...result,
        // apiKeyWarning: apiKeyWarning ?? undefined,
    };
}

// function checkForAPIKeys(code: string): string | null {
//     const apiKeyPatterns = [
//         /['"]?api[_-]?key['"]?\s*[:=]\s*['"][a-zA-Z0-9-_]{20,}['"]/i,
//         /['"]?secret['"]?\s*[:=]\s*['"][a-zA-Z0-9-_]{20,}['"]/i,
//         /['"]?token['"]?\s*[:=]\s*['"][a-zA-Z0-9-_]{20,}['"]/i,
//     ];

//     const lines = code.split('\n');
//     const suspiciousLines: number[] = [];

//     lines.forEach((line, index) => {
//         if (apiKeyPatterns.some(pattern => pattern.test(line))) {
//             suspiciousLines.push(index + 1); // Line numbers start at 1
//         }
//     });

//     if (suspiciousLines.length > 0) {
//         return `Please check the following lines in the resulting code for possible API keys before sharing the baked cannoli anywhere: ${suspiciousLines.join(', ')}.`;
//     }

//     return null;
// }

export function writeCode({
    language,
    runtime,
    cannoli,
    llmConfigs,
    cannoliInfo,
    config,
    envVars,
    functionName,
    changeIndentToFour,
    actions,
    httpTemplates,
    includeTypes,
    includeMetadata,
    forValtown,
    // replacers,
    // fetcher,
}: {
    language: BakeLanguage;
    runtime: BakeRuntime;
    cannoli: VerifiedCannoliCanvasData;
    llmConfigs: LLMConfig[];
    functionName: string;
    cannoliInfo: CannoliFunctionInfo;
    config?: Record<string, string | number | boolean>;
    envVars?: Record<string, string>;
    changeIndentToFour?: boolean;
    actions?: Action[];
    httpTemplates?: HttpTemplate[];
    includeTypes?: boolean;
    includeMetadata?: boolean;
    forValtown?: boolean;
    // replacers?: Replacer[];
    // fetcher?: ResponseTextFetcher;
}): {
    fileName: string;
    code: string;
    cannoliInfo: CannoliFunctionInfo;
} | Error {
    if (forValtown) {
        includeMetadata = true;
    }

    const valtownHttpCode = generateValtownHttpCode(cannoliInfo);
    const metadata = generateMetadata(cannoliInfo);
    const importTemplate = generateImportTemplates(language, runtime, actions);
    const availableArgs = ['cannoli', 'llmConfigs'];

    let llmConfigTemplate = "";
    if (llmConfigs) {
        llmConfigTemplate = `const llmConfigs${language === "typescript" ? ": LLMConfig[]" : ""} = ${printLLMConfigWithEnvReference(llmConfigs, runtime)};\n`;
    }

    let envVarTemplate = "";
    if (envVars && Object.keys(envVars).length > 0) {
        availableArgs.push('envVars');
        envVarTemplate = generateEnvVarTemplate(runtime, envVars);
    }

    let configTemplate = "";
    if (config && Object.keys(config).length > 0) {
        availableArgs.push('config');
        configTemplate = `\nconst config = ${JSON.stringify(config, null, 2)};\n`;
    }

    let actionsTemplate = "";
    if (actions && actions.length > 0) {
        availableArgs.push('actions');
        const actionNames = actions.map((action) => action.importInfo?.name);
        actionsTemplate = `\nconst actions = [\n  ${actionNames.join(",\n  ")}\n];\n`
    }

    let httpTemplatesTemplate = "";
    if (httpTemplates && httpTemplates.length > 0) {
        availableArgs.push('httpTemplates');
        httpTemplatesTemplate = `\nconst httpTemplates = ${JSON.stringify(httpTemplates, null, 2)};\n`
    }

    const optionalArgTemplates = `${envVarTemplate}${configTemplate}${actionsTemplate}${httpTemplatesTemplate}`.trim();

    const argDeclarations = `${optionalArgTemplates}${llmConfigTemplate}
const cannoli = ${JSON.stringify(cannoli, null, 2)};`;

    const generatedFunction = generateFunction(cannoliInfo, language, argDeclarations, availableArgs, includeTypes, forValtown);

    const code = `${includeMetadata ? metadata : ''}${importTemplate}${forValtown ? valtownHttpCode : ''}
${generatedFunction}
`;
    const cleanedCode = cleanCode(code, changeIndentToFour);

    return {
        fileName: `${functionName}.${language === "typescript" ? "ts" : "js"}`,
        code: cleanedCode,
        cannoliInfo,
    };
}

export function parseCannoliFunctionInfo(fileContent: string): CannoliFunctionInfo | null {
    if (!fileContent.startsWith("/**\n * @cannoli")) {
        return null;
    }

    const commentBlockMatch = fileContent.match(/\/\*\*([\s\S]*?)\*\//);
    if (!commentBlockMatch) {
        return null;
    }

    const commentBlock = commentBlockMatch[1];
    const lines = commentBlock.split('\n');
    let name = '';
    let canvasName = '';
    let description = '';
    const params: Record<string, string> = {};
    const returns: Record<string, string> = {};
    let paramType: CannoliParamType | null = null;
    let returnType: CannoliReturnType | null = null;

    let inDescription = false;

    for (const line of lines) {
        const cannoliMatch = line.match(/\* @cannoli (\S+)/);
        if (cannoliMatch) {
            name = cannoliMatch[1];
        }

        const canvasMatch = line.match(/\* @canvas (.+)/);
        if (canvasMatch) {
            canvasName = canvasMatch[1];
        }

        const descriptionMatch = line.match(/\* @description (.+)/);
        if (descriptionMatch) {
            description += descriptionMatch[1] + '\n';
            inDescription = true;
            continue;
        }

        if (inDescription) {
            const nextTagMatch = line.match(/\* @/);
            if (nextTagMatch) {
                inDescription = false;
            } else {
                description += line.replace(/^\s*\*/, '').trim() + '\n';
                continue;
            }
        }

        const paramMatch = line.match(/\* @param (\S+)(?: - (.*))?/);
        if (paramMatch) {
            params[paramMatch[1]] = paramMatch[2] ? paramMatch[2].trim() : '';
        }

        const returnMatch = line.match(/\* @return (\S+)(?: - (.*))?/);
        if (returnMatch) {
            returns[returnMatch[1]] = returnMatch[2] ? returnMatch[2].trim() : '';
        }

        const paramTypeMatch = line.match(/\* @paramType (\S+)/);
        if (paramTypeMatch) {
            paramType = CannoliParamType[paramTypeMatch[1] as keyof typeof CannoliParamType] || CannoliParamType.Object;
        }

        const returnTypeMatch = line.match(/\* @returnType (\S+)/);
        if (returnTypeMatch) {
            returnType = CannoliReturnType[returnTypeMatch[1] as keyof typeof CannoliReturnType] || CannoliReturnType.Object;
        }
    }

    if (!name) {
        return null;
    }

    // Infer paramType if not explicitly set
    if (paramType === null) {
        paramType = Object.keys(params).length > 0 ? CannoliParamType.Object : CannoliParamType.Void;
    }

    // Infer returnType if not explicitly set
    if (returnType === null) {
        returnType = Object.keys(returns).length > 0 ? CannoliReturnType.Object : CannoliReturnType.Void;
    }

    return {
        name,
        canvasName: canvasName.trim(),
        description: description.trim(),
        params,
        returns,
        paramType,
        returnType,
    };
}

export async function callCannoliFunction(
    func: (...args: unknown[]) => unknown,
    cannoliInfo: CannoliFunctionInfo,
    params: Record<string, string> | string | undefined,
): Promise<Record<string, string>> {
    const { paramType, returnType, params: requiredParams } = cannoliInfo;

    // Validate params based on paramType
    switch (paramType) {
        case CannoliParamType.String:
            if (typeof params !== 'string') {
                throw new Error(`Expected a single string parameter for function ${cannoliInfo.name}.`);
            }
            break;

        case CannoliParamType.Array:
            if (!Array.isArray(params)) {
                throw new Error(`Expected an array of parameters for function ${cannoliInfo.name}.`);
            }
            break;

        case CannoliParamType.Object: {
            if (typeof params !== 'object' || params === null) {
                throw new Error(`Expected an object of parameters for function ${cannoliInfo.name}.`);
            }
            const missingParams = Object.keys(requiredParams).filter(key => !(key in params));
            if (missingParams.length > 0) {
                throw new Error(`Missing required parameters: ${missingParams.join(', ')} for function ${cannoliInfo.name}.`);
            }
            break;
        }
        case CannoliParamType.Void:
            if (params !== undefined) {
                throw new Error(`Expected no parameters for function ${cannoliInfo.name}.`);
            }
            break;

        default:
            throw new Error(`Unknown parameter type for function ${cannoliInfo.name}.`);
    }

    // Call the function with the correct parameters
    let result;
    switch (paramType) {
        case CannoliParamType.String:
            result = await func(params);
            break;
        case CannoliParamType.Array: {
            const paramArray: string[] = [];
            if (typeof params === 'object' && params) {
                paramArray.push(...Object.values(params));
            } else if (typeof params === 'string') {
                paramArray.push(params);
            }

            result = await func(...paramArray);
            break;
        }
        case CannoliParamType.Object:
            result = await func(params);
            break;
        case CannoliParamType.Void:
            result = await func();
            break;
    }

    // Ensure the return type is a Record<string, string>
    if (returnType === CannoliReturnType.Void) {
        return {};
    } else if (returnType === CannoliReturnType.String) {
        return { result: result as string };
    } else if (returnType === CannoliReturnType.Object) {
        return result as Record<string, string>;
    } else {
        throw new Error(`Unknown return type for function ${cannoliInfo.name}.`);
    }
}

function generateMetadata(cannoliInfo: CannoliFunctionInfo): string {
    const description = cannoliInfo.description
        ? ` * @description ${cannoliInfo.description.split('\n').join('\n * ')}\n`
        : '';

    const params = cannoliInfo.params && Object.keys(cannoliInfo.params).length > 0
        ? Object.entries(cannoliInfo.params)
            .map(([name, desc]) => ` * @param ${name} ${desc}`)
            .join('\n') + '\n'
        : '';

    const returns = cannoliInfo.returns && Object.keys(cannoliInfo.returns).length > 0
        ? Object.entries(cannoliInfo.returns)
            .map(([name, desc]) => ` * @return ${name} ${desc}`)
            .join('\n') + '\n'
        : '';

    return `/**
 * @cannoli ${cannoliInfo.name}
 * @canvas ${cannoliInfo.canvasName}
${description}${params}${returns}`.trim() + `\n */\n\n`;
}

function generateValtownHttpCode(cannoliInfo: CannoliFunctionInfo): string {
    const { name, paramType, params } = cannoliInfo;
    const requiredParams = Object.keys(params);

    const transformParams = (paramType: CannoliParamType, requiredParams: string[]): string => {
        switch (paramType) {
            case CannoliParamType.String:
                return `
  const params = await req.json();
  if (typeof params !== 'object' || !params.hasOwnProperty('${requiredParams[0]}')) {
    return new Response("Invalid parameters: expected an object with a single string property '${requiredParams[0]}'", { status: 400 });
  }
  const result = await ${name}(params['${requiredParams[0]}']);`;
            case CannoliParamType.Array:
                return `
  const params = await req.json();
  if (typeof params !== 'object' || !Array.isArray(params['${requiredParams[0]}'])) {
    return new Response("Invalid parameters: expected an object with an array property '${requiredParams[0]}']", { status: 400 });
  }
  const result = await ${name}(params['${requiredParams[0]}']);`;
            case CannoliParamType.Object:
                return `
  const params = await req.json();
  if (typeof params !== 'object') {
    return new Response("Invalid parameters: expected an object with the string properties: ${requiredParams.join(', ')}", { status: 400 });
  }
  const missingParams = ${JSON.stringify(requiredParams)}.filter(param => !(param in params));
  if (missingParams.length > 0) {
    return new Response(\`Missing required parameters: \${missingParams.join(', ')}.\`, { status: 400 });
  }
  const result = await ${name}(params);`;
            case CannoliParamType.Void:
            default:
                return `
  const result = await ${name}();`;
        }
    };

    const paramTransformationCode = transformParams(paramType, requiredParams);

    return `
export default async function(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  if (token !== Deno.env.get("valtown")) {
    return new Response("Unauthorized", { status: 401 });
  }${paramTransformationCode}

  return Response.json({ ok: true, result });
}
`;
}

function generateCommentBlock(cannoliInfo: CannoliFunctionInfo, includeTypes?: boolean): string {
    const formatDescription = (desc?: string) => desc ? desc.split('\n').map(line => ` * ${line}`).join('\n') : '';
    const capitalizedCannoliName = cannoliInfo.name.charAt(0).toUpperCase() + cannoliInfo.name.slice(1);

    let commentBlock = cannoliInfo.description ? `/**\n${formatDescription(cannoliInfo.description)}\n` : `/**\n`;

    // Add cannoli metadata
    commentBlock += "";

    const args = Object.keys(cannoliInfo.params);

    switch (cannoliInfo.paramType) {
        case CannoliParamType.Object: {
            const argNames = args.join(', ');
            if (includeTypes) {
                commentBlock += ` * @param {${capitalizedCannoliName}Params} params - ${argNames}\n`;
            } else {
                commentBlock += ` * @param {${argNames}}\n`;
            }
            break;
        }
        case CannoliParamType.Array:
        case CannoliParamType.String:
            for (const [arg, description] of Object.entries(cannoliInfo.params)) {
                commentBlock += ` * @param {string} ${arg}${description ? ` - ${description}` : ''}\n`;
            }
            break;
        case CannoliParamType.Void:
        default:
            break;
    }

    switch (cannoliInfo.returnType) {
        case CannoliReturnType.Object: {
            const resultNames = Object.keys(cannoliInfo.returns).join(', ');
            if (includeTypes) {
                commentBlock += ` * @returns {Promise<${capitalizedCannoliName}Return>} ${resultNames}\n`;
            } else {
                commentBlock += ` * @returns {Promise<{${resultNames}}>}\n`;
            }
            break;
        }
        case CannoliReturnType.String: {
            const [result, description] = Object.entries(cannoliInfo.returns)[0];
            commentBlock += ` * @returns {Promise<string>} ${result}${description ? ` - ${description}` : ''}\n`;
            break;
        }
        case CannoliReturnType.Void:
        default:
            commentBlock += ` * @returns {Promise<void>}\n`;
            break;
    }

    commentBlock += ` */`;

    return commentBlock;
}

function generateTypeDefinitions(cannoliInfo: CannoliFunctionInfo, language: BakeLanguage): string {
    const args = Object.keys(cannoliInfo.params);
    const argsType = args.map(arg => `${arg}: string;`).join("\n  ");
    const resultType = Object.keys(cannoliInfo.returns).map(result => `${result}: string`).join(";\n  ") + ";";

    let argTypeDef = '';
    let resultTypeDef = '';

    if (language === "typescript") {
        if (cannoliInfo.paramType === CannoliParamType.Object && args.length > 0) {
            argTypeDef = `export type ${cannoliInfo.name.charAt(0).toUpperCase() + cannoliInfo.name.slice(1)}Params = {\n  ${argsType}\n};\n\n`;
        }

        if (cannoliInfo.returnType === CannoliReturnType.Object && Object.keys(cannoliInfo.returns).length > 0) {
            resultTypeDef = `export type ${cannoliInfo.name.charAt(0).toUpperCase() + cannoliInfo.name.slice(1)}Return = {\n  ${resultType}\n};\n\n`;
        }
    } else {
        if (cannoliInfo.paramType === CannoliParamType.Object && args.length > 0) {
            argTypeDef = `/**\n * @typedef {Object} ${cannoliInfo.name.charAt(0).toUpperCase() + cannoliInfo.name.slice(1)}Params\n${args.map(arg => ` * @property {string} ${arg}`).join("\n")}\n */\n\n`;
        }

        if (cannoliInfo.returnType === CannoliReturnType.Object && Object.keys(cannoliInfo.returns).length > 0) {
            resultTypeDef = `/**\n * @typedef {Object} ${cannoliInfo.name.charAt(0).toUpperCase() + cannoliInfo.name.slice(1)}Return\n${Object.keys(cannoliInfo.returns).map(result => ` * @property {string} ${result}`).join("\n")}\n */\n\n`;
        }
    }

    return `${argTypeDef}${resultTypeDef}`;
}

function generateFunctionSignature(cannoliInfo: CannoliFunctionInfo, language: BakeLanguage, includeTypes?: boolean, notDefault?: boolean): string {
    const { paramType, returnType, name, params, returns } = cannoliInfo;
    const args = Object.keys(params);
    const returnNames = Object.keys(returns);

    let argsString: string;
    switch (paramType) {
        case CannoliParamType.String:
            argsString = args.map(arg => `${arg}${language === "typescript" ? ": string" : ""}`).join(", ");
            break;
        case CannoliParamType.Array:
            argsString = `\n  ${args.map(arg => `${arg}${language === "typescript" ? ": string" : ""}`).join(",\n  ")}\n`;
            break;
        case CannoliParamType.Object:
            if (language === "typescript") {
                if (includeTypes) {
                    argsString = `params: ${name.charAt(0).toUpperCase() + name.slice(1)}Params`;
                } else {
                    argsString = `{\n  ${args.join(",\n  ")}\n}: {\n  ${args.map(arg => `${arg}: string`).join(",\n  ")}\n}`;
                }
            } else {
                argsString = `{\n  ${args.join(",\n  ")}\n}`;
            }
            break;
        case CannoliParamType.Void:
        default:
            argsString = "";
            break;
    }

    let returnTypeString: string;
    switch (returnType) {
        case CannoliReturnType.String:
            returnTypeString = "string";
            break;
        case CannoliReturnType.Object:
            if (includeTypes) {
                returnTypeString = `${name.charAt(0).toUpperCase() + name.slice(1)}Return`;
            } else {
                returnTypeString = returnNames.length > 0 ? `{\n  ${returnNames.map(returnName => `${returnName}: string`).join(",\n  ")}\n}` : "";
            }
            break;
        case CannoliReturnType.Void:
        default:
            returnTypeString = "void";
            break;
    }

    if (language === "typescript") {
        return `export${notDefault ? "" : "default"} async function ${name}(${argsString}): Promise<${returnTypeString}>`;
    } else {
        switch (paramType) {
            case CannoliParamType.Object:
                return `export${notDefault ? "" : "default"} async function ${name}({\n  ${args.join(",\n  ")}\n})`;
            case CannoliParamType.Array:
                return `export${notDefault ? "" : "default"} async function ${name}(\n  ${args.join(",\n  ")}\n)`;
            case CannoliParamType.String:
                return `export${notDefault ? "" : "default"} async function ${name}(${argsString})`;
            case CannoliParamType.Void:
            default:
                return `export${notDefault ? "" : "default"} async function ${name}()`;
        }
    }
}

function generateReturnStatement(cannoliInfo: CannoliFunctionInfo): string {
    const { returnType, returns } = cannoliInfo;

    switch (returnType) {
        case CannoliReturnType.String: {
            const [result] = Object.keys(returns);
            return `return runResult["${result}"];`;
        }

        case CannoliReturnType.Object: {
            const returnNames = Object.keys(returns);
            const returnObject = returnNames
                .map(result => `    ${result}: runResult["${result}"]`)
                .join(",\n");
            return returnNames.length > 0 ? `return {\n${returnObject}\n  };` : "return {};";
        }

        case CannoliReturnType.Void:
        default:
            return `return;`;
    }
}

function generateRunFunctionCall(cannoliInfo: CannoliFunctionInfo, availableArgs: string[], language: BakeLanguage, includeTypes?: boolean): string {
    const { paramType, params } = cannoliInfo;
    const args = Object.keys(params);

    let runArgs = '';

    if (language === "typescript") {
        switch (paramType) {
            case CannoliParamType.String:
            case CannoliParamType.Array:
                runArgs = `  args: {
      ${args.join(",\n      ")}
    }`;
                break;
            case CannoliParamType.Object:
                if (includeTypes) {
                    runArgs = `  args: params`;
                } else {
                    runArgs = `  args: {\n      ${args.join(",\n      ")}\n    }`;
                }
                break;
            case CannoliParamType.Void:
            default:
                runArgs = '';
                break;
        }
    } else {
        switch (paramType) {
            case CannoliParamType.String:
            default:
                runArgs = `  args: {
      ${args.join(",\n      ")}
    }`;
                break;
        }
    }

    const additionalArgs = availableArgs.map(arg => `  ${arg}`).join(",\n  ");
    const allArgs = [runArgs, additionalArgs].filter(Boolean).join(",\n  ");

    return `  const runResult = await run({
  ${allArgs}
  });`;
}

function generateFunction(cannoliInfo: CannoliFunctionInfo, language: BakeLanguage, argDeclarations: string, availableArgs: string[], includeTypes?: boolean, notDefault?: boolean): string | Error {
    const typeDefinitions = generateTypeDefinitions(cannoliInfo, language);
    const commentBlock = generateCommentBlock(cannoliInfo, includeTypes);
    const functionSignature = generateFunctionSignature(cannoliInfo, language, includeTypes, notDefault);
    const returnStatement = generateReturnStatement(cannoliInfo);
    const runFunctionCall = generateRunFunctionCall(cannoliInfo, availableArgs, language, includeTypes);

    const functionBody = `
${includeTypes ? typeDefinitions : ""}${commentBlock}
${functionSignature} {
${indent(argDeclarations, "  ")}

${runFunctionCall}

  ${returnStatement}
}
`.trim();

    return functionBody;
}

function generateImportTemplates(language: BakeLanguage, runtime: BakeRuntime, actions?: Action[]): string {
    const importMap: Record<string, string[]> = {};

    // Add LLMConfig import if language is TypeScript
    const corePath = runtime === "node" ? "@deablabs/cannoli-core" : "npm:@deablabs/cannoli-core";
    if (language === "typescript") {
        importMap[corePath] = ["LLMConfig", "run"];
    } else {
        importMap[corePath] = ["run"];
    }

    // Add action imports
    if (actions) {
        actions.forEach(action => {
            let importPath = action.importInfo?.path || "Paste import path or implement action";
            if (runtime === "node" && importPath.startsWith("npm:")) {
                importPath = importPath.replace(/^npm:/, "");
            }
            if (!importMap[importPath]) {
                importMap[importPath] = [];
            }
            importMap[importPath].push(action.importInfo?.name || "UnknownAction");
        });
    }

    // Build the import statements
    const importStatements = Object.entries(importMap).map(([path, imports]) => {
        if (language === "typescript") {
            if (imports.length > 4) {
                return `import {\n  ${imports.join(",\n  ")}\n} from "${path}";\n`;
            } else {
                return `import { ${imports.join(", ")} } from "${path}";\n`;
            }
        } else {
            if (imports.length > 4) {
                return `const {\n  ${imports.join(",\n  ")}\n} = require("${path}");\n`;
            } else {
                return `const { ${imports.join(", ")} } = require("${path}");\n`;
            }
        }
    }).join("");

    // Add dotenv import and config call if runtime is node
    const dotenvConfig = runtime === "node" ? (language === "typescript" ? `import dotenv from 'dotenv';\n\ndotenv.config();\n` : `const dotenv = require('dotenv');\ndotenv.config();\n`) : '';

    // Generate copyable command for installing packages
    let installCommand = '';
    if (runtime === "node") {
        const packageList = [...Object.keys(importMap), 'dotenv'].join(' ');
        installCommand = `\n// To install the necessary packages, run:\n// npm install ${packageList}\n// or\n// yarn add ${packageList}\n`;
    }

    return `${importStatements}${dotenvConfig}${installCommand}`;
}

function generateEnvVarTemplate(runtime: BakeRuntime, envVars: Record<string, string>): string {
    const envVarLines = Object.keys(envVars).map(key => {
        switch (runtime) {
            case "node":
                return `${key}: process.env.${key},`;
            case "deno":
                return `${key}: Deno.env.get("${key}"),`;
            case "bun":
                return `${key}: Bun.env.${key},`;
            default:
                throw new Error(`Unsupported runtime: ${runtime}`);
        }
    }).join("\n  ");

    return `
const envVars = {
  ${envVarLines}
};
`;
}

function printLLMConfigWithEnvReference(
    llmConfigs: LLMConfig[],
    runtime: BakeRuntime
): string {
    const updatedConfigs = llmConfigs.map(config => {
        const envKey = `${config.provider.toUpperCase()}_API_KEY`;
        let envReference;
        switch (runtime) {
            case "node":
                envReference = `process.env.${envKey}`;
                break;
            case "deno":
                envReference = `Deno.env.get("${envKey}")`;
                break;
            case "bun":
                envReference = `Bun.env.${envKey}`;
                break;
            default:
                throw new Error(`Unsupported runtime: ${runtime}`);
        }

        // Stringify the config without the apiKey
        const { apiKey, ...restConfig } = config;
        let configString = JSON.stringify(restConfig, null, 2);

        // Inject the apiKey line if it should be included
        if (apiKey) {
            const lines = configString.split('\n');
            const lastLineIndex = lines.length - 1;
            lines[lastLineIndex - 1] += ','; // Add comma to the line before the last line
            lines.splice(lastLineIndex, 0, `  "apiKey": ${envReference}`);
            configString = lines.join('\n');
        }

        return configString;
    });

    const items = updatedConfigs.join(",\n");

    // Indent every line
    const indentedItems = items.split('\n').map(line => `  ${line}`).join('\n');

    return `[\n${indentedItems}\n]`;
}

function toCamelCase(str: string): string {
    const reservedKeywords = new Set([
        "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield"
    ]);

    // Drop everything after periods
    str = str.split('.')[0];

    let camelCased = str
        .replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '');

    if (reservedKeywords.has(camelCased)) {
        camelCased += "Cannoli";
    }

    return camelCased.charAt(0).toLowerCase() + camelCased.slice(1);
}

function indent(str: string, indentation: string): string {
    return str.split('\n').map(line => `${indentation}${line}`).join('\n');
}

function cleanCode(code: string, changeIndentToFour: boolean = false): string {
    const lines = code.split('\n');

    const cleanedLines = lines.map(line => {
        // Trim whitespace at the ends of lines
        let cleanedLine = line.trimEnd();

        // If the line contains only whitespace, make it empty
        if (/^\s*$/.test(cleanedLine)) {
            cleanedLine = '';
        }

        if (changeIndentToFour) {
            const match = cleanedLine.match(/^(\s+)/);
            if (match) {
                const spaces = match[1].length;
                if (spaces % 2 === 0) {
                    cleanedLine = ' '.repeat(spaces * 2) + cleanedLine.trimStart();
                }
            }
        }

        return cleanedLine;
    });

    return cleanedLines.join('\n');
}
