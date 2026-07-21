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

export type AssistantMessage = {
  id?: string;
  role: 'user' | 'assistant' | 'toolResult' | 'runSummary';
  content?: string | AssistantMessageContentPart[];
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  errorMessage?: string;
  details?: unknown;
  createdAt?: string;
  timestamp?: string | number;
  meshTruncated?: boolean;
};

export type AssistantDroneNameMap = Record<string, string>;
