import {
  COMPANION_PROPOSAL_FORMAT, COMPANION_PROPOSAL_PATH, COMPANION_PROPOSAL_TARGET_ID,
  EMPTY_COMPANION_PROPOSAL, parseCompanionProposalText, serializeCompanionProposal,
  type CompanionProposal, type CompanionProposalExecution, type CompanionProposalExecutionContext,
} from './companion-proposal.js';

export type ProposalStatus = 'draft' | 'executing' | 'failed' | 'applied' | 'discarded';
export type ProposalEntry<C extends CompanionProposalExecutionContext> = {
  id: string;
  revision: number;
  proposal: CompanionProposal;
  context: C | null;
  sessionId: string | null;
  status: ProposalStatus;
  execution: CompanionProposalExecution | null;
  visible: boolean;
};
export type ProposalSummary = { targetId: string; revision: string; title: string; status: ProposalStatus; operationCount: number; defaultRepoPath: string | null; targetDeviceId?: string };

/** Session-owned documents. Execution is single-shot per document and serialized across documents. */
export class CompanionProposalStore<C extends CompanionProposalExecutionContext> {
  private entries = new Map<string, ProposalEntry<C>>();
  private listeners = new Set<() => void>();
  private version = 0;
  private legacyRevision = 0;
  selectedId: string | null = null;
  executingId: string | null = null;
  readonly history: Array<{ entry: ProposalEntry<C>; execution: CompanionProposalExecution; autoApproved: boolean }> = [];
  constructor(private readonly createId: () => string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  private publish() { this.version++; for (const listener of this.listeners) listener(); }
  get selected() { return this.selectedId ? this.entries.get(this.selectedId) ?? null : null; }
  /** Proposals the user can review: pending and holding at least one operation. Empty drafts stay out of the UI until Companion fills them. */
  get pending() { return [...this.entries.values()].filter(e => this.reviewable(e)); }
  private reviewable(entry: ProposalEntry<C>) {
    return entry.visible && ['draft', 'executing', 'failed'].includes(entry.status) && entry.proposal.operations.length > 0;
  }
  private summarize(e: ProposalEntry<C>): ProposalSummary {
    return {
      targetId: e.id, revision: String(e.revision), title: e.proposal.title,
      status: e.status, operationCount: e.proposal.operations.length, defaultRepoPath: e.context?.defaultRepoPath ?? null,
      ...(e.context && 'targetDeviceId' in e.context && typeof e.context.targetDeviceId === 'string' ? { targetDeviceId: e.context.targetDeviceId } : {}),
    };
  }
  /** Every document Companion can address, including empty drafts it has just created. */
  list(): ProposalSummary[] { return [...this.entries.values()].filter(e => e.visible).map(e => this.summarize(e)); }
  /** Review-card order: the numbered strip and the selection fall back to the first entry here. */
  listPending(): ProposalSummary[] { return this.pending.map(e => this.summarize(e)); }
  select(id: string) {
    const entry = this.get(id);
    if (!this.reviewable(entry)) throw new Error('PROPOSAL_NOT_PENDING');
    this.selectedId = id; this.publish();
  }
  /** Bring a proposal under review only when nothing else is; an open review is never replaced. */
  selectIfUnreviewed(id: string) {
    this.get(id);
    this.reconcileSelection(id);
    this.publish();
  }
  /** Keep the review selection on a reviewable proposal; a freshly filled draft takes over only when nothing else is under review. */
  private reconcileSelection(changedId: string) {
    const selected = this.selected;
    if (selected && this.reviewable(selected)) return;
    const changed = this.entries.get(changedId);
    this.selectedId = changed && this.reviewable(changed) ? changedId : this.pending[0]?.id ?? null;
  }
  private get newestDraftId(): string | null {
    return [...this.entries.values()].reverse().find(e => e.visible && e.status === 'draft')?.id ?? null;
  }
  private get(id: string): ProposalEntry<C> {
    // Compatibility for clients holding the former session-owned document.
    if (id === COMPANION_PROPOSAL_TARGET_ID && !this.entries.has(id)) {
      this.entries.set(id, { id, revision: this.legacyRevision, proposal: { ...EMPTY_COMPANION_PROPOSAL, operations: [] },
        context: null, sessionId: null, status: 'draft', execution: null, visible: false });
    }
    const entry = this.entries.get(id);
    if (!entry) throw new Error('STALE_PROPOSAL_TARGET');
    return entry;
  }
  create(context: C, sessionId: string | null, title?: string) {
    const id = this.createId();
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id) || this.entries.has(id)) throw new Error('INVALID_PROPOSAL_ID');
    const proposal = parseCompanionProposalText(JSON.stringify({ ...EMPTY_COMPANION_PROPOSAL, title: title ?? EMPTY_COMPANION_PROPOSAL.title }));
    // Empty drafts are not selected for review; Companion addresses them by targetId until it adds operations.
    this.entries.set(id, { id, revision: 0, proposal, context, sessionId, status: 'draft', execution: null, visible: true });
    this.publish();
    return this.read(id);
  }
  read(id = this.selectedId ?? this.newestDraftId ?? COMPANION_PROPOSAL_TARGET_ID) {
    const entry = this.get(id);
    return { targetId: id, path: id === COMPANION_PROPOSAL_TARGET_ID ? COMPANION_PROPOSAL_PATH : `proposals/${id}.json`,
      content: serializeCompanionProposal(entry.proposal), revision: String(entry.revision),
      mode: entry.status === 'draft' ? 'edit' as const : 'readonly' as const,
      status: entry.status, format: COMPANION_PROPOSAL_FORMAT };
  }
  check(id: string, revision: string) {
    const entry = this.get(id);
    if (revision !== String(entry.revision)) throw new Error('STALE_PROPOSAL_REVISION');
    return entry;
  }
  patch(id: string, revision: string, content: string, context: () => C, sessionId: string | null) {
    const entry = this.check(id, revision);
    this.editable(entry);
    const proposal = parseCompanionProposalText(content);
    const next = { ...entry, proposal, revision: entry.revision + 1, context: entry.context ?? context(),
      sessionId: entry.sessionId ?? sessionId, visible: true };
    this.entries.set(id, next);
    this.reconcileSelection(id);
    this.publish();
    return { ok: true as const, targetId: id, revision: String(next.revision), operationCount: proposal.operations.length };
  }
  private editable(entry: ProposalEntry<C>) {
    if (entry.status === 'executing') throw new Error('PROPOSAL_EXECUTION_IN_PROGRESS');
    if (entry.status === 'discarded') throw new Error('PROPOSAL_DISCARDED');
    if (entry.status !== 'draft') throw new Error('PROPOSAL_ALREADY_EXECUTED');
  }
  ready(id: string, revision: string) {
    const entry = this.check(id, revision);
    this.editable(entry);
    if (!entry.proposal.operations.length) throw new Error('EMPTY_PROPOSAL');
    if (!entry.context) throw new Error('PROPOSAL_EXECUTION_UNAVAILABLE');
    return entry;
  }
  begin(id: string, revision: string) {
    const entry = this.ready(id, revision);
    if (this.executingId) throw new Error('PROPOSAL_EXECUTION_IN_PROGRESS');
    const running = { ...entry, status: 'executing' as const };
    this.entries.set(id, running); this.executingId = id; this.publish();
    return running;
  }
  finish(entry: ProposalEntry<C>, execution: CompanionProposalExecution, autoApproved: boolean) {
    if (this.entries.get(entry.id) !== entry) return false;
    this.entries.set(entry.id, { ...entry, execution, status: execution.ok ? 'applied' : 'failed' });
    this.history.push({ entry, execution, autoApproved });
    this.executingId = null;
    if (execution.ok) this.retire(entry.id);
    this.publish(); return true;
  }
  discard(id: string, revision: string) {
    const entry = this.check(id, revision);
    if (entry.status === 'executing') throw new Error('PROPOSAL_EXECUTION_IN_PROGRESS');
    this.entries.set(id, { ...entry, status: 'discarded' });
    this.retire(id); this.publish();
    return { ok: true as const, targetId: id, discarded: true };
  }
  private retire(id: string) {
    if (id === COMPANION_PROPOSAL_TARGET_ID) {
      this.legacyRevision = this.get(id).revision + 1;
      this.entries.delete(id);
    }
    if (this.selectedId === id) this.selectedId = this.pending[0]?.id ?? null;
  }
  clear() {
    this.legacyRevision = Math.max(this.legacyRevision, this.entries.get(COMPANION_PROPOSAL_TARGET_ID)?.revision ?? 0) + 1;
    this.entries.clear(); this.history.length = 0; this.selectedId = null; this.executingId = null; this.publish();
  }
}
