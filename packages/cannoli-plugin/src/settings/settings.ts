import {
  BakeLanguage,
  BakeRuntime,
  HttpTemplate,
  SupportedProviders,
  TracingConfig,
} from "@deablabs/cannoli-core";

export interface CannoliSettings {
  llmProvider: SupportedProviders;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTemperature: number;
  azureAPIKey: string;
  azureModel: string;
  azureTemperature: number;
  azureOpenAIApiDeploymentName: string;
  azureOpenAIApiInstanceName: string;
  azureOpenAIApiVersion: string;
  azureBaseURL: string;
  geminiModel: string;
  geminiAPIKey: string;
  geminiTemperature: number;
  anthropicModel: string;
  anthropicAPIKey: string;
  anthropicTemperature: number;
  anthropicBaseURL: string;
  groqModel: string;
  groqAPIKey: string;
  groqTemperature: number;
  openaiAPIKey: string;
  openaiBaseURL: string;
  requestThreshold: number;
  defaultModel: string;
  defaultTemperature: number;
  httpTemplates: HttpTemplate[];
  includeFilenameAsHeader: boolean;
  includePropertiesInExtractedNotes: boolean;
  includeLinkInExtractedNotes: boolean;
  chatFormatString: string;
  enableAudioTriggeredCannolis?: boolean;
  deleteAudioFilesAfterAudioTriggeredCannolis?: boolean;
  transcriptionPrompt?: string;
  autoScrollWithTokenStream: boolean;
  pLimit: number;
  contentIsColorless: boolean;
  valTownAPIKey: string;
  exaAPIKey: string;
  bakedCannoliFolder: string;
  bakeLanguage: BakeLanguage;
  bakeRuntime: BakeRuntime;
  bakeIndent: "2" | "4";
  seenVersion2Modal: boolean;
  enableVision: boolean;
  secrets: { name: string; value: string; visibility: string }[];
  onlyRunCannoliGroups: boolean;
  tracingConfig: NonNullable<TracingConfig>;
  cannoliServerUrl: string;
}

export const DEFAULT_SETTINGS: CannoliSettings = {
  llmProvider: "openai",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama2",
  ollamaTemperature: 1,
  azureModel: "",
  azureAPIKey: "",
  azureTemperature: 1,
  azureOpenAIApiDeploymentName: "",
  azureOpenAIApiInstanceName: "",
  azureOpenAIApiVersion: "",
  azureBaseURL: "",
  geminiModel: "gemini-1.0-pro-latest",
  geminiAPIKey: "",
  geminiTemperature: 1,
  anthropicModel: "claude-3-5-sonnet-20240620",
  anthropicAPIKey: "",
  anthropicTemperature: 1,
  anthropicBaseURL: "",
  groqModel: "llama3-70b-8192",
  groqAPIKey: "",
  groqTemperature: 1,
  openaiAPIKey: "",
  openaiBaseURL: "",
  requestThreshold: 20,
  defaultModel: "gpt-4o",
  defaultTemperature: 1,
  httpTemplates: [],
  includeFilenameAsHeader: false,
  includePropertiesInExtractedNotes: false,
  includeLinkInExtractedNotes: false,
  chatFormatString: `---\n# <u>{{role}}</u>\n\n{{content}}`,
  enableAudioTriggeredCannolis: false,
  deleteAudioFilesAfterAudioTriggeredCannolis: false,
  autoScrollWithTokenStream: false,
  pLimit: 50,
  contentIsColorless: false,
  valTownAPIKey: "",
  exaAPIKey: "",
  bakedCannoliFolder: "Baked Cannoli",
  bakeLanguage: "typescript",
  bakeRuntime: "node",
  bakeIndent: "2",
  seenVersion2Modal: false,
  secrets: [],
  enableVision: true,
  onlyRunCannoliGroups: false,
  tracingConfig: {
    phoenix: {
      enabled: false,
      projectName: "cannoli",
      baseUrl: "http://localhost:6006/",
      apiKey: "",
    },
  },
  cannoliServerUrl: "http://localhost:3333",
};
