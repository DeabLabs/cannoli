import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import { Resource } from "@opentelemetry/resources";
import { OpenInferenceBatchSpanProcessor } from "@arizeai/openinference-vercel";
import { TracingConfig } from "src/run";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

let globalProvider: WebTracerProvider | undefined;

export const createPhoenixWebTracerProvider = ({
  tracingConfig,
}: {
  tracingConfig: TracingConfig;
}) => {
  if (globalProvider) {
    return globalProvider;
  }

  if (!tracingConfig.phoenix?.enabled) {
    return;
  }

  try {
    const provider = new WebTracerProvider({
      resource: new Resource({
        [SEMRESATTRS_PROJECT_NAME]: tracingConfig.phoenix.projectName,
      }),
    });

    const traceUrl = `${tracingConfig.phoenix.baseUrl.endsWith("/") ? tracingConfig.phoenix.baseUrl : `${tracingConfig.phoenix.baseUrl}/`}v1/traces`;
    provider.addSpanProcessor(
      new OpenInferenceBatchSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: traceUrl,
          headers: {
            ...(tracingConfig.phoenix.apiKey
              ? {
                  Authorization: `Bearer ${tracingConfig.phoenix.apiKey}`,
                }
              : {}),
          },
        }),
      }),
    );

    provider.register();

    console.log("🔎 Phoenix tracing enabled 🔎");

    globalProvider = provider;

    return provider;
  } catch (error) {
    console.error("Error enabling Phoenix tracing", error);
  }
};
