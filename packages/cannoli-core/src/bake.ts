import { runWithControl } from "./cannoli";
import { FileManager } from "./fileManager";
import { VerifiedCannoliCanvasData } from "./models/graph";
import { LLMConfig } from "./providers";
import { Action } from "./run";

export type VarInfo = {
    displayName: string;
    description?: string;
}

export type CannoliInfo = {
    argInfo: Record<string, VarInfo | null>;
    resultInfo: Record<string, VarInfo | null>;
    description?: string;
    version?: string;
}

export type BakeRuntime = "node" | "deno" | "bun";

export type BakeLanguage = "typescript" | "javascript";

export async function bake({
    language,
    runtime,
    changeIndentToFour,
    cannoliInfo,
    cannoli,
    cannoliName,
    llmConfigs,
    config,
    envVars,
    actions,
    // replacers,
    // fetcher,
}: {
    language: BakeLanguage,
    runtime: BakeRuntime,
    cannoliName: string,
    cannoli: unknown,
    llmConfigs: LLMConfig[],
    cannoliInfo?: CannoliInfo,
    fileManager?: FileManager,
    config?: Record<string, string | number | boolean>,
    envVars?: Record<string, string>,
    changeIndentToFour?: boolean,
    actions?: Action[],
    // replacers?: Replacer[],
    // fetcher?: ResponseTextFetcher,
}): Promise<{ name: string; fileName: string; code: string } | Error> {
    // Mock run the cannoli
    const [done] = await runWithControl({
        cannoli,
        llmConfigs,
        config,
        envVars,
        isMock: true,
        actions,
        // replacers,
        // fetcher,
    });

    const stoppage = await done;

    if (stoppage.reason == "error") {
        return new Error("There's an error in the cannoli. Please fix it before baking.");
    }

    // Get the args and results
    const argNames: string[] = stoppage.argNames;
    const resultNames: string[] = stoppage.resultNames;
    const description: string | undefined = stoppage.description;

    let givenArgNames: string[] = [];
    let givenResultNames: string[] = [];

    if (!cannoliInfo) {
        cannoliInfo = {
            argInfo: Object.fromEntries(argNames.map((name) => [name, null])),
            resultInfo: Object.fromEntries(resultNames.map((name) => [name, null])),
            description,
        };
    } else {
        if (cannoliInfo.argInfo) {
            givenArgNames = Object.keys(cannoliInfo.argInfo);
        } else {
            givenArgNames = argNames;
            cannoliInfo.argInfo = Object.fromEntries(argNames.map((name) => [name, null]));
        }

        if (cannoliInfo.resultInfo) {
            givenResultNames = Object.keys(cannoliInfo.resultInfo);
        } else {
            givenResultNames = resultNames;
            cannoliInfo.resultInfo = Object.fromEntries(resultNames.map((name) => [name, null]));
        }

        // Check that they contain the same names
        const argNamesMatch = argNames.length === givenArgNames.length && argNames.every(name => givenArgNames.includes(name));
        const resultNamesMatch = resultNames.length === givenResultNames.length && resultNames.every(name => givenResultNames.includes(name));

        if (!argNamesMatch || !resultNamesMatch) {
            return new Error("Mismatch between arg or result names in the cannoli info and the ones in the cannoli itself.");
        }
    }

    // Filter out llmconfig without baseURL or apiKey
    const llmConfigsWithBaseURLorAPIKey = llmConfigs?.filter((config) => config.baseURL || config.apiKey)

    // Filter out actions without importInfo
    const actionsWithImportInfo = actions?.filter((action) => action.importInfo);

    const code = writeCode({
        language,
        runtime,
        changeIndentToFour,
        cannoli: cannoli as VerifiedCannoliCanvasData,
        llmConfigs: llmConfigsWithBaseURLorAPIKey,
        cannoliInfo,
        cannoliName,
        config,
        envVars,
        actions: actionsWithImportInfo,
    })

    return code;
}

export function writeCode({
    language,
    runtime,
    cannoli,
    llmConfigs,
    cannoliInfo,
    config,
    envVars,
    cannoliName,
    changeIndentToFour,
    actions,
    // replacers,
    // fetcher,
}: {
    language: BakeLanguage;
    runtime: BakeRuntime;
    cannoli: VerifiedCannoliCanvasData;
    llmConfigs: LLMConfig[];
    cannoliName: string;
    cannoliInfo: CannoliInfo;
    config?: Record<string, string | number | boolean>;
    envVars?: Record<string, string>;
    changeIndentToFour?: boolean;
    actions?: Action[];
    // replacers?: Replacer[];
    // fetcher?: ResponseTextFetcher;
}): {
    name: string;
    fileName: string;
    code: string;
} | Error {
    const importTemplate = generateImportTemplates(language, runtime, actions);
    const availableArgs = ['cannoli', 'llmConfigs'];

    let llmConfigTemplate = "";
    if (llmConfigs) {
        llmConfigTemplate = `const llmConfigs${language === "typescript" ? ": LLMConfig[]" : ""} = ${printLLMConfigWithEnvReference(llmConfigs, runtime)};
`;
    }

    let envVarTemplate = "";
    if (envVars && Object.keys(envVars).length > 0) {
        availableArgs.push('envVars');
        envVarTemplate = generateEnvVarTemplate(runtime, envVars);
    }

    let configTemplate = "";
    if (config && Object.keys(config).length > 0) {
        availableArgs.push('config');
        configTemplate = `\nconst config = ${JSON.stringify(config, null, 2)};
        `;
    }

    let actionsTemplate = "";
    if (actions && actions.length > 0) {
        availableArgs.push('actions');
        const actionNames = actions.map((action) => action.importInfo?.name);
        actionsTemplate = `\nconst actions = [\n  ${actionNames.join(",\n  ")}\n];`
    }

    const optionalArgTemplates = `${envVarTemplate}${configTemplate}${actionsTemplate}`.trim();

    const camelCasedFunctionName = toCamelCase(cannoliName);

    const argDeclarations = `${optionalArgTemplates}

${llmConfigTemplate}
const cannoli = ${JSON.stringify(cannoli, null, 2)};`;

    const generatedFunction = generateFunction(camelCasedFunctionName, cannoliInfo, language, argDeclarations, availableArgs);

    const code = cleanCode(`${importTemplate}
${generatedFunction}
`, changeIndentToFour);
    console.log(code);

    return {
        name: camelCasedFunctionName,
        fileName: `${camelCasedFunctionName}.${language === "typescript" ? "ts" : "js"}`,
        code,
    };
}

function generateCommentBlock(cannoliName: string, argInfo: Record<string, VarInfo | null>, resultInfo: Record<string, VarInfo | null>, language: BakeLanguage, description?: string): string {
    const formatDescription = (desc?: string) => desc ? desc.split('\n').map(line => ` * ${line}`).join('\n') : '';
    const capitalizedCannoliName = cannoliName.charAt(0).toUpperCase() + cannoliName.slice(1);

    let commentBlock = description ? `/**\n${formatDescription(description)}\n` : `/**\n`;

    const args = Object.keys(argInfo);

    if (language === "typescript") {
        if (args.length > 3) {
            const argNames = args.join(', ');
            commentBlock += ` * @param {${capitalizedCannoliName}Args} args - ${argNames}\n`;
        } else {
            for (const [arg, info] of Object.entries(argInfo)) {
                commentBlock += ` * @param {string} ${arg}${info?.description ? ` - ${info.description}` : ''}\n`;
            }
        }

        if (Object.keys(resultInfo).length > 1) {
            const resultNames = Object.keys(resultInfo).join(', ');
            commentBlock += ` * @returns {${capitalizedCannoliName}Results} ${resultNames}\n`;
        } else if (Object.keys(resultInfo).length === 1) {
            const [result, info] = Object.entries(resultInfo)[0];
            commentBlock += ` * @returns {string} ${result}${info?.description ? ` - ${info.description}` : ''}\n`;
        } else {
            commentBlock += ` * @returns {void}\n`;
        }
    } else {
        if (args.length > 3) {
            const argNames = args.join(', ');
            commentBlock += ` * @param {${capitalizedCannoliName}Args} args - ${argNames}\n`;
        } else {
            for (const [arg, info] of Object.entries(argInfo)) {
                commentBlock += ` * @param {string} ${arg}${info?.description ? ` - ${info.description}` : ''}\n`;
            }
        }

        if (Object.keys(resultInfo).length > 1) {
            const resultNames = Object.keys(resultInfo).join(', ');
            commentBlock += ` * @returns {${capitalizedCannoliName}Results} ${resultNames}\n`;
        } else if (Object.keys(resultInfo).length === 1) {
            const [result, info] = Object.entries(resultInfo)[0];
            commentBlock += ` * @returns {string} ${result}${info?.description ? ` - ${info.description}` : ''}\n`;
        } else {
            commentBlock += ` * @returns {void}\n`;
        }
    }

    commentBlock += ` */`;
    return commentBlock;
}

function generateTypeDefinitions(cannoliName: string, argInfo: Record<string, VarInfo | null>, resultInfo: Record<string, VarInfo | null>, language: BakeLanguage): string {
    const args = Object.keys(argInfo);
    const argsType = args.map(arg => `${arg}: string;`).join("\n  ");
    const resultType = Object.keys(resultInfo).map(result => `${result}: string`).join(";\n  ") + ";";

    let argTypeDef = '';
    let resultTypeDef = '';

    if (language === "typescript") {
        if (args.length > 3) {
            argTypeDef = `export type ${cannoliName.charAt(0).toUpperCase() + cannoliName.slice(1)}Args = {\n  ${argsType}\n};\n\n`;
        }

        if (Object.keys(resultInfo).length > 1) {
            resultTypeDef = `export type ${cannoliName.charAt(0).toUpperCase() + cannoliName.slice(1)}Results = {\n  ${resultType}\n};\n\n`;
        }
    } else {
        if (args.length > 3) {
            argTypeDef = `/**\n * @typedef {Object} ${cannoliName.charAt(0).toUpperCase() + cannoliName.slice(1)}Args\n${args.map(arg => ` * @property {string} ${arg}`).join("\n")}\n */\n\n`;
        }

        if (Object.keys(resultInfo).length > 1) {
            resultTypeDef = `/**\n * @typedef {Object} ${cannoliName.charAt(0).toUpperCase() + cannoliName.slice(1)}Results\n${Object.keys(resultInfo).map(result => ` * @property {string} ${result}`).join("\n")}\n */\n\n`;
        }
    }

    return `${argTypeDef}${resultTypeDef}`;
}

function generateFunctionSignature(cannoliName: string, argInfo: Record<string, VarInfo | null>, resultInfo: Record<string, VarInfo | null>, language: BakeLanguage): string {
    const args = Object.keys(argInfo);

    if (language === "typescript") {
        const argsString = args.length > 3
            ? `args: ${cannoliName.charAt(0).toUpperCase() + cannoliName.slice(1)}Args`
            : args.length > 1
                ? `\n  ${args.map(arg => `${arg}: string`).join(",\n  ")}\n`
                : args.map(arg => `${arg}: string`).join(", ");

        const returnType = Object.keys(resultInfo).length === 0
            ? 'void'
            : Object.keys(resultInfo).length === 1
                ? 'string'
                : `${cannoliName.charAt(0).toUpperCase() + cannoliName.slice(1)}Results`;

        return `export async function ${cannoliName}(${argsString}): Promise<${returnType}>`;
    } else {
        if (args.length === 1) {
            const [arg] = args;
            return `export async function ${cannoliName}(${arg})`;
        } else if (args.length > 1 && args.length <= 3) {
            return `export async function ${cannoliName}(\n  ${args.join(",\n  ")}\n)`;
        } else if (args.length > 3) {
            return `export async function ${cannoliName}({\n  ${args.join(",\n  ")}\n})`;
        } else {
            return `export async function ${cannoliName}()`;
        }
    }
}

function generateReturnStatement(resultInfo: Record<string, VarInfo | null>): string {
    if (Object.keys(resultInfo).length === 1) {
        const [result] = Object.keys(resultInfo);
        return `return runResult["${result}"];`;
    } else if (Object.keys(resultInfo).length > 1) {
        const returnObject = Object.keys(resultInfo)
            .map(result => `    ${result}: runResult["${result}"]`)
            .join(",\n");
        return `return {\n${returnObject}\n  };`;
    } else {
        return `return;`;
    }
}

function generateRunFunctionCall(args: string[], availableArgs: string[], language: BakeLanguage): string {
    let runArgs = '';

    if (args.length < 1) {
        runArgs = '';
    } else if (args.length <= 3 || language === "javascript") {
        runArgs = `  args: {
      ${args.join(",\n      ")}
    }`
    } else if (args.length > 3) {
        runArgs = `  args`;
    }

    const additionalArgs = availableArgs.map(arg => `  ${arg}`).join(",\n  ");

    const allArgs = [runArgs, additionalArgs].filter(Boolean).join(",\n  ");

    return `  const runResult = await run({
  ${allArgs}
  });`;
}

function generateFunction(cannoliName: string, cannoliInfo: CannoliInfo, language: BakeLanguage, argDeclarations: string, availableArgs: string[]): string | Error {
    if (!cannoliName) {
        return new Error("Cannoli name is empty");
    }

    const { argInfo, resultInfo, description } = cannoliInfo;

    const typeDefinitions = generateTypeDefinitions(cannoliName, argInfo, resultInfo, language);
    const commentBlock = generateCommentBlock(cannoliName, argInfo, resultInfo, language, description);
    const functionSignature = generateFunctionSignature(cannoliName, argInfo, resultInfo, language);
    const returnStatement = generateReturnStatement(resultInfo);

    const args = Object.keys(argInfo);
    const runFunctionCall = generateRunFunctionCall(args, availableArgs, language);

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
    if (language === "typescript") {
        const corePath = runtime === "node" ? "@deablabs/cannoli-core" : "npm:@deablabs/cannoli-core";
        importMap[corePath] = ["LLMConfig", "run"];
    } else {
        const corePath = runtime === "node" ? "@deablabs/cannoli-core" : "npm:@deablabs/cannoli-core";
        importMap[corePath] = ["run"];
    }

    // Add action imports
    if (actions) {
        actions.forEach(action => {
            let importPath = action.importInfo?.importPath || "Paste import path or implement action";
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
        if (imports.length > 4) {
            return `import {\n  ${imports.join(",\n  ")}\n} from "${path}";\n`;
        } else {
            return `import { ${imports.join(", ")} } from "${path}";\n`;
        }
    }).join("");

    return importStatements;
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