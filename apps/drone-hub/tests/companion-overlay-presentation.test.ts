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

  test('supports hiding manual reviews and exposes session execution history', () => {
    const source = readFileSync(
      new URL('../src/droneHub/companion/CompanionOverlay.tsx', import.meta.url),
      'utf8',
    );
    const menu = readFileSync(
      new URL('../src/droneHub/companion/CompanionOptionsMenu.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('<CompanionProposalStrip');
    expect(source).toContain('if (targetId === companion.selectedProposalId) setProposalHidden((hidden) => !hidden);');
    expect(source).toContain('React.useEffect(() => { setProposalHidden(false); }, [companion?.selectedProposalId]);');
    expect(source).not.toContain('companion.proposals?.length > 1');
    expect(menu).toContain('latest execution failed');
    expect(source).toContain('pressed={companion.autoApprove}');
    expect(menu).toContain('expanded={historyOpen}');
    expect(source).toContain('<CompanionProposalHistory');
    expect(menu).toContain("execution history");
    expect(menu).not.toContain('Show execution history (');
    expect(menu).not.toContain('Math.min(companion.proposalHistory.length');
    expect(source).toContain('double-tap Caps Lock to toggle');
  });

  test('keeps the Live voice on/off switch inside the options menu rather than the header row', () => {
    const source = readFileSync(
      new URL('../src/droneHub/companion/CompanionOverlay.tsx', import.meta.url),
      'utf8',
    );
    const menu = readFileSync(
      new URL('../src/droneHub/companion/CompanionOptionsMenu.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('toggleLiveVoice');
    expect(menu).toContain('label="Live voice"');
    expect(menu).toContain('checked={live.enabled}');
    expect(menu).toContain('onSelect={() => void companion.toggleLiveVoice()}');
  });
});
