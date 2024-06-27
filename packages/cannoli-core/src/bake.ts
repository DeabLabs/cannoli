import { nanoid } from "nanoid";
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

export type CannoliInfo = {
    id: string;
    functionName: string;
    displayName: string;
    // Values are the param's description
    params: Record<string, string>;
    // Values are the return's description
    returns: Record<string, string>;
    paramType: CannoliParamType;
    returnType: CannoliReturnType;
    description: string;
}

export type BakeRuntime = "node" | "deno" | "bun";

export type BakeLanguage = "typescript" | "javascript";

export async function bake({
    language,
    runtime,
    changeIndentToFour,
    cannoli,
    displayName,
    llmConfigs,
    config,
    envVars,
    actions,
    httpTemplates,
    fileManager,
    includeCannoliInfo,
    includeTypeAnnotation,
    // replacers,
    // fetcher,
}: {
    language: BakeLanguage,
    runtime: BakeRuntime,
    displayName: string,
    cannoli: unknown,
    llmConfigs: LLMConfig[],
    fileManager?: FileManager,
    config?: Record<string, string | number | boolean>,
    envVars?: Record<string, string>,
    changeIndentToFour?: boolean,
    actions?: Action[],
    httpTemplates?: HttpTemplate[],
    includeCannoliInfo?: boolean,
    includeTypeAnnotation?: boolean,
    // replacers?: Replacer[],
    // fetcher?: ResponseTextFetcher,
}): Promise<{
    fileName: string;
    code: string;
    cannoliInfo: CannoliInfo
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

    const paramType = argNames.length === 1
        ? CannoliParamType.String
        : argNames.length > 1 && argNames.length < 4
            ? CannoliParamType.Array
            : argNames.length >= 4
                ? CannoliParamType.Object
                : CannoliParamType.Void;

    const returnType = resultNames.length === 1
        ? CannoliReturnType.String
        : resultNames.length > 1
            ? CannoliReturnType.Object
            : CannoliReturnType.Void;

    const functionName = toCamelCase(displayName);

    const cannoliInfo: CannoliInfo = {
        id: nanoid(),
        functionName: functionName,
        displayName: displayName,
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
        includeCannoliInfo,
        includeTypeAnnotation,
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
    includeCannoliInfo,
    includeTypeAnnotation,
    // replacers,
    // fetcher,
}: {
    language: BakeLanguage;
    runtime: BakeRuntime;
    cannoli: VerifiedCannoliCanvasData;
    llmConfigs: LLMConfig[];
    functionName: string;
    cannoliInfo: CannoliInfo;
    config?: Record<string, string | number | boolean>;
    envVars?: Record<string, string>;
    changeIndentToFour?: boolean;
    actions?: Action[];
    httpTemplates?: HttpTemplate[];
    includeCannoliInfo?: boolean;
    includeTypeAnnotation?: boolean;
    // replacers?: Replacer[];
    // fetcher?: ResponseTextFetcher;
}): {
    fileName: string;
    code: string;
    cannoliInfo: CannoliInfo;
} | Error {
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

    const argDeclarations = `${optionalArgTemplates}

${llmConfigTemplate}
const cannoli = ${JSON.stringify(cannoli, null, 2)};`;

    const generatedFunction = generateFunction(cannoliInfo, language, argDeclarations, availableArgs);

    const typeAnnotation = includeTypeAnnotation ? "// TYPE: cannoli\n\n" : "";

    const cannoliInfoDeclaration = includeCannoliInfo ? `\n\nexport const cannoliInfo${language === "typescript" ? ": CannoliInfo" : ""} = ${JSON.stringify(cannoliInfo, null, 2)};` : "";

    const code = `${typeAnnotation}${importTemplate}
${generatedFunction}${cannoliInfoDeclaration}
`;

    const cleanedCode = cleanCode(code, changeIndentToFour);

    return {
        fileName: `${functionName}.${language === "typescript" ? "ts" : "js"}`,
        code: cleanedCode,
        cannoliInfo,
    };
}

function generateCommentBlock(cannoliInfo: CannoliInfo, language: BakeLanguage): string {
    const formatDescription = (desc?: string) => desc ? desc.split('\n').map(line => ` * ${line}`).join('\n') : '';
    const capitalizedCannoliName = cannoliInfo.functionName.charAt(0).toUpperCase() + cannoliInfo.functionName.slice(1);

    let commentBlock = cannoliInfo.description ? `/**\n${formatDescription(cannoliInfo.description)}\n` : `/**\n`;

    const args = Object.keys(cannoliInfo.params);

    if (language === "typescript") {
        switch (cannoliInfo.paramType) {
            case CannoliParamType.Object: {
                const argNames = args.join(', ');
                commentBlock += ` * @param {${capitalizedCannoliName}Args} args - ${argNames}\n`;
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
                commentBlock += ` * @returns {${capitalizedCannoliName}Results} ${resultNames}\n`;
                break;
            }
            case CannoliReturnType.String: {
                const [result, description] = Object.entries(cannoliInfo.returns)[0];
                commentBlock += ` * @returns {string} ${result}${description ? ` - ${description}` : ''}\n`;
                break;
            }
            case CannoliReturnType.Void:
            default:
                commentBlock += ` * @returns {void}\n`;
                break;
        }
    } else {
        switch (cannoliInfo.paramType) {
            case CannoliParamType.Object: {
                const argNames = args.join(', ');
                commentBlock += ` * @param {${capitalizedCannoliName}Args} args - ${argNames}\n`;
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
                commentBlock += ` * @returns {${capitalizedCannoliName}Results} ${resultNames}\n`;
                break;
            }
            case CannoliReturnType.String: {
                const [result, description] = Object.entries(cannoliInfo.returns)[0];
                commentBlock += ` * @returns {string} ${result}${description ? ` - ${description}` : ''}\n`;
                break;
            }
            case CannoliReturnType.Void:
            default:
                commentBlock += ` * @returns {void}\n`;
                break;
        }
    }

    commentBlock += ` */`;
    return commentBlock;
}

function generateTypeDefinitions(cannoliInfo: CannoliInfo, language: BakeLanguage): string {
    const args = Object.keys(cannoliInfo.params);
    const argsType = args.map(arg => `${arg}: string;`).join("\n  ");
    const resultType = Object.keys(cannoliInfo.returns).map(result => `${result}: string`).join(";\n  ") + ";";

    let argTypeDef = '';
    let resultTypeDef = '';

    if (language === "typescript") {
        if (cannoliInfo.paramType === "object") {
            argTypeDef = `export type ${cannoliInfo.functionName.charAt(0).toUpperCase() + cannoliInfo.functionName.slice(1)}Args = {\n  ${argsType}\n};\n\n`;
        }

        if (cannoliInfo.returnType === "object") {
            resultTypeDef = `export type ${cannoliInfo.functionName.charAt(0).toUpperCase() + cannoliInfo.functionName.slice(1)}Results = {\n  ${resultType}\n};\n\n`;
        }
    } else {
        if (cannoliInfo.paramType === "object") {
            argTypeDef = `/**\n * @typedef {Object} ${cannoliInfo.functionName.charAt(0).toUpperCase() + cannoliInfo.functionName.slice(1)}Args\n${args.map(arg => ` * @property {string} ${arg}`).join("\n")}\n */\n\n`;
        }

        if (cannoliInfo.paramType === "object") {
            resultTypeDef = `/**\n * @typedef {Object} ${cannoliInfo.functionName.charAt(0).toUpperCase() + cannoliInfo.functionName.slice(1)}Results\n${Object.keys(cannoliInfo.returns).map(result => ` * @property {string} ${result}`).join("\n")}\n */\n\n`;
        }
    }

    return `${argTypeDef}${resultTypeDef}`;
}

function generateFunctionSignature(cannoliInfo: CannoliInfo, language: BakeLanguage): string {
    const { paramType, returnType, functionName, params } = cannoliInfo;
    const args = Object.keys(params);

    let argsString: string;
    switch (paramType) {
        case CannoliParamType.String:
            argsString = args.map(arg => `${arg}: string`).join(", ");
            break;
        case CannoliParamType.Array:
            argsString = `\n  ${args.map(arg => `${arg}: string`).join(",\n  ")}\n`;
            break;
        case CannoliParamType.Object:
            argsString = `args: ${functionName.charAt(0).toUpperCase() + functionName.slice(1)}Args`;
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
            returnTypeString = `${functionName.charAt(0).toUpperCase() + functionName.slice(1)}Results`;
            break;
        case CannoliReturnType.Void:
        default:
            returnTypeString = "void";
            break;
    }

    if (language === "typescript") {
        return `export async function ${functionName}(${argsString}): Promise<${returnTypeString}>`;
    } else {
        switch (paramType) {
            case CannoliParamType.Object:
                return `export async function ${functionName}({\n  ${args.join(",\n  ")}\n})`;
            case CannoliParamType.Array:
                return `export async function ${functionName}(\n  ${args.join(",\n  ")}\n)`;
            case CannoliParamType.String:
                return `export async function ${functionName}(${argsString})`;
            case CannoliParamType.Void:
            default:
                return `export async function ${functionName}()`;
        }
    }
}

function generateReturnStatement(cannoliInfo: CannoliInfo): string {
    const { returnType, returns } = cannoliInfo;

    switch (returnType) {
        case CannoliReturnType.String: {
            const [result] = Object.keys(returns);
            return `return runResult["${result}"];`;
        }

        case CannoliReturnType.Object: {
            const returnObject = Object.keys(returns)
                .map(result => `    ${result}: runResult["${result}"]`)
                .join(",\n");
            return `return {\n${returnObject}\n  };`;
        }

        case CannoliReturnType.Void:
        default:
            return `return;`;
    }
}

function generateRunFunctionCall(cannoliInfo: CannoliInfo, availableArgs: string[], language: BakeLanguage): string {
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
                runArgs = `  args`;
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

function generateFunction(cannoliInfo: CannoliInfo, language: BakeLanguage, argDeclarations: string, availableArgs: string[]): string | Error {
    const typeDefinitions = generateTypeDefinitions(cannoliInfo, language);
    const commentBlock = generateCommentBlock(cannoliInfo, language);
    const functionSignature = generateFunctionSignature(cannoliInfo, language);
    const returnStatement = generateReturnStatement(cannoliInfo);
    const runFunctionCall = generateRunFunctionCall(cannoliInfo, availableArgs, language);

    const functionBody = `
${typeDefinitions}${commentBlock}
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
        importMap[corePath] = ["LLMConfig", "run", "CannoliInfo"];
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