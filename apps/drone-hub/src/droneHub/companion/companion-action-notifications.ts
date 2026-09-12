import {
  companionProposalOperationLabel,
  type CompanionProposal,
  type CompanionProposalOperation,
  type CompanionProposalExecutionItem,
} from '@drone/assistant-chat';

export type CompanionActionNotification = {
  id: string;
  label: string;
  operation: CompanionProposalOperation;
  droneName: string;
  status: 'completed' | 'failed';
  error?: string;
  createdAt: number;
};

// Only executed proposal mutations produce notifications. Tool activity also
// contains file, navigation, and layout actions and must not feed this stream.
export function createCompanionActionReporter(
  proposal: CompanionProposal,
  droneNames: Readonly<Record<string, string>>,
  publish: (notifications: CompanionActionNotification[]) => void,
) {
  const reported = new Set<string>();
  const names = { ...droneNames };
  return (results: CompanionProposalExecutionItem[]) => {
    const notifications: CompanionActionNotification[] = [];
    for (const result of results) {
      if (reported.has(result.id) || result.status === 'skipped') continue;
      const operation = proposal.operations.find((item) => item.id === result.id && item.type === result.type);
      if (!operation) continue;
      reported.add(result.id);
      if (operation.type === 'create_drone' || operation.type === 'clone_drone') {
        names[`$${operation.id}`] = String(result.result?.droneName || operation.name || result.result?.droneId || 'new drone');
      }
      const namedOperation = operation.type === 'create_drone'
        ? { ...operation, name: names[`$${operation.id}`] }
        : operation;
      const droneName = 'droneId' in operation ? names[operation.droneId] || operation.droneId : '';
      const label = companionProposalOperationLabel(namedOperation, droneName);
      if (!label) continue;
      notifications.push({
        id: globalThis.crypto?.randomUUID?.() ?? `companion-action-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label,
        operation: namedOperation,
        droneName,
        status: result.status,
        error: result.error,
        createdAt: Date.now(),
      });
    }
    if (notifications.length) publish(notifications);
  };
}
