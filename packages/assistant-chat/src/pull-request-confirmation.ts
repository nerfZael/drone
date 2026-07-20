export type PullRequestConfirmationCopy = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
};

function capitalize(text: string): string {
  return text ? `${text[0]?.toUpperCase()}${text.slice(1)}` : text;
}

export function pullRequestMergeConfirmation(input: {
  pullNumber: number;
  baseRefName?: string | null;
  method?: 'merge' | 'squash' | 'rebase';
  forceReason?: string | null;
}): PullRequestConfirmationCopy {
  const forceReason = String(input.forceReason ?? '').trim();
  const method = input.method ?? 'merge';
  const methodLabel = method === 'merge' ? 'a merge commit' : method === 'squash' ? 'squash merging' : 'rebasing';
  return {
    title: `${forceReason ? 'Force merge' : 'Merge'} PR #${input.pullNumber}?`,
    message: `${forceReason ? `${capitalize(forceReason)}. ` : ''}Merge into ${String(input.baseRefName ?? '').trim() || 'the base branch'} using ${methodLabel}.`,
    confirmLabel: forceReason ? 'Force merge' : 'Merge',
    destructive: Boolean(forceReason),
  };
}

export function pullRequestCloseConfirmation(input: {
  pullNumber: number;
}): PullRequestConfirmationCopy {
  return {
    title: `Close PR #${input.pullNumber}?`,
    message: 'This closes the pull request without merging it.',
    confirmLabel: 'Close pull request',
    destructive: true,
  };
}
