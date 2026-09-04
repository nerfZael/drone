import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('Companion overlay presentation', () => {
  test('keeps tool activity and individual calls collapsed by default', () => {
    const source = readFileSync(
      new URL('../src/droneHub/companion/CompanionOverlay.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('const [expanded, setExpanded] = React.useState(false)');
    expect(source).toMatch(/if \(companion\?\.status === 'idle'\) \{\s*setExpanded\(false\);/);
    expect(source).not.toContain("open={item.status === 'running'}");
  });
});
