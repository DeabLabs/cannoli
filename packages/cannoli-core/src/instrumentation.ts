import { WebTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-web"
import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import { Resource } from "@opentelemetry/resources"
import * as lcCallbackManager from "@langchain/core/callbacks/manager";
import { LangChainInstrumentation } from "web-instrumentation-langchain";

import { TracingConfig } from "src/run"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

const instrumentPhoenixLangchain = () => {
	const lcInstrumentation = new LangChainInstrumentation();
	lcInstrumentation.manuallyInstrument(lcCallbackManager);

	console.log("🔎 Phoenix Langchain instrumentation enabled 🔎")
}

export const createPhoenixWebTracerProvider = ({ tracingConfig }: { tracingConfig: TracingConfig }) => {
	if (!tracingConfig.phoenix?.enabled) {
		return
	}

	try {

		const provider = new WebTracerProvider({
			resource: new Resource({
				[SEMRESATTRS_PROJECT_NAME]: tracingConfig.phoenix.projectName,
			}),
		})

		const traceUrl = `${tracingConfig.phoenix.baseUrl.endsWith("/") ? tracingConfig.phoenix.baseUrl : `${tracingConfig.phoenix.baseUrl}/`}v1/traces`
		// provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
		provider.addSpanProcessor(new SimpleSpanProcessor(new OTLPTraceExporter({
			url: traceUrl,
			headers: {
				...(tracingConfig.phoenix.apiKey
					? tracingConfig.phoenix.baseUrl.includes("app.phoenix.arize.com")
						? { "api_key": `${tracingConfig.phoenix.apiKey}` }
						: { "Authorization": `Bearer ${tracingConfig.phoenix.apiKey}` }
					: {}),
			}
		})))

		provider.register()

		console.log("🔎 Phoenix tracing enabled 🔎")

		instrumentPhoenixLangchain()

		return provider
	} catch (error) {
		console.error("Error enabling Phoenix tracing", error)
	}
}

