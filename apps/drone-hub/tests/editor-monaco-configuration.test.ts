import { describe, expect, test } from 'bun:test';
import {
  configureMonacoTypeScriptDiagnostics,
  MONACO_WORKSPACE_ONLY_DIAGNOSTIC_CODES,
} from '../src/droneHub/files/editor-monaco-configuration';

describe('Monaco editor configuration', () => {
  test('ignores only diagnostics that require repository access', () => {
    const applied: Record<string, unknown>[] = [];
    const makeDefaults = (diagnosticCodesToIgnore: number[]) => ({
      getDiagnosticsOptions: () => ({
        noSyntaxValidation: false,
        noSemanticValidation: false,
        diagnosticCodesToIgnore,
      }),
      setDiagnosticsOptions: (options: Record<string, unknown>) => applied.push(options),
    });

    configureMonacoTypeScriptDiagnostics({
      typescriptDefaults: makeDefaults([9999]),
      javascriptDefaults: makeDefaults([2307]),
    });

    expect(MONACO_WORKSPACE_ONLY_DIAGNOSTIC_CODES).toEqual([2307]);
    expect(applied).toEqual([
      {
        noSyntaxValidation: false,
        noSemanticValidation: false,
        diagnosticCodesToIgnore: [9999, 2307],
      },
      {
        noSyntaxValidation: false,
        noSemanticValidation: false,
        diagnosticCodesToIgnore: [2307],
      },
    ]);
  });
});
