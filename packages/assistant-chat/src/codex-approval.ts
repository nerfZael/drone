export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export type CodexPendingApproval = {
  id: string;
  promptId: string;
  method:
    | 'item/commandExecution/requestApproval'
    | 'item/fileChange/requestApproval'
    | 'item/permissions/requestApproval'
    | 'execCommandApproval'
    | 'applyPatchApproval';
  kind: 'command_execution' | 'file_change' | 'permissions';
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  permissions?: unknown;
  item?: unknown;
  detailsTruncated?: boolean;
  availableDecisions: CodexApprovalDecision[];
  createdAt: string;
  status: 'pending';
};
