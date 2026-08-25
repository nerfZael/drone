export type ChatQuestionChoice = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
};

export type ChatQuestion = {
  id: string;
  question: string;
  detailedExplanation?: string;
  importance: number;
  choices: ChatQuestionChoice[];
};

export type ChatQuestionResponse =
  | {
      questionId: string;
      outcome: 'choice';
      choiceId: string;
      label: string;
    }
  | {
      questionId: string;
      outcome: 'custom';
      text: string;
    }
  | {
      questionId: string;
      outcome: 'skipped';
    };

export type ChatQuestionRequestResult =
  | {
      status: 'submitted';
      requestId: string;
      responses: ChatQuestionResponse[];
      notes?: string;
    }
  | {
      status: 'skipped';
      requestId: string;
      reason: 'queued_message_pending' | 'user_skipped' | 'chat_stopped';
      notes?: string;
    };

export type ChatQuestionRequest = {
  id: string;
  droneId: string;
  chatName: string;
  chatId: string;
  nativeThreadId?: string;
  toolCallId?: string;
  toolName: string;
  questions: ChatQuestion[];
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'submitted' | 'skipped';
  result?: ChatQuestionRequestResult;
};
