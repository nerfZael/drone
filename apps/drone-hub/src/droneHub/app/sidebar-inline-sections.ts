export type SidebarInlineSectionKind = 'chats' | 'children';

export function sidebarInlineSectionKey(droneIdRaw: string, kind: SidebarInlineSectionKind): string {
  const droneId = String(droneIdRaw ?? '').trim();
  return `${kind}:${droneId}`;
}
