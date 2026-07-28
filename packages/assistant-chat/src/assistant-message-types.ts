export type AssistantMessageContentPart = {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: any;
  id?: string;
  data?: string;
  mimeType?: string;
};

export type AssistantMessageDiagnosticError = {
  name?: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: AssistantMessageDiagnosticError;
};

export type AssistantMessageDiagnostic = {
  type: string;
  timestamp: number;
  error?: AssistantMessageDiagnosticError;
  details?: Record<string, unknown>;
};

export type AssistantMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'toolResult' | 'runSummary' | 'compaction';
  content?: string | AssistantMessageContentPart[];
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  errorMessage?: string;
  stopReason?: string;
  provider?: string;
  model?: string;
  diagnostics?: AssistantMessageDiagnostic[];
  details?: unknown;
  createdAt?: string;
  timestamp?: string | number;
  meshTruncated?: boolean;
};

export type AssistantDroneNameMap = Record<string, string>;
