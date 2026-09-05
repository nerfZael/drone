import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('mobile file explorer presentation', () => {
  test('centers the initial loading state vertically in the available explorer space', () => {
    const source = readFileSync(
      new URL('../src/drones/MobileFileExplorer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      'contentContainerStyle={[styles.content, rows.length === 0 && styles.emptyContent]}',
    );
    expect(source).toContain('emptyContent: { flexGrow: 1 }');
    expect(source).toContain('centerState: {\n    flex: 1,');
    expect(source).toContain("justifyContent: 'center'");
    expect(source).toContain('Loading workspace…');
  });

  test('uses the polished tree treatment and exposes inline item actions', () => {
    const source = readFileSync(
      new URL('../src/drones/MobileFileExplorer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('value?.isGitIgnored === true');
    expect(source).toContain("backgroundColor: 'rgba(127, 132, 156, 0.28)'");
    expect(source).toContain('onLongPress={() => {');
    expect(source).toContain("beginAction('rename', actionMenuEntry)");
    expect(source).toContain("beginAction('create-file', actionMenuEntry ?? null)");
    expect(source).toContain("beginAction('create-directory', actionMenuEntry ?? null)");
    expect(source).toContain("requestDroneControl(targetId, 'file.action'");
    expect(source).toContain('style={styles.inlineNameInput}');
  });

  test('keeps the explorer open when another file is selected and wraps previews by default', () => {
    const source = readFileSync(
      new URL('../src/drones/FilePreviewModal.tsx', import.meta.url),
      'utf8',
    );
    const openPathBody = source.slice(
      source.indexOf('const openExplorerPath'),
      source.indexOf('const saveDraft'),
    );

    expect(openPathBody).toContain('onOpenPath(path)');
    expect(openPathBody).not.toContain('setExplorerExpanded(false)');
    expect(source).toContain('const [wordWrap, setWordWrap] = React.useState(true)');
    expect(source).toContain('wordWrap ? (');
    expect(source).toContain('<View style={[styles.textRow, styles.textRowWrapped]}>');
    expect(source).toContain(
      '<ScrollView\n          horizontal\n          showsHorizontalScrollIndicator',
    );
    expect(source).toContain(
      "accessibilityLabel={wordWrap ? 'Turn off word wrap' : 'Turn on word wrap'}",
    );
    expect(source).toContain('active={visible && (explorerExpanded || explorerDragging)}');
  });

  test('loads the root directory only while the explorer is open', () => {
    const source = readFileSync(
      new URL('../src/drones/MobileFileExplorer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      'if (!active) return;\n    const cachedRoot = directoriesRef.current[rootPath];\n    void loadDirectory(rootPath, Boolean(cachedRoot?.loaded || cachedRoot?.loading));',
    );
    expect(source).not.toContain('void loadDirectory(rootPath, true);');
  });

  test('keeps stale root and child rows visible with retryable refresh errors', () => {
    const explorer = readFileSync(
      new URL('../src/drones/MobileFileExplorer.tsx', import.meta.url),
      'utf8',
    );
    expect(explorer).toContain("mobileDirectoryErrorMode(root) === 'stale'");
    expect(explorer).toContain('accessibilityLabel="Retry workspace refresh"');
    expect(explorer).toContain('if (child?.error) {');
    expect(explorer).toContain('visit(entry.path, depth + 1);');
    expect(explorer).toContain('contextVersionRef.current !== requestContextVersion');
    expect(explorer).toContain('directoryRequestSeqRef.current[path] !== requestSeq');
    expect(explorer).toContain('directoryRequestsRef.current.begin(path, force)');
    expect(explorer).toContain('directoryRequestsRef.current.finish(path, requestToken)');
    expect(explorer).toContain('void loadDirectoryRef.current?.(path, true)');
    expect(explorer).toContain('directoryAbortControllersRef.current.set(path, requestController)');
    expect(explorer).toContain('requestController.signal');
    expect(explorer).toContain(
      'for (const controller of directoryAbortControllersRef.current.values()) controller.abort()',
    );
  });

  test('renders background preview failures without replacing cached content', () => {
    const modal = readFileSync(
      new URL('../src/drones/FilePreviewModal.tsx', import.meta.url),
      'utf8',
    );
    const refreshBanner = modal.indexOf('refreshError && preview');
    const blockingError = modal.indexOf(': error ? (', refreshBanner);
    expect(refreshBanner).toBeGreaterThan(-1);
    expect(blockingError).toBeGreaterThan(refreshBanner);
    expect(modal).toContain('accessibilityLabel="Retry file preview refresh"');
    const hook = readFileSync(
      new URL('../src/drones/use-file-preview.ts', import.meta.url),
      'utf8',
    );
    expect(hook).toContain('refreshError: requestIsCurrent ? refreshError : null');
    expect(hook).toContain('loadAbortRef.current?.abort()');
    expect(hook).toContain('signal: loadController.signal');
  });
});
