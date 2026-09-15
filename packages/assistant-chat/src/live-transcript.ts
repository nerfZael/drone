export type LiveTranscriptRow = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  startMs?: number;
  endMs?: number;
};
type Fragment = { text: string; order: number; startMs?: number; endMs?: number };
type Group = { id: number; role: LiveTranscriptRow['role']; fragments: Fragment[]; startMs?: number; endMs?: number };
// A display grouping heuristic, never an end-of-turn or permission signal.
const GROUP_GAP_MS = 1_200;

/** Keep each speaker's timestamped fragments together across backchannels. */
export class LiveTranscript {
  private groups: Group[] = [];
  private order = 0;

  append(role: LiveTranscriptRow['role'], text: string, start: unknown, end: unknown): void {
    const timed = typeof start === 'number' && Number.isFinite(start) && start >= 0 &&
      typeof end === 'number' && Number.isFinite(end) && end >= start;
    const fragment: Fragment = { text, order: ++this.order, ...(timed ? { startMs: start, endMs: end } : {}) };
    let group: Group | undefined;
    if (timed) {
      // A late fragment can bridge two provisional groups. Keep the older ID.
      const matching = this.groups.filter(g => g.role === role && g.startMs !== undefined && g.endMs !== undefined &&
        start <= g.endMs + GROUP_GAP_MS && end >= g.startMs - GROUP_GAP_MS);
      group = matching.sort((a, b) => a.id - b.id)[0];
      if (group) {
        for (const other of matching.slice(1)) {
          group.fragments.push(...other.fragments);
          this.groups.splice(this.groups.indexOf(other), 1);
        }
      }
    } else {
      // Preserve legacy event behavior when timestamps are unavailable.
      const last = this.groups[this.groups.length - 1];
      if (last?.role === role && last.startMs === undefined) group = last;
    }
    if (!group) { group = { id: fragment.order, role, fragments: [] }; this.groups.push(group); }
    group.fragments.push(fragment);
    this.refresh(group);
    this.groups.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.id - b.id);
    this.trim();
  }

  rows(): LiveTranscriptRow[] {
    return this.groups.map(g => ({ id: g.id, role: g.role, text: g.fragments.map(f => f.text).join(''),
      ...(g.startMs !== undefined ? { startMs: g.startMs, endMs: g.endMs } : {}) }));
  }

  private refresh(group: Group): void {
    group.fragments.sort((a, b) => a.startMs !== undefined && b.startMs !== undefined ? a.startMs - b.startMs || a.order - b.order : a.order - b.order);
    group.startMs = group.fragments[0]?.startMs;
    group.endMs = group.startMs === undefined ? undefined : Math.max(...group.fragments.map(f => f.endMs!));
  }

  private trim(): void {
    let length = this.groups.reduce((n, g) => n + 20 + g.fragments.reduce((m, f) => m + f.text.length, 0), 0);
    let fragments = this.groups.reduce((n, g) => n + g.fragments.length, 0);
    while (length > 18_000 || fragments > 2_000) {
      const first = this.groups[0];
      if (fragments === 1) {
        first.fragments[0].text = first.fragments[0].text.slice(-17_980);
        break;
      }
      const removed = first.fragments.shift()!;
      length -= removed.text.length; fragments--;
      if (!first.fragments.length) { this.groups.shift(); length -= 20; }
      else this.refresh(first);
    }
  }
}
