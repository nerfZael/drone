import type * as BlipCore from '@blip/core';
import type * as BlipMcp from '@blip/mcp';
import type * as BlipTools from '@blip/tools';

let runtimePromise: Promise<typeof BlipCore> | null = null;
let mcpPromise: Promise<typeof BlipMcp> | null = null;
let toolsPromise: Promise<typeof BlipTools> | null = null;

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

/** The Hub is CommonJS and Blip is ESM, so the runtime boundary is isolated here. */
export function loadBlipRuntime(): Promise<typeof BlipCore> {
  runtimePromise ??= importEsm('@blip/core') as Promise<typeof BlipCore>;
  return runtimePromise;
}

export function loadBlipMcp(): Promise<typeof BlipMcp> {
  mcpPromise ??= importEsm('@blip/mcp') as Promise<typeof BlipMcp>;
  return mcpPromise;
}

export function loadBlipTools(): Promise<typeof BlipTools> {
  toolsPromise ??= importEsm('@blip/tools') as Promise<typeof BlipTools>;
  return toolsPromise;
}
