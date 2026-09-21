import type { CompanionStatus } from './companion';
import type { CompanionProposal, CompanionProposalExecution } from './companion-proposal';

export type CompanionMirrorSnapshot = {
  status: CompanionStatus;
  liveStatus: 'idle' | 'connecting' | 'listening' | 'paused' | 'error';
  captions: string;
  reply: string;
  error: string;
  proposal: CompanionProposal | null;
  proposalRevision: number;
  proposalExecuting: boolean;
  proposalExecution: CompanionProposalExecution | null;
  proposalDefaultRepoPath: string;
  lastExecution: { proposal: CompanionProposal; execution: CompanionProposalExecution; defaultRepoPath: string } | null;
};

export type CompanionMirrorSession = CompanionMirrorSnapshot & {
  deviceId: string;
  deviceName: string;
  sessionId: string;
  connected: boolean;
  pending: boolean;
};

export type CompanionMirrorCommand = {
  commandId: string;
  sessionId: string;
  proposalRevision: number;
  action: 'approve' | 'discard';
  expiresAt: number;
};

export type CompanionMirrorState = { enabled: boolean; sessions: CompanionMirrorSession[] };
