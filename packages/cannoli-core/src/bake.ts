import { VerifiedCannoliCanvasData } from "./models/graph";
import { LLMConfig } from "./providers";

export type Runtime = "node" | "deno" | "bun";

export type Language = "typescript" | "javascript";

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

function generateCommentBlock(cannoliName: string, argInfo: Record<string, VarInfo | null>, resultInfo: Record<string, VarInfo | null>, description?: string): string {
    const formatDescription = (desc?: string) => desc ? desc.split('\n').map(line => ` * ${line}`).join('\n') : '';
    const capitalizedCannoliName = cannoliName.charAt(0).toUpperCase() + cannoliName.slice(1);

    let typedefBlock = '';
    let commentBlock = description ? `/**\n${formatDescription(description)}\n` : `/**\n`;

    if (Object.keys(argInfo).length > 1) {
        typedefBlock += `/**\n * @typedef {Object} ${capitalizedCannoliName}Args\n`;
        for (const [arg, info] of Object.entries(argInfo)) {
            typedefBlock += ` * @property {string} ${arg}${info?.description ? ` - ${info.description}` : ''}\n`;
        }
        typedefBlock += ` */\n\n`;
        commentBlock += ` * @param {${capitalizedCannoliName}Args} args\n`;
    } else if (Object.keys(argInfo).length === 1) {
        const [arg, info] = Object.entries(argInfo)[0];
        commentBlock += ` * @param {string} ${arg}${info?.description ? ` - ${info.description}` : ''}\n`;
    }

    if (Object.keys(resultInfo).length > 1) {
        typedefBlock += `/**\n * @typedef {Object} ${capitalizedCannoliName}Results\n`;
        for (const [result, info] of Object.entries(resultInfo)) {
            typedefBlock += ` * @property {string} ${result}${info?.description ? ` - ${info.description}` : ''}\n`;
        }
        typedefBlock += ` */\n\n`;
        commentBlock += ` * @returns {${capitalizedCannoliName}Results} results\n`;
    } else if (Object.keys(resultInfo).length === 1) {
        const [result, info] = Object.entries(resultInfo)[0];
        commentBlock += ` * @returns {string} ${result}${info?.description ? ` - ${info.description}` : ''}\n`;
    } else {
        commentBlock += ` * @returns {void}\n`;
    }

    commentBlock += ` */`;
    return typedefBlock + commentBlock;
}

function generateFunctionSignature(cannoliName: string, argInfo: Record<string, VarInfo | null>, resultInfo: Record<string, VarInfo | null>, language: Language): string {
    const argsType = Object.keys(argInfo).map(arg => `${arg}: string;`).join("\n  ");
    const resultType = Object.keys(resultInfo).map(result => `${result}: string`).join(";\n  ") + ";";

    if (Object.keys(argInfo).length === 1) {
        const [arg] = Object.keys(argInfo);
        return language === "typescript"
            ? `export async function ${cannoliName}(${arg}: string): Promise<${Object.keys(resultInfo).length === 0 ? 'void' : Object.keys(resultInfo).length === 1 ? 'string' : `{\n  ${resultType}\n}`}>`
            : `export async function ${cannoliName}(${arg})`;
    } else if (Object.keys(argInfo).length > 1) {
        return language === "typescript"
            ? `export async function ${cannoliName}({\n  ${Object.keys(argInfo).join(",\n  ")}\n}: {\n  ${argsType}\n}): Promise<${Object.keys(resultInfo).length === 0 ? 'void' : Object.keys(resultInfo).length === 1 ? 'string' : `{\n  ${resultType}\n}`}>`
            : `export async function ${cannoliName}({${Object.keys(argInfo).join(", ")}})`;
    } else {
        return language === "typescript"
            ? `export async function ${cannoliName}(): Promise<${Object.keys(resultInfo).length === 0 ? 'void' : Object.keys(resultInfo).length === 1 ? 'string' : `{\n  ${resultType}\n}`}>`
            : `export async function ${cannoliName}()`;
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

function generateFunction(cannoliName: string, cannoliInfo: CannoliInfo, language: Language, argDeclarations: string, availableArgs: string[]): string | Error {
    if (!cannoliName) {
        return new Error("Cannoli name is empty");
    }

    const { argInfo, resultInfo, description } = cannoliInfo;

    const commentBlock = generateCommentBlock(cannoliName, argInfo, resultInfo, description);
    const functionSignature = generateFunctionSignature(cannoliName, argInfo, resultInfo, language);
    const returnStatement = generateReturnStatement(resultInfo);

    const functionBody = `
${commentBlock}
${functionSignature} {
${indent(argDeclarations, "  ")}

  const runResult = await run({
    args: {
${Object.keys(argInfo).map(arg => `      ${arg}`).join(",\n")}
    },
${availableArgs.map(arg => `    ${arg}`).join(",\n")}
  });

  ${returnStatement}
}
`.trim();

    return functionBody;
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
    // actions,
    // replacers,
    // fetcher,
}: {
    language: Language;
    runtime: Runtime;
    cannoli: VerifiedCannoliCanvasData;
    llmConfigs: LLMConfig[];
    cannoliName: string;
    cannoliInfo: CannoliInfo;
    config?: Record<string, string | number | boolean>;
    envVars?: Record<string, string>;
    // actions?: Action[];
    // replacers?: Replacer[];
    // fetcher?: ResponseTextFetcher;
}): {
    name: string;
    fileName: string;
    code: string;
} | Error {
    const importTemplate = generateImportTemplates(language)[runtime];

    let llmConfigTemplate = "";
    if (llmConfigs) {
        llmConfigTemplate = `const llmConfigs${language === "typescript" ? ": LLMConfig[]" : ""} = ${printLLMConfigWithEnvReference(llmConfigs, runtime)};
        `;
    }

    let envVarTemplate = "";
    if (envVars) {
        envVarTemplate = generateEnvVarTemplate(runtime, envVars);
    }

    let configTemplate = "";
    if (config && Object.keys(config).length > 0) {
        configTemplate = `\nconst config = ${JSON.stringify(config, null, 2)};
        `;
    }

    const optionalArgTemplates = `${envVarTemplate}${configTemplate}`.trim();

    const availableArgs = ['cannoli', 'llmConfigs', 'args'];
    if (envVars) availableArgs.push('envVars');
    if (config) availableArgs.push('config');
    // if (actions) availableArgs.push('actions');
    // if (replacers) availableArgs.push('replacers');
    // if (fetcher) availableArgs.push('fetcher');

    const camelCasedFunctionName = toCamelCase(cannoliName);

    const argDeclarations = `${optionalArgTemplates}

${llmConfigTemplate}
const cannoli = ${JSON.stringify(cannoli, null, 2)};`;

    const generatedFunction = generateFunction(camelCasedFunctionName, cannoliInfo, language, argDeclarations, availableArgs);

    const code = `${importTemplate}
${generatedFunction}
`;

    console.log(code);
    return {
        name: camelCasedFunctionName,
        fileName: `${camelCasedFunctionName}.${language === "typescript" ? "ts" : "js"}`,
        code,
    };
}

function generateImportTemplates(language: Language): Record<Runtime, string> {
    const llmConfigImport = language === "typescript" ? "  LLMConfig,\n" : "";
    return {
        node: `import {\n${llmConfigImport}  run\n} from "npm:@deablabs/cannoli-core@latest";
`,
        deno: `import {\n${llmConfigImport}  run\n} from "npm:@deablabs/cannoli-core@latest";
`,
        bun: `import {\n${llmConfigImport}  run\n} from "npm:@deablabs/cannoli-core@latest";
`
    };
}

function generateEnvVarTemplate(runtime: Runtime, envVars: Record<string, string>): string {
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
    runtime: Runtime
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
