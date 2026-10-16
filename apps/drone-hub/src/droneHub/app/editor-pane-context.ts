import React from 'react';

export const EditorPaneContext = React.createContext<'combined' | 'editor' | 'explorer'>('combined');

/** Where the docked File Explorer's tab takes the explorer's own controls; null without such a tab. */
export const ExplorerTabControlsContext = React.createContext<HTMLElement | null>(null);
