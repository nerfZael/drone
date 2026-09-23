import {
  DRONE_CHAT_DND_MIME,
  DRONE_DND_MIME,
  createCanvasChatNodeId,
  createCanvasDroneNodeId,
  parseCanvasChatNodeId,
  parseCanvasDroneNodeId,
} from '../app/app-config';
import { draggedCanvasNodeIdsFromData, type DroneHubDragData } from '../app/drone-hub-dnd';
import { parseDraggedChatPayload, parseDraggedDronePayload } from '../canvas/chat-node-utils';

/** A drone or chat dropped on a composer; its name and ID go out with the next message. */
export type ComposerReference =
  | { kind: 'drone'; droneId: string }
  | { kind: 'chat'; droneId: string; chatName: string };

export function composerReferenceId(reference: ComposerReference): string {
  return reference.kind === 'chat'
    ? createCanvasChatNodeId(reference.droneId, reference.chatName)
    : createCanvasDroneNodeId(reference.droneId);
}

/** Adds `next` after `current`, skipping ones already referenced. */
export function mergeComposerReferences(current: ComposerReference[], next: ComposerReference[]): ComposerReference[] {
  const byId = new Map(current.map((reference) => [composerReferenceId(reference), reference]));
  for (const reference of next) {
    const id = composerReferenceId(reference);
    if (id && !byId.has(id)) byId.set(id, reference);
  }
  return [...byId.values()];
}

/** Canvas card IDs to references; draft cards have nothing to reference yet. */
export function composerReferencesFromNodeIds(nodeIds: readonly string[]): ComposerReference[] {
  const out: ComposerReference[] = [];
  for (const nodeId of nodeIds) {
    const chat = parseCanvasChatNodeId(nodeId);
    const droneId = chat ? '' : parseCanvasDroneNodeId(nodeId);
    if (chat) out.push({ kind: 'chat', droneId: chat.droneId, chatName: chat.chatName });
    else if (droneId) out.push({ kind: 'drone', droneId });
  }
  return mergeComposerReferences([], out);
}

export const COMPOSER_REFERENCE_DRAG_TYPES = [DRONE_CHAT_DND_MIME, DRONE_DND_MIME];

export function composerReferencesFromTransfer(transfer: Pick<DataTransfer, 'getData'>): ComposerReference[] {
  return mergeComposerReferences(
    composerReferencesFromNodeIds(parseDraggedChatPayload(transfer.getData(DRONE_CHAT_DND_MIME))),
    parseDraggedDronePayload(transfer.getData(DRONE_DND_MIME)).map((droneId) => ({ kind: 'drone', droneId })),
  );
}

/** Sidebar drags: chats stay chats, drones and pinned drones become drone references. */
export function composerReferencesFromDragData(data: DroneHubDragData | null): ComposerReference[] {
  return composerReferencesFromNodeIds(draggedCanvasNodeIdsFromData(data));
}

export type DroneNames = Record<string, { name?: string } | undefined>;

function droneLabel(droneId: string, drones: DroneNames): string {
  return String(drones[droneId]?.name ?? '').trim() || droneId;
}

/** How a reference shows as a composer tile: its name, with the full description on hover. */
export function composerReferenceTile(reference: ComposerReference, drones: DroneNames): { id: string; kind: ComposerReference['kind']; label: string; title: string } {
  const drone = droneLabel(reference.droneId, drones);
  return reference.kind === 'chat'
    ? { id: composerReferenceId(reference), kind: 'chat', label: reference.chatName, title: `Chat "${reference.chatName}" in ${drone}` }
    : { id: composerReferenceId(reference), kind: 'drone', label: drone, title: `Drone "${drone}" (${reference.droneId})` };
}

/** The block a message carries for its references: a heading, then one line per drone or chat. */
export function composerReferencesBlock(references: ComposerReference[], drones: DroneNames): string {
  if (references.length === 0) return '';
  const lines = references.map((reference) => {
    const drone = droneLabel(reference.droneId, drones);
    return reference.kind === 'chat'
      ? `- Chat "${reference.chatName}" in drone "${drone}" (drone id: ${reference.droneId})`
      : `- Drone "${drone}" (drone id: ${reference.droneId})`;
  });
  return ['Referenced drones and chats:', ...lines].join('\n');
}

/** The prompt as sent: the typed text, then one line per referenced drone or chat. */
export function appendComposerReferences(promptRaw: string, references: ComposerReference[], drones: DroneNames): string {
  const prompt = String(promptRaw ?? '').trim();
  const block = composerReferencesBlock(references, drones);
  if (!block) return prompt;
  return prompt ? `${prompt}\n\n${block}` : block;
}
