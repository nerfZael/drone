import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { hubSqlitePath } from '../host/sqlite-registry-store';

type DatabaseConstructor = typeof import('better-sqlite3');
type DatabaseInstance = import('better-sqlite3').Database;

export type WhiteboardScopeType = 'global' | 'repo' | 'group' | 'drone' | 'assistant-thread';

export type WhiteboardSummary = {
  id: string;
  title: string;
  scopeType: WhiteboardScopeType;
  scopeValue: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type WhiteboardScene = {
  elements: any[];
  appState: Record<string, unknown> | null;
  files: Record<string, unknown>;
};

export type WhiteboardDocument = WhiteboardSummary & {
  scene: WhiteboardScene;
};

export type WhiteboardShapeInput = {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  label?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  fromId?: unknown;
  toId?: unknown;
  startX?: unknown;
  startY?: unknown;
  endX?: unknown;
  endY?: unknown;
  strokeColor?: unknown;
  backgroundColor?: unknown;
};

export type WhiteboardOperation =
  | { action: 'add_shape'; shape?: WhiteboardShapeInput; shapes?: WhiteboardShapeInput[] }
  | { action: 'delete_shape'; id?: unknown; ids?: unknown[] }
  | { action: 'update_text'; id?: unknown; text?: unknown };

type WhiteboardRow = {
  id: string;
  title: string;
  scope_type: string;
  scope_value: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type WhiteboardSnapshotRow = {
  scene_json: string;
};

let cached:
  | {
      dbPath: string;
      db: DatabaseInstance;
      store: WhiteboardStore;
    }
  | null = null;
let unavailableReason: string | null = null;

const requireForWhiteboardStore = createRequire(__filename);
const WHITEBOARD_SCOPE_TYPES = new Set<WhiteboardScopeType>(['global', 'repo', 'group', 'drone', 'assistant-thread']);
const DEFAULT_WHITEBOARD_ID = 'main';
const DEFAULT_WHITEBOARD_TITLE = 'Main whiteboard';
const MAX_WHITEBOARDS = 50;
const MAX_WHITEBOARD_ELEMENTS = 500;
const MAX_WHITEBOARD_OPERATION_COUNT = 100;
const MAX_WHITEBOARD_TEXT_CHARS = 4_000;
const MAX_WHITEBOARD_SCENE_BYTES = 1_000_000;

function nowIso(): string {
  return new Date().toISOString();
}

function loadDatabaseConstructor(): DatabaseConstructor | null {
  try {
    return requireForWhiteboardStore('better-sqlite3') as DatabaseConstructor;
  } catch (error: any) {
    unavailableReason = error?.message ?? String(error);
    return null;
  }
}

function parseJsonObject(raw: string): any {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function cleanString(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanWhiteboardText(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim() || fallback;
  if (text.length > MAX_WHITEBOARD_TEXT_CHARS) {
    throw errorWithStatus(`whiteboard text is too long; max ${MAX_WHITEBOARD_TEXT_CHARS} characters`, 413);
  }
  return text;
}

function cleanNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : fallback;
}

function cleanPositiveNumber(value: unknown, fallback: number): number {
  const number = cleanNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function normalizeScopeType(raw: unknown): WhiteboardScopeType {
  const value = String(raw ?? '').trim();
  return WHITEBOARD_SCOPE_TYPES.has(value as WhiteboardScopeType) ? (value as WhiteboardScopeType) : 'global';
}

function normalizeScene(raw: unknown): WhiteboardScene {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    elements: Array.isArray(source.elements) ? source.elements.filter((item) => item && typeof item === 'object') : [],
    appState: source.appState && typeof source.appState === 'object' && !Array.isArray(source.appState)
      ? (source.appState as Record<string, unknown>)
      : null,
    files: source.files && typeof source.files === 'object' && !Array.isArray(source.files)
      ? (source.files as Record<string, unknown>)
      : {},
  };
}

function validateScene(scene: WhiteboardScene): void {
  if (scene.elements.length > MAX_WHITEBOARD_ELEMENTS) {
    throw errorWithStatus(`whiteboard has too many elements; max ${MAX_WHITEBOARD_ELEMENTS}`, 413);
  }
  for (const element of scene.elements) {
    const text = typeof element?.text === 'string' ? element.text : typeof element?.originalText === 'string' ? element.originalText : '';
    if (text.length > MAX_WHITEBOARD_TEXT_CHARS) {
      throw errorWithStatus(`whiteboard element ${String(element?.id ?? '').trim() || '(unknown)'} text is too long; max ${MAX_WHITEBOARD_TEXT_CHARS} characters`, 413);
    }
  }
  const sceneBytes = Buffer.byteLength(JSON.stringify(scene), 'utf8');
  if (sceneBytes > MAX_WHITEBOARD_SCENE_BYTES) {
    throw errorWithStatus(`whiteboard scene is too large; max ${MAX_WHITEBOARD_SCENE_BYTES} bytes`, 413);
  }
}

function defaultScene(): WhiteboardScene {
  return {
    elements: [],
    appState: {
      viewBackgroundColor: '#f8fafc',
      theme: 'light',
      name: DEFAULT_WHITEBOARD_TITLE,
    },
    files: {},
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function elementBase(input: {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  backgroundColor?: string;
  updated: number;
}) {
  return {
    id: input.id,
    type: input.type,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    angle: 0,
    strokeColor: cleanString(input.strokeColor, '#1e293b'),
    backgroundColor: cleanString(input.backgroundColor, input.type === 'rectangle' ? '#e0f2fe' : 'transparent'),
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: Math.floor(Math.random() * 2_147_483_647),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_147_483_647),
    isDeleted: false,
    boundElements: null,
    updated: input.updated,
    link: null,
    locked: false,
    index: null,
  };
}

function createTextElement(shape: WhiteboardShapeInput, updated: number, fallbackX = 0, fallbackY = 0) {
  const text = cleanWhiteboardText(shape.text ?? shape.label, 'Note');
  const width = cleanPositiveNumber(shape.width, Math.max(120, Math.min(420, text.length * 8 + 32)));
  const height = cleanPositiveNumber(shape.height, Math.max(36, Math.ceil(text.length / 28) * 24));
  return {
    ...elementBase({
      id: cleanString(shape.id, makeId('wb_text')),
      type: 'text',
      x: cleanNumber(shape.x, fallbackX),
      y: cleanNumber(shape.y, fallbackY),
      width,
      height,
      strokeColor: shape.strokeColor as string,
      backgroundColor: 'transparent',
      updated,
    }),
    text,
    originalText: text,
    fontSize: 20,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  };
}

function createRectangleElement(shape: WhiteboardShapeInput, updated: number) {
  const rect = elementBase({
    id: cleanString(shape.id, makeId('wb_rect')),
    type: 'rectangle',
    x: cleanNumber(shape.x, 0),
    y: cleanNumber(shape.y, 0),
    width: cleanPositiveNumber(shape.width, 180),
    height: cleanPositiveNumber(shape.height, 92),
    strokeColor: shape.strokeColor as string,
    backgroundColor: shape.backgroundColor as string,
    updated,
  });
  const text = cleanWhiteboardText(shape.text ?? shape.label);
  if (!text) return [rect];
  return [
    rect,
    createTextElement(
      {
        text,
        x: rect.x + 16,
        y: rect.y + 16,
        width: Math.max(60, rect.width - 32),
        height: Math.max(24, rect.height - 32),
        strokeColor: shape.strokeColor,
      },
      updated,
    ),
  ];
}

function createArrowElement(shape: WhiteboardShapeInput, elements: any[], updated: number) {
  const byId = new Map(elements.filter((element) => element?.isDeleted !== true).map((element) => [String(element?.id ?? ''), element]));
  const from = byId.get(cleanString(shape.fromId));
  const to = byId.get(cleanString(shape.toId));
  const startX = from ? Number(from.x ?? 0) + Number(from.width ?? 0) : cleanNumber(shape.startX, 0);
  const startY = from ? Number(from.y ?? 0) + Number(from.height ?? 0) / 2 : cleanNumber(shape.startY, 0);
  const endX = to ? Number(to.x ?? 0) : cleanNumber(shape.endX, startX + 160);
  const endY = to ? Number(to.y ?? 0) + Number(to.height ?? 0) / 2 : cleanNumber(shape.endY, startY);
  const arrow = {
    ...elementBase({
      id: cleanString(shape.id, makeId('wb_arrow')),
      type: 'arrow',
      x: startX,
      y: startY,
      width: endX - startX,
      height: endY - startY,
      strokeColor: shape.strokeColor as string,
      backgroundColor: 'transparent',
      updated,
    }),
    points: [
      [0, 0],
      [endX - startX, endY - startY],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
  };
  const text = cleanWhiteboardText(shape.text ?? shape.label);
  if (!text) return [arrow];
  return [
    arrow,
    createTextElement(
      {
        text,
        x: startX + (endX - startX) / 2 - 48,
        y: startY + (endY - startY) / 2 - 28,
        width: 140,
        height: 28,
        strokeColor: shape.strokeColor,
      },
      updated,
    ),
  ];
}

function createElementsFromShape(shape: WhiteboardShapeInput, existingElements: any[], updated: number): any[] {
  const type = cleanString(shape.type, 'rectangle').toLowerCase();
  if (type === 'text' || type === 'note') return [createTextElement(shape, updated)];
  if (type === 'arrow' || type === 'connection' || type === 'connector') return createArrowElement(shape, existingElements, updated);
  return createRectangleElement(shape, updated);
}

function summaryFromRow(row: WhiteboardRow): WhiteboardSummary {
  return {
    id: row.id,
    title: row.title,
    scopeType: normalizeScopeType(row.scope_type),
    scopeValue: row.scope_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version) || 1,
  };
}

function errorWithStatus(message: string, statusCode: number): Error & { statusCode?: number } {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

export class WhiteboardStore {
  constructor(private readonly db: DatabaseInstance) {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS whiteboards (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        scope_type TEXT NOT NULL DEFAULT 'global',
        scope_value TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_whiteboards_scope_updated
        ON whiteboards (scope_type, scope_value, updated_at);

      CREATE TABLE IF NOT EXISTS whiteboard_snapshots (
        whiteboard_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        scene_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT
      );
    `);
  }

  ensureDefault(): WhiteboardDocument {
    const existing = this.get(DEFAULT_WHITEBOARD_ID);
    if (existing) return existing;
    return this.create({ id: DEFAULT_WHITEBOARD_ID, title: DEFAULT_WHITEBOARD_TITLE });
  }

  list(input?: { scopeType?: unknown; scopeValue?: unknown }): WhiteboardSummary[] {
    this.ensureDefault();
    const scopeType = input?.scopeType == null ? '' : normalizeScopeType(input.scopeType);
    const scopeValue = cleanString(input?.scopeValue);
    let rows: WhiteboardRow[];
    if (scopeType && scopeValue) {
      rows = this.db
        .prepare('SELECT id, title, scope_type, scope_value, created_at, updated_at, version FROM whiteboards WHERE deleted_at IS NULL AND scope_type = ? AND scope_value = ? ORDER BY updated_at DESC')
        .all(scopeType, scopeValue) as WhiteboardRow[];
    } else {
      rows = this.db
        .prepare('SELECT id, title, scope_type, scope_value, created_at, updated_at, version FROM whiteboards WHERE deleted_at IS NULL ORDER BY updated_at DESC')
        .all() as WhiteboardRow[];
    }
    return rows.map(summaryFromRow);
  }

  create(input?: { id?: unknown; title?: unknown; scopeType?: unknown; scopeValue?: unknown; scene?: unknown }): WhiteboardDocument {
    const id = cleanString(input?.id, makeId('whiteboard')).replace(/[^a-zA-Z0-9._:-]+/g, '-').slice(0, 120) || makeId('whiteboard');
    const existingId = this.db.prepare('SELECT id FROM whiteboards WHERE id = ?').get(id) as { id?: string } | undefined;
    if (existingId) throw errorWithStatus(`whiteboard already exists: ${id}`, 409);
    const activeCount = this.db.prepare('SELECT COUNT(*) AS count FROM whiteboards WHERE deleted_at IS NULL').get() as { count?: number } | undefined;
    if (Number(activeCount?.count ?? 0) >= MAX_WHITEBOARDS) {
      throw errorWithStatus(`too many whiteboards; max ${MAX_WHITEBOARDS}`, 413);
    }
    const title = cleanString(input?.title, 'Untitled whiteboard').slice(0, 160);
    const scopeType = normalizeScopeType(input?.scopeType);
    const scopeValue = cleanString(input?.scopeValue).slice(0, 500);
    const createdAt = nowIso();
    const scene = normalizeScene(input?.scene ?? defaultScene());
    validateScene(scene);
    this.db.prepare(`
      INSERT INTO whiteboards (id, title, scope_type, scope_value, created_at, updated_at, version, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
    `).run(id, title, scopeType, scopeValue, createdAt, createdAt);
    this.db.prepare(`
      INSERT INTO whiteboard_snapshots (whiteboard_id, version, scene_json, updated_at, updated_by)
      VALUES (?, 1, ?, ?, NULL)
    `).run(id, JSON.stringify(scene), createdAt);
    return this.get(id) as WhiteboardDocument;
  }

  get(idRaw: unknown): WhiteboardDocument | null {
    const id = cleanString(idRaw);
    if (!id) return null;
    const row = this.db
      .prepare('SELECT id, title, scope_type, scope_value, created_at, updated_at, version FROM whiteboards WHERE id = ? AND deleted_at IS NULL')
      .get(id) as WhiteboardRow | undefined;
    if (!row) return null;
    const snapshot = this.db
      .prepare('SELECT scene_json FROM whiteboard_snapshots WHERE whiteboard_id = ?')
      .get(id) as WhiteboardSnapshotRow | undefined;
    return {
      ...summaryFromRow(row),
      scene: normalizeScene(parseJsonObject(snapshot?.scene_json ?? '{}')),
    };
  }

  save(idRaw: unknown, input: { baseVersion?: unknown; scene?: unknown; title?: unknown; actorId?: unknown }): WhiteboardDocument {
    const current = this.get(idRaw);
    if (!current) throw errorWithStatus('whiteboard not found', 404);
    const baseVersion = Number(input.baseVersion);
    if (Number.isFinite(baseVersion) && Math.floor(baseVersion) !== current.version) {
      throw errorWithStatus(`whiteboard version changed: expected ${Math.floor(baseVersion)}, current ${current.version}`, 409);
    }
    const updatedAt = nowIso();
    const nextVersion = current.version + 1;
    const title = input.title == null ? current.title : cleanString(input.title, current.title).slice(0, 160);
    const scene = normalizeScene(input.scene ?? current.scene);
    validateScene(scene);
    const sceneJson = JSON.stringify(scene);
    this.db.prepare('UPDATE whiteboards SET title = ?, updated_at = ?, version = ? WHERE id = ?').run(title, updatedAt, nextVersion, current.id);
    this.db.prepare(`
      INSERT INTO whiteboard_snapshots (whiteboard_id, version, scene_json, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(whiteboard_id) DO UPDATE SET
        version = excluded.version,
        scene_json = excluded.scene_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(current.id, nextVersion, sceneJson, updatedAt, cleanString(input.actorId) || null);
    return this.get(current.id) as WhiteboardDocument;
  }

  applyOperations(idRaw: unknown, operationsRaw: unknown, actorId?: unknown): WhiteboardDocument {
    const current = this.get(idRaw);
    if (!current) throw errorWithStatus('whiteboard not found', 404);
    const operations = Array.isArray(operationsRaw) ? operationsRaw as WhiteboardOperation[] : [];
    if (operations.length === 0) return current;
    if (operations.length > MAX_WHITEBOARD_OPERATION_COUNT) {
      throw errorWithStatus(`too many whiteboard operations; max ${MAX_WHITEBOARD_OPERATION_COUNT}`, 413);
    }
    const updated = Date.now();
    let elements = current.scene.elements.slice();
    for (const operation of operations) {
      const action = cleanString((operation as any)?.action).toLowerCase();
      if (action === 'add_shape') {
        const shapes = [
          ...(((operation as any).shape && typeof (operation as any).shape === 'object') ? [(operation as any).shape] : []),
          ...(Array.isArray((operation as any).shapes) ? (operation as any).shapes : []),
        ].filter((shape) => shape && typeof shape === 'object');
        if (shapes.length === 0) throw errorWithStatus('add_shape requires shape or shapes', 400);
        for (const shape of shapes) {
          const created = createElementsFromShape(shape, elements, updated);
          const existingIds = new Set(elements.map((element) => String(element?.id ?? '')).filter(Boolean));
          for (const element of created) {
            const elementId = cleanString(element?.id);
            if (!elementId) throw errorWithStatus('add_shape created a shape without an id', 400);
            if (existingIds.has(elementId)) throw errorWithStatus(`add_shape would duplicate shape id: ${elementId}`, 400);
            existingIds.add(elementId);
          }
          elements = [...elements, ...created];
        }
      } else if (action === 'delete_shape') {
        const ids = new Set([
          cleanString((operation as any).id),
          ...(Array.isArray((operation as any).ids) ? (operation as any).ids.map(cleanString) : []),
        ].filter(Boolean));
        if (ids.size === 0) throw errorWithStatus('delete_shape requires id or ids', 400);
        const liveIds = new Set(elements.filter((element) => element?.isDeleted !== true).map((element) => String(element?.id ?? '')).filter(Boolean));
        const missing = [...ids].filter((id) => !liveIds.has(id));
        if (missing.length > 0) {
          throw errorWithStatus(`delete_shape references unknown shape id: ${missing[0]}`, 400);
        }
        elements = elements.map((element) => (ids.has(String(element?.id ?? '')) ? { ...element, isDeleted: true, updated } : element));
      } else if (action === 'update_text') {
        const id = cleanString((operation as any).id);
        if (!id) throw errorWithStatus('update_text requires id', 400);
        if (!Object.prototype.hasOwnProperty.call(operation as any, 'text')) throw errorWithStatus('update_text requires text', 400);
        const text = cleanWhiteboardText((operation as any).text);
        const target = elements.find((element) => String(element?.id ?? '') === id && element?.type === 'text' && element?.isDeleted !== true);
        if (!target) {
          throw errorWithStatus(`update_text references unknown text shape id: ${id}`, 400);
        }
        elements = elements.map((element) =>
          String(element?.id ?? '') === id && element?.type === 'text'
            ? { ...element, text, originalText: text, version: Number(element.version ?? 1) + 1, updated }
            : element,
        );
      } else {
        throw errorWithStatus(`unsupported whiteboard operation: ${action || 'missing action'}`, 400);
      }
    }
    return this.save(current.id, {
      baseVersion: current.version,
      scene: { ...current.scene, elements },
      actorId,
    });
  }

  delete(idRaw: unknown): { id: string; deleted: boolean } {
    const current = this.get(idRaw);
    if (!current) return { id: cleanString(idRaw), deleted: false };
    if (current.id === DEFAULT_WHITEBOARD_ID) throw errorWithStatus('main whiteboard cannot be deleted', 400);
    this.db.prepare('UPDATE whiteboards SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), current.id);
    return { id: current.id, deleted: true };
  }
}

export function getWhiteboardStoreUnavailableReason(): string | null {
  return unavailableReason;
}

export function getWhiteboardStore(): WhiteboardStore | null {
  const Database = loadDatabaseConstructor();
  if (!Database) return null;
  const dbPath = hubSqlitePath();
  if (cached?.dbPath === dbPath) return cached.store;
  if (cached) {
    try {
      cached.db.close();
    } catch {
      // ignore stale close errors
    }
    cached = null;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  try {
    const db = new Database(dbPath);
    const store = new WhiteboardStore(db);
    cached = { dbPath, db, store };
    unavailableReason = null;
    return store;
  } catch (error: any) {
    unavailableReason = error?.message ?? String(error);
    return null;
  }
}

export function requireWhiteboardStore(): WhiteboardStore {
  const store = getWhiteboardStore();
  if (!store) throw errorWithStatus(`whiteboard store unavailable: ${getWhiteboardStoreUnavailableReason() ?? 'unknown error'}`, 503);
  return store;
}
