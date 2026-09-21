import type { ProposalSummary } from './companion-proposal-store';
import type { CompanionStatus } from './companion';
import type { CompanionProposal, CompanionProposalExecution } from './companion-proposal';

export type CompanionMirrorSnapshot = {
  /** Optional additions let older phones keep publishing approval-only mirrors. */
  voiceControls?: boolean;
  muted?: boolean;
  screenMarkdown?: string;
  proposals?: ProposalSummary[];
  selectedProposalId?: string | null;
  history?: Array<{ proposal: CompanionProposal; execution: CompanionProposalExecution; defaultRepoPath: string }>;
  subscriptions?: Array<{ id: string; label: string; intent: string; status: string }>;
  activity?: Array<{ callId: string; label: string; status: string; error?: string }>;
  reviewNotice?: string;
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
  action: 'approve' | 'discard' | 'select_proposal' | 'mute' | 'unmute' | 'pause' | 'resume' | 'end_voice' | 'stop_turn';
  targetId?: string;
  expiresAt: number;
};

export type CompanionMirrorState = { enabled: boolean; sessions: CompanionMirrorSession[] };
