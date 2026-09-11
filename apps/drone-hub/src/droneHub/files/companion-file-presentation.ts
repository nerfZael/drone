export const COMPANION_FILE_PRESENTATION = 'drone-hub:companion-file-presentation';
export type FilePresentation = 'tabs' | 'panes';
export type PresentedFile = { tabId: string; path: string; name: string };

export function presentCompanionFiles(
  droneId: string,
  files: PresentedFile[],
  presentation: FilePresentation,
): string[] {
  const detail: {
    droneId: string;
    files: PresentedFile[];
    presentation: FilePresentation;
    panelIds?: string[];
    error?: string;
  } = { droneId, files, presentation };
  window.dispatchEvent(new CustomEvent(COMPANION_FILE_PRESENTATION, { detail }));
  if (detail.error) throw new Error(detail.error);
  if (!detail.panelIds) throw new Error('EDITOR_WORKSPACE_NOT_READY');
  return detail.panelIds;
}
