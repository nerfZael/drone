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

  test('hides auto-approved proposal cards and exposes session execution history', () => {
    const source = readFileSync(
      new URL('../src/droneHub/companion/CompanionOverlay.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("companion.status === 'error' || companion.status === 'cancelled'");
    expect(source).toContain('latest execution failed');
    expect(source).toContain('pressed={companion.autoApprove}');
    expect(source).toContain('expanded={historyOpen}');
    expect(source).toContain('<CompanionProposalHistory');
    expect(source).toContain('Show execution history');
    expect(source).toContain('double-tap Caps Lock to toggle');
  });
});
