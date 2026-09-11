import type { CompactionPlan } from '../prepareCompaction.js';

/** Keep the displayed file inventory within one fifth of the checkpoint budget.
 * The checkpoint's details retain every path, even when this preview is bounded.
 */
export function compactionFileMetadata(details: CompactionPlan['details'], summaryTokens: number): string {
  const limit = Math.floor(summaryTokens / 5) * 4;
  const heading = '\n\n## File Metadata\n';
  const omitted = '\n- Additional paths are stored in checkpoint metadata.';
  if (limit < heading.length + omitted.length) return '';
  const lines: string[] = [];
  let length = heading.length;
  for (const [label, paths] of [['Modified', details.modifiedFiles], ['Read', details.readFiles]] as const) {
    for (const file of paths) {
      const line = `- ${label}: ${file}\n`;
      if (length + line.length + omitted.length > limit) return heading + lines.join('') + omitted;
      lines.push(line);
      length += line.length;
    }
  }
  return heading + (lines.length ? lines.join('').trimEnd() : '- No files recorded.');
}
