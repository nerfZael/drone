import type { ChatModelOption } from './app-types';

export { editorLanguageForPath } from '../code-languages';

export type DisplayedChatModel = {
  label: string;
  source: 'configured' | 'current' | 'default' | 'loading' | 'unknown' | 'unsupported';
};

export function resolveDisplayedChatModel(
  configuredModelRaw: string | null | undefined,
  discoveredModels: ChatModelOption[],
  discoveryLoading: boolean,
  discoverySupported = true,
): DisplayedChatModel {
  const configuredModel = String(configuredModelRaw ?? '').trim();
  if (configuredModel) return { label: configuredModel, source: 'configured' };
  if (!discoverySupported) return { label: 'Not reported', source: 'unsupported' };
  if (discoveryLoading) return { label: 'Detecting…', source: 'loading' };

  const currentModel = discoveredModels.find((model) => model.isCurrent && String(model.id ?? '').trim());
  if (currentModel) return { label: String(currentModel.id).trim(), source: 'current' };

  const defaultModel = discoveredModels.find((model) => model.isDefault && String(model.id ?? '').trim());
  if (defaultModel) return { label: String(defaultModel.id).trim(), source: 'default' };

  return { label: 'Default model', source: 'unknown' };
}

export function displayedChatModelTitle(model: DisplayedChatModel): string {
  if (model.source === 'configured') return `Model: ${model.label} (configured for this chat)`;
  if (model.source === 'current') return `Model: ${model.label} (reported as current by the agent CLI)`;
  if (model.source === 'default') return `Model: ${model.label} (reported as default by the agent CLI)`;
  if (model.source === 'loading') return 'Detecting the default model from the agent CLI';
  if (model.source === 'unsupported') return 'Model is not reported by this custom agent command';
  return 'Model: agent CLI default (the CLI did not report a specific model)';
}

export function formatAgentModelMetadata(agentLabelRaw: string, model: DisplayedChatModel): string {
  const agentLabel = String(agentLabelRaw ?? '').trim() || 'Not reported';
  return `${agentLabel} (${model.label})`;
}

export function formatEditorMtime(mtimeMs: number | null): string {
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs) || mtimeMs <= 0) return 'Unknown';
  try {
    return new Date(mtimeMs).toLocaleString();
  } catch {
    return 'Unknown';
  }
}

export function formatBytes(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${Math.floor(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let idx = 0;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx += 1;
  }
  const precision = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(precision)} ${units[idx]}`;
}

export function parseIsoMs(raw: string | null | undefined): number {
  const ms = Date.parse(String(raw ?? ''));
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

export function parseGithubPullRequestHref(
  hrefRaw: string,
): { owner: string; repo: string; pullNumber: number } | null {
  const href = String(hrefRaw ?? '').trim();
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || String(u.hostname || '').toLowerCase() !== 'github.com') return null;
  const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i.exec(String(u.pathname ?? '').trim());
  if (!m) return null;
  const owner = String(m[1] ?? '').trim().toLowerCase();
  const repo = String(m[2] ?? '').trim().toLowerCase();
  const pullNumber = Number(m[3]);
  if (!owner || !repo || !Number.isFinite(pullNumber) || pullNumber <= 0) return null;
  return { owner, repo, pullNumber: Math.floor(pullNumber) };
}
