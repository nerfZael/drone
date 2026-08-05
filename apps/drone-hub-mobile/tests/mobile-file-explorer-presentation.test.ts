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
});
