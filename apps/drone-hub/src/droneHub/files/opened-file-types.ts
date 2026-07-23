export type DroneOpenedFileState = {
  path: string | null;
  name: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  kind: 'text' | 'large-text' | 'image' | 'video' | 'binary';
  mime: string | null;
  size: number;
  content: string;
  dirty: boolean;
  mtimeMs: number | null;
  revision?: string | null;
  externallyChanged?: boolean;
  canOverwriteExternalChange?: boolean;
  targetLine: number | null;
  targetColumn: number | null;
  navigationSeq: number;
};

export type DroneOpenedFileTabState = DroneOpenedFileState & {
  tabId: string;
  droneId: string;
};
