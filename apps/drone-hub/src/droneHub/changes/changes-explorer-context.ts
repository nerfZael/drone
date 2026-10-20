import React from 'react';

/** Undefined keeps embedded/mobile views combined; null means the docked explorer is closed. */
export const ChangesExplorerContext = React.createContext<HTMLElement | null | undefined>(undefined);

/** The slot in the docked Changes Explorer's tab for the line counts; null when there is none. */
export const ChangesExplorerTabContext = React.createContext<HTMLElement | null>(null);
