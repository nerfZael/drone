import type { CodexPendingApproval } from '@drone/assistant-chat';

import type { AgentApprovalPolicy, ChatAgentConfig } from './chat-types';
import type { PendingPrompt } from './drone-pending-prompts';

export type CodexNeverAskApprovalRef = {
  promptId: string;
  approvalId: string;
  decision: 'accept' | 'acceptForSession';
};

export function pendingCodexApprovalsForNeverAsk(input: {
  agent: ChatAgentConfig;
  approvalPolicy: AgentApprovalPolicy;
  pendingPrompts: PendingPrompt[];
}): CodexNeverAskApprovalRef[] {
  if (
    input.approvalPolicy !== 'none' ||
    input.agent.kind !== 'builtin' ||
    input.agent.id !== 'codex'
  ) {
    return [];
  }

  const seen = new Set<string>();
  const refs: CodexNeverAskApprovalRef[] = [];
  for (const prompt of input.pendingPrompts) {
    const promptId = String(prompt?.id ?? '').trim();
    if (!promptId || !Array.isArray(prompt?.approvals)) continue;
    for (const approval of prompt.approvals as CodexPendingApproval[]) {
      const approvalId = String(approval?.id ?? '').trim();
      if (!approvalId || approval?.status !== 'pending') continue;
      const approvalPromptId = String(approval?.promptId ?? '').trim() || promptId;
      const decision = approval.availableDecisions?.includes('accept')
        ? 'accept'
        : approval.availableDecisions?.includes('acceptForSession')
          ? 'acceptForSession'
          : null;
      if (!decision) continue;
      const key = `${approvalPromptId}\0${approvalId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ promptId: approvalPromptId, approvalId, decision });
    }
  }
  return refs;
}
