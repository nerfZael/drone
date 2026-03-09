export type DiffNoTextReason = 'binary' | 'truncated' | 'empty' | 'unavailable';
export type DiffViewType = 'unified' | 'split';
export type DiffExpansionRange = { start: number; end: number };

export type DiffState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | {
      status: 'loaded';
      text: string;
      truncated: boolean;
      fromUntracked: boolean;
      isBinary: boolean;
      noTextReason: DiffNoTextReason | null;
      contextLines: number;
    };
