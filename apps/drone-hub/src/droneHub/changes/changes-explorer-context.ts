import React from 'react';

/** Undefined keeps embedded/mobile views combined; null means the docked explorer is closed. */
export const ChangesExplorerContext = React.createContext<HTMLElement | null | undefined>(undefined);
