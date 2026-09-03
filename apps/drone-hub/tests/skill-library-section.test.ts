import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const sectionSource = readFileSync(
  new URL('../src/droneHub/app/SkillLibrarySection.tsx', import.meta.url),
  'utf8',
);
const hookSource = readFileSync(
  new URL('../src/droneHub/app/use-skill-library.ts', import.meta.url),
  'utf8',
);

describe('skill library settings navigation', () => {
  test('defaults to Skills before Import and exposes Details and Files modes', () => {
    expect(sectionSource).toContain("useState<'skills' | 'import'>('skills')");
    expect(sectionSource.indexOf("value: 'skills', label: 'Skills'")).toBeLessThan(
      sectionSource.indexOf("value: 'import', label: 'Import'"),
    );
    expect(sectionSource).toContain("value: 'details', label: 'Details'");
    expect(sectionSource).toContain("value: 'files', label: 'Files'");
    expect(sectionSource).toContain('<SkillFilesWorkspace skillLibrary={skillLibrary} />');
  });

  test('reverts both details and in-memory package state through the shared selection reset', () => {
    const resetDraftSource = hookSource.slice(
      hookSource.indexOf('const resetDraft'),
      hookSource.indexOf('const saveDraft'),
    );
    expect(resetDraftSource).toContain('applySelectedSkill(selectedSkill)');
  });

  test('updates the selected-skill ref synchronously before query-cache effects run', () => {
    const applySelectionSource = hookSource.slice(
      hookSource.indexOf('const applySelectedSkill'),
      hookSource.indexOf('React.useEffect(() =>', hookSource.indexOf('const applySelectedSkill')),
    );
    expect(applySelectionSource).toContain('selectedSkillIdRef.current = skill?.id ?? null');
  });

  test('does not overwrite an unsaved draft after a background skills refetch', () => {
    expect(hookSource).toContain('if (draftDirtyRef.current) return;');
  });

  test('the Monaco save shortcut invokes the latest save callback', () => {
    const workspaceSource = readFileSync(
      new URL('../src/droneHub/app/SkillTextEditor.tsx', import.meta.url),
      'utf8',
    );
    expect(workspaceSource).toContain('const onSaveRef = React.useRef(onSave);');
    expect(workspaceSource).toContain('onSaveRef.current = onSave;');
    expect(workspaceSource).toContain('() => onSaveRef.current()');
    expect(workspaceSource).not.toContain('monaco.KeyCode.KeyS, onSave');
    expect(workspaceSource).toContain('monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter');
    expect(workspaceSource).toContain('monaco.KeyMod.WinCtrl | monaco.KeyCode.Enter');
    expect(workspaceSource).toContain("key === 's' || key === 'enter'");
    expect(workspaceSource).toContain('!event.shiftKey');
    expect(workspaceSource).toContain('!event.altKey');
    expect(workspaceSource).toContain(
      'aria-keyshortcuts="Control+S Meta+S Control+Enter Meta+Enter"',
    );
    expect(workspaceSource).toContain('nonBasicASCII: false');
    expect(workspaceSource).toContain('ambiguousCharacters: false');
    expect(workspaceSource).toContain('invisibleCharacters: true');
  });
});
