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

function generateFunction(cannoliName: string, cannoliInfo: CannoliInfo, language: Language, availableArgs: string[]): string | Error {
    if (!cannoliName) {
        return new Error("Cannoli name is empty");
    }

    const { argInfo, resultInfo, description } = cannoliInfo;

    const formatDescription = (desc?: string) => desc ? desc.split('\n').map(line => ` * ${line}`).join('\n') : '';

    const argsType = Object.keys(argInfo).map(arg => `${arg}: string`).join(";\n    ");
    const resultType = Object.keys(resultInfo).map(result => `${result}: string`).join(";\n    ");

    const argsComment = Object.entries(argInfo)
        .map(([arg, info]) => {
            const desc = info?.description ? ` - ${formatDescription(info.description)}` : '';
            return ` * @param {string} ${arg}${desc}`;
        })
        .join("\n");
    const resultsComment = Object.entries(resultInfo)
        .map(([result, info]) => {
            const desc = info?.description ? ` - ${formatDescription(info.description)}` : '';
            return ` * @returns {string} ${result}${desc}`;
        })
        .join("\n");

    const functionComment = description
        ? `
/**
${formatDescription(description)}
${argsComment}
${resultsComment}
 */`
        : `
/**
${argsComment}
${resultsComment}
 */`;

    const functionSignature = language === "typescript"
        ? `export async function ${cannoliName}(args: {\n    ${argsType}\n}): Promise<{\n    ${resultType}\n}>`
        : `export async function ${cannoliName}(args)`;

    const runArgs = availableArgs.map(arg => `${arg}`).join(",\n    ");

    const returnObject = Object.keys(resultInfo)
        .map(result => `${result}: runResult["${result}"]`)
        .join(",\n    ");

    const functionBody = `
${functionComment}
${functionSignature} {
  const runResult = await run({
    ${runArgs}
  });

  return {
    ${returnObject}
  };
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

    const generatedFunction = generateFunction(camelCasedFunctionName, cannoliInfo, language, availableArgs);

    const code = `${importTemplate}
const cannoli = ${JSON.stringify(cannoli, null, 2)};

${llmConfigTemplate}
${optionalArgTemplates}

${generatedFunction}
`.trim();

    console.log(code);
    return {
        name: camelCasedFunctionName,
        fileName: `${camelCasedFunctionName}.${language === "typescript" ? "ts" : "js"}`,
        code,
    };
}

function generateImportTemplates(language: Language): Record<Runtime, string> {
    const llmConfigImport = language === "typescript" ? "LLMConfig, " : "";
    return {
        node: `
import { ${llmConfigImport}run } from "npm:@deablabs/cannoli-core@latest";
`,
        deno: `
import { ${llmConfigImport}run } from "npm:@deablabs/cannoli-core@latest";
`,
        bun: `
import { ${llmConfigImport}run } from "npm:@deablabs/cannoli-core@latest";
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
