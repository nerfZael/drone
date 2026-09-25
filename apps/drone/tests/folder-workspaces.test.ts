import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertInsideFolderWorkspace, registerFolderWorkspace, resolveFolderWorkspace } from '../src/hub/folder-workspaces';

test('folder workspaces resolve to a confined host drone, and paths outside their root are refused', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'folder-ws-'));
  try {
    registerFolderWorkspace({ id: 'test-folder', name: 'Test folder', root: async () => root });
    const resolved = await resolveFolderWorkspace('test-folder');
    expect(resolved?.drone).toMatchObject({ id: 'test-folder', runtime: 'host', cwd: root, confineRoot: root });
    expect(await resolveFolderWorkspace('some-real-drone')).toBeNull();
    expect(() => assertInsideFolderWorkspace(root, path.join(root, 'src/app.ts'))).not.toThrow();
    expect(() => assertInsideFolderWorkspace(root, 'src/app.ts')).not.toThrow();
    for (const outside of ['/etc/passwd', path.join(root, '..'), path.join(root, '../other')]) {
      expect(() => assertInsideFolderWorkspace(root, outside)).toThrow('outside this workspace');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
