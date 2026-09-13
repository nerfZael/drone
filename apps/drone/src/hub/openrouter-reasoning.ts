import type { NativeAgentThinkingLevel } from '@drone/assistant-chat';
import type { ThinkingLevelMap } from '@mariozechner/pi-ai';

export type OpenRouterReasoningCapabilities = {
  enabled: boolean;
  levels: NativeAgentThinkingLevel[];
  defaultLevel: NativeAgentThinkingLevel;
  providerLevels: string[];
  providerDefaultLevel: string;
  thinkingLevelMap?: ThinkingLevelMap;
};

const INTERNAL_LEVELS: NativeAgentThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export function openRouterReasoningCapabilities(model: unknown): OpenRouterReasoningCapabilities {
  const item = record(model);
  const parameters = Array.isArray(item?.supported_parameters) ? item.supported_parameters : [];
  if (!parameters.includes('reasoning')) {
    return {
      enabled: false,
      levels: ['off'],
      defaultLevel: 'off',
      providerLevels: [],
      providerDefaultLevel: '',
    };
  }

  const reasoning = record(item?.reasoning);
  if (!reasoning || !Object.prototype.hasOwnProperty.call(reasoning, 'supported_efforts')) {
    return {
      enabled: true,
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'off',
      providerLevels: ['low', 'medium', 'high'],
      providerDefaultLevel: 'medium',
    };
  }

  const mandatory = reasoning?.mandatory === true;
  const effortStrings = reasoning.supported_efforts === null
    ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    : Array.isArray(reasoning.supported_efforts)
      ? reasoning.supported_efforts.map(providerEffortName).filter(Boolean)
      : [];
  const providerLevels = uniqueStrings(effortStrings).filter(
    (effort) => effort && (!mandatory || effort !== 'none'),
  );
  const requestedProviderDefault = providerEffortName(reasoning.default_effort);
  if (!providerLevels.length) {
    providerLevels.push(requestedProviderDefault || (mandatory ? 'high' : 'none'));
  }
  const providerDefaultLevel = reasoning.default_enabled === false && !mandatory
    ? providerLevels.includes('none') ? 'none' : providerLevels[0]
    : providerLevels.includes(requestedProviderDefault)
      ? requestedProviderDefault
      : providerLevels[0];
  const efforts = effortStrings.map(providerEffort).filter(isThinkingLevel);
  const levels = unique(efforts).filter((level) => !mandatory || level !== 'off');
  if (!mandatory && !levels.includes('off')) levels.unshift('off');

  const mappedDefault = providerEffort(reasoning?.default_effort);
  if (!levels.length) levels.push(mappedDefault ?? (mandatory ? 'high' : 'off'));
  const defaultLevel = reasoning?.default_enabled === false && !mandatory
    ? 'off'
    : mappedDefault && levels.includes(mappedDefault)
      ? mappedDefault
      : levels[0] ?? (mandatory ? 'high' : 'off');

  const providerEfforts = new Set(effortStrings);
  const thinkingLevelMap: ThinkingLevelMap = {};
  for (const level of INTERNAL_LEVELS) {
    if (!levels.includes(level)) thinkingLevelMap[level] = null;
  }
  if (levels.includes('off')) thinkingLevelMap.off = 'none';
  if (levels.includes('xhigh')) {
    thinkingLevelMap.xhigh = providerEfforts.has('xhigh') ? 'xhigh' : 'max';
  }

  return {
    enabled: true,
    levels,
    defaultLevel,
    providerLevels,
    providerDefaultLevel,
    thinkingLevelMap,
  };
}

function providerEffort(value: unknown): NativeAgentThinkingLevel | null {
  const effort = providerEffortName(value);
  if (effort === 'none') return 'off';
  if (effort === 'max') return 'xhigh';
  return isThinkingLevel(effort) ? effort : null;
}

function providerEffortName(value: unknown): string {
  const effort = String(value ?? '').trim().toLowerCase();
  return effort.length <= 32 && /^[a-z0-9._-]+$/.test(effort) ? effort : '';
}

function isThinkingLevel(value: unknown): value is NativeAgentThinkingLevel {
  return INTERNAL_LEVELS.includes(value as NativeAgentThinkingLevel);
}

function unique(levels: NativeAgentThinkingLevel[]): NativeAgentThinkingLevel[] {
  return [...new Set(levels)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}
