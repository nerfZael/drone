import React from 'react';

type SideChatForkScope = {
  droneId: string;
  chatName: string;
  busy: boolean;
  supported: boolean;
};

/** Only mounted where a workspace owns the floating-chat lifecycle and error UI. */
export const SideChatForkContext = React.createContext<SideChatForkScope | null>(null);
