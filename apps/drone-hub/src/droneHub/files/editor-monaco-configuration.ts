type MonacoDiagnosticsOptions = {
  diagnosticCodesToIgnore?: number[];
  [key: string]: unknown;
};

type MonacoLanguageDefaults = {
  getDiagnosticsOptions: () => MonacoDiagnosticsOptions;
  setDiagnosticsOptions: (options: MonacoDiagnosticsOptions) => void;
};

type MonacoTypeScriptLanguages = {
  javascriptDefaults: MonacoLanguageDefaults;
  typescriptDefaults: MonacoLanguageDefaults;
};

// Monaco's browser worker cannot read the repository, so otherwise-valid imports
// are reported as missing until every dependency happens to be opened as a model.
export const MONACO_WORKSPACE_ONLY_DIAGNOSTIC_CODES = [2307] as const;

export function configureMonacoTypeScriptDiagnostics(
  languages: MonacoTypeScriptLanguages,
): void {
  for (const defaults of [languages.typescriptDefaults, languages.javascriptDefaults]) {
    const current = defaults.getDiagnosticsOptions();
    defaults.setDiagnosticsOptions({
      ...current,
      diagnosticCodesToIgnore: [
        ...new Set([
          ...(current.diagnosticCodesToIgnore ?? []),
          ...MONACO_WORKSPACE_ONLY_DIAGNOSTIC_CODES,
        ]),
      ],
    });
  }
}

