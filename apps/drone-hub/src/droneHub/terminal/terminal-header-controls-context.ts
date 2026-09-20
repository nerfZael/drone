import React from 'react';

/**
 * True where the terminal pane sits under a dock header that carries its new-terminal
 * button. Elsewhere, such as the single-pane mobile layout, there is no such header and the
 * pane has to offer the button itself.
 */
export const TerminalHeaderControlsContext = React.createContext(false);
