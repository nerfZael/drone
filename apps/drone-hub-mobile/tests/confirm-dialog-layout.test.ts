import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('mobile confirmation dialog layout', () => {
  test('keeps the warning mark and title in one header row', () => {
    const source = readFileSync(new URL('../src/components/Ui.tsx', import.meta.url), 'utf8');
    const dialogStart = source.indexOf('export function ConfirmDialog');
    const dialogEnd = source.indexOf('export function TextInputDialog', dialogStart);
    const dialogSource = source.slice(dialogStart, dialogEnd);

    expect(dialogSource).toContain('<View style={styles.dialogHeader}>');
    expect(dialogSource.indexOf('styles.dialogMark')).toBeLessThan(
      dialogSource.indexOf('styles.dialogHeaderTitle'),
    );
    expect(source).toContain(
      "dialogHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 }",
    );
  });
});
