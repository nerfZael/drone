import React from 'react';
import { mergeImportedEnvIntoDraftEntries, parseDotenvText, type EnvDraftEntry } from './env-utils';

type UseEnvDraftImportOptions = {
  setEntries: React.Dispatch<React.SetStateAction<EnvDraftEntry[]>>;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
  importedMessage: (count: number) => string;
};

export function useEnvDraftImport({
  setEntries,
  setNotice,
  importedMessage,
}: UseEnvDraftImportOptions) {
  const [importText, setImportText] = React.useState('');

  const applyImportVars = React.useCallback((incoming: Record<string, string>) => {
    const importedCount = Object.keys(incoming).length;
    if (importedCount === 0) return 0;
    setEntries((prev) => mergeImportedEnvIntoDraftEntries(prev, incoming));
    return importedCount;
  }, [setEntries]);

  const applyParsedImport = React.useCallback((vars: Record<string, string>, warnings: string[]) => {
    const importedCount = applyImportVars(vars);
    if (importedCount > 0 && warnings.length > 0) {
      setNotice(`${importedMessage(importedCount)} ${warnings[0] ?? 'Some lines were ignored during import.'}`);
      return;
    }
    if (importedCount > 0) {
      setNotice(importedMessage(importedCount));
      return;
    }
    if (warnings.length > 0) {
      setNotice(warnings[0] ?? 'Some lines were ignored during import.');
    }
  }, [applyImportVars, importedMessage, setNotice]);

  const importFromText = React.useCallback(() => {
    const parsed = parseDotenvText(importText);
    applyParsedImport(parsed.vars, parsed.warnings);
  }, [applyParsedImport, importText]);

  const importFromFile = React.useCallback(async (file: File | null) => {
    if (!file) return;
    const parsed = parseDotenvText(await file.text());
    applyParsedImport(parsed.vars, parsed.warnings);
  }, [applyParsedImport]);

  return {
    importText,
    setImportText,
    importFromText,
    importFromFile,
  };
}
