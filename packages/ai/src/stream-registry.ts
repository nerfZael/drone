import { getApiProvider } from './api-registry.js';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  ProviderStreamOptions,
  SimpleStreamOptions,
  StreamOptions,
} from './types.js';

function resolveApiProvider(api: Api) {
  const provider = getApiProvider(api);
  if (!provider) throw new Error(`No API provider registered for api: ${api}`);
  return provider;
}

/** Platform-neutral stream dispatch. Hosts explicitly register the providers they support. */
export function stream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): AssistantMessageEventStream {
  return resolveApiProvider(model.api).stream(model, context, options as StreamOptions);
}

export async function complete<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
  return stream(model, context, options).result();
}

export function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  return resolveApiProvider(model.api).streamSimple(model, context, options);
}

export async function completeSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return streamSimple(model, context, options).result();
}
