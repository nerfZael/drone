import { describe, expect, test } from 'bun:test';
import { openRouterReasoningCapabilities } from '../src/hub/openrouter-reasoning';

describe('OpenRouter reasoning capabilities', () => {
  test('maps mandatory max effort into the app reasoning vocabulary', () => {
    expect(openRouterReasoningCapabilities({
      supported_parameters: ['reasoning'],
      reasoning: {
        mandatory: true,
        default_enabled: true,
        supported_efforts: ['max', 'high', 'low'],
        default_effort: 'max',
      },
    })).toEqual({
      enabled: true,
      levels: ['xhigh', 'high', 'low'],
      defaultLevel: 'xhigh',
      providerLevels: ['max', 'high', 'low'],
      providerDefaultLevel: 'max',
      thinkingLevelMap: {
        off: null,
        minimal: null,
        medium: null,
        xhigh: 'max',
      },
    });
  });

  test('keeps the prior generic fallback when detailed metadata is unavailable', () => {
    expect(openRouterReasoningCapabilities({ supported_parameters: ['reasoning'] })).toEqual({
      enabled: true,
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'off',
      providerLevels: ['low', 'medium', 'high'],
      providerDefaultLevel: 'medium',
    });
  });

  test('accepts every internal effort when OpenRouter publishes a null allowlist', () => {
    expect(openRouterReasoningCapabilities({
      supported_parameters: ['reasoning'],
      reasoning: { supported_efforts: null, default_effort: 'medium' },
    })).toMatchObject({
      levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      defaultLevel: 'medium',
      providerLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      providerDefaultLevel: 'medium',
      thinkingLevelMap: { off: 'none', xhigh: 'xhigh' },
    });
  });
});
