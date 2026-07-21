import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('mobile sidebar presentation', () => {
  test('keeps repository rows path-free and aligned with desktop state glyphs', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AppDrawer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('styles.repoPath');
    expect(source).toContain('<ApprovalStatusIndicator />');
    expect(source).toContain('<WorkingStatusIndicator />');
    expect(source).toContain('<UnreadStatusIndicator />');
    expect(source).toContain("repoCopy: { flex: 1, minWidth: 0, justifyContent: 'center' }");
  });

  test('omits the selected-drone subtitle while preserving contextual create copy', () => {
    const dronesSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const shellSource = readFileSync(
      new URL('../src/shell/MeshApp.tsx', import.meta.url),
      'utf8',
    );

    expect(dronesSource).not.toContain('mobileRepoLabel(selected.repoPath)');
    expect(dronesSource).toContain("subtitle: `Create on ${activeTarget?.name ?? 'this device'}`");
    expect(shellSource).toContain('dronesHeader?.subtitle ?');
  });
});
