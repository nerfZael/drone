import { getUsageStore, type UsageStore } from './UsageStore';
import { parseBuiltinPromptJobTranscript } from '../builtin-transcript-sessions';
import { getUsageJournal, type UsageJournal, type UsageDelivery } from './UsageJournal';

export function recordExternalUsage(input: { job: any; droneId: string; chatId: string; chatName: string; repo?: string; model?: string }, journal: UsageJournal = getUsageJournal(), destination?: UsageStore): void {
  const { job } = input;
  if (!job) return;
  const watch = { droneId: input.droneId, promptId: String(job.id ?? ''), chatId: input.chatId,
    chatName: input.chatName, repo: input.repo, model: input.model };
  journal.watch(watch);
  const run = job.codexAppServer?.run;
  const state = run?.state ?? job.state;
  if (state === 'queued') return;
  const transcript = job.transcript ?? parseBuiltinPromptJobTranscript(job.kind, job.stdout ?? '');
  const configured = input.model ?? transcript?.model ?? 'unknown';
  const observations = (transcript?.usage ?? []).map((item: any) => {
    let model = item.model === 'unknown' && job.kind !== 'codex' ? configured : item.model;
    let provider = item.provider;
    if (job.kind === 'opencode' && model.includes('/')) {
      const slash = model.indexOf('/');
      provider = model.slice(0, slash); model = model.slice(slash + 1);
    }
    return { ...item, model, provider };
  });
  const delivery: UsageDelivery = { execution: { id: job.codexAppServer?.runId
      ? `external:${input.droneId}:${job.codexAppServer.runId}`
      : `external:${input.droneId}:${job.id}:${job.startedAt ?? job.createdAt}`,
    chatId: input.chatId, droneId: input.droneId, chatName: input.chatName, repo: input.repo,
    agent: job.kind, startedAt: run?.startedAt ?? job.startedAt ?? job.createdAt, status: state,
    snapshotAt: run?.updatedAt ?? job.updatedAt ?? transcript?.parsedAt,
  }, observations, replace: true };
  if (['done', 'failed', 'canceled'].includes(state) && job.exitStatusSource !== 'missing-exit-file') {
    journal.complete(watch, delivery);
  } else journal.append(delivery);
  try {
    const store = destination ?? getUsageStore();
    store.bindChat(input.chatId, input.droneId, input.chatName, input.repo);
    journal.drain(store);
  } catch (error) {
    console.warn('External usage delivery pending:', error instanceof Error ? error.message : String(error));
  }
}
