export type WhiteboardScopeType = 'global' | 'repo' | 'group' | 'drone' | 'assistant-thread';

export type WhiteboardScene = {
  elements: any[];
  appState: Record<string, unknown> | null;
  files: Record<string, unknown>;
};

export type WhiteboardSummary = {
  id: string;
  title: string;
  scopeType: WhiteboardScopeType;
  scopeValue: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type WhiteboardDocument = WhiteboardSummary & {
  scene: WhiteboardScene;
};

export type WhiteboardListResponse = {
  ok: true;
  whiteboards: WhiteboardSummary[];
};

export type WhiteboardDocumentResponse = {
  ok: true;
  whiteboard: WhiteboardDocument;
};
