export type DroneOpenedFileState = {
  path: string | null;
  name: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  kind: 'text' | 'image' | 'video' | 'binary';
  mime: string | null;
  size: number;
  content: string;
  dirty: boolean;
  mtimeMs: number | null;
  targetLine: number | null;
  targetColumn: number | null;
  navigationSeq: number;
};
