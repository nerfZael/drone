import React from 'react';

type SideChatForkScope = {
  droneId: string;
  chatName: string;
  busy: boolean;
  supported: boolean;
};

/** Only mounted where a workspace owns the floating-chat lifecycle and error UI. */
export const SideChatForkContext = React.createContext<SideChatForkScope | null>(null);

/** Expose the same availability to menus owned by an enclosing chat window. */
export function SideChatForkProvider({ value, children }: { value: SideChatForkScope; children: React.ReactNode }) {
  return <SideChatForkContext.Provider value={value}>
    <span hidden data-chat-fork-supported={value.supported} data-chat-fork-busy={value.busy} />
    {children}
  </SideChatForkContext.Provider>;
}
