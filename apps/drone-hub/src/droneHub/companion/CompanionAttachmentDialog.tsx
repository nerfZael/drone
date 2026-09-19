import React from 'react';
import type { CompanionImageAttachment } from '@drone/assistant-chat';
import { AttachmentViewerDialog, type ViewedAttachment } from '../media/AttachmentViewerDialog';

export { zoomedView } from '../media/AttachmentViewerDialog';

export function isCompanionTextAttachment(attachment: Pick<CompanionImageAttachment, 'mime'>) {
  return attachment.mime === 'text/plain';
}

export function companionAttachmentText(attachment: Pick<CompanionImageAttachment, 'dataBase64'>) {
  return new TextDecoder().decode(Uint8Array.from(atob(attachment.dataBase64), char => char.charCodeAt(0)));
}

/** A pending Companion attachment in the viewer it shares with the drone chats. */
export function CompanionAttachmentDialog({ attachment, onClose, portalContainer }: {
  attachment: CompanionImageAttachment; onClose(): void; portalContainer?: HTMLElement;
}) {
  const viewed = React.useMemo<ViewedAttachment>(() => isCompanionTextAttachment(attachment)
    ? { kind: 'text', name: attachment.name, text: companionAttachmentText(attachment) }
    : { kind: 'image', name: attachment.name, src: `data:${attachment.mime};base64,${attachment.dataBase64}` }, [attachment]);
  return <AttachmentViewerDialog attachment={viewed} onClose={onClose} portalContainer={portalContainer} />;
}
