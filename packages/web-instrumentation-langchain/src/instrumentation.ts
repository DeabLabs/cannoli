import * as CallbackManagerModule from "@langchain/core/callbacks/manager";
import {
	InstrumentationBase,
	InstrumentationConfig,
	isWrapped
} from "@opentelemetry/instrumentation";
import { diag } from "@opentelemetry/api";
import { addTracerToHandlers } from "./instrumentationUtils";

const MODULE_NAME = "@langchain/core/callbacks";

/**
 * Flag to check if the openai module has been patched
 * Note: This is a fallback in case the module is made immutable (e.x. Deno, webpack, etc.)
 */
let _isOpenInferencePatched = false;

/**
 * function to check if instrumentation is enabled / disabled
 */
export function isPatched() {
	return _isOpenInferencePatched;
}

export class LangChainInstrumentation extends InstrumentationBase<typeof CallbackManagerModule> {
	constructor(config?: InstrumentationConfig) {
		super(
			"@arizeai/openinference-instrumentation-langchain",
			"1.0.0",
			Object.assign({}, config),
		);
	}

	manuallyInstrument(module: typeof CallbackManagerModule) {
		diag.debug(`Manually instrumenting ${MODULE_NAME}`);
		this.patch(module);
	}

	protected init(): void {
	}

	enable() {
		// this.manuallyInstrument(CallbackManagerModule);
	}

	disable() {
		// this.unpatch(CallbackManagerModule);
	}

	private patch(
		module: typeof CallbackManagerModule & {
			openInferencePatched?: boolean;
		},
		moduleVersion?: string,
	) {
		diag.debug(
			`Applying patch for ${MODULE_NAME}${moduleVersion != null ? `@${moduleVersion}` : ""
			}`,
		);
		if (module?.openInferencePatched || _isOpenInferencePatched) {
			return module;
		}
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const instrumentation = this;

		this._wrap(module.CallbackManager, "configure", (original) => {
			return function (
				this: typeof module.CallbackManager,
				...args: Parameters<
					(typeof module.CallbackManager)["configure"]
				>
			) {
				const handlers = args[0];
				const newHandlers = addTracerToHandlers(
					instrumentation.tracer,
					handlers,
				);
				args[0] = newHandlers;

				return original.apply(this, args);
			};
		});
		_isOpenInferencePatched = true;
		try {
			// This can fail if the module is made immutable via the runtime or bundler
			module.openInferencePatched = true;
		} catch (e) {
			diag.warn(`Failed to set ${MODULE_NAME} patched flag on the module`, e);
		}

		return module;
	}

	private unpatch(
		module?: typeof CallbackManagerModule & {
			openInferencePatched?: boolean;
		},
		moduleVersion?: string,
	) {
		if (module == null) {
			return;
		}
		diag.debug(
			`Removing patch for ${MODULE_NAME}${moduleVersion != null ? `@${moduleVersion}` : ""
			}`,
		);
		if (isWrapped(module.CallbackManager.configure)) {
			this._unwrap(module.CallbackManager, "configure");
		}

		return module;
	}
}
