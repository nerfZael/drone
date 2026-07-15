import React from 'react';
import { CrossDeviceAssistantPolicyPanel } from '../app/CrossDeviceAssistantPolicyPanel';
import { useDeviceMesh } from '../app/use-device-mesh';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export function AssistantWorkspaceAccessView({
  requestJson,
  threadId,
  threadTitle,
  onClose,
}: {
  requestJson: RequestJson;
  threadId: string;
  threadTitle: string;
  onClose: () => void;
}) {
  const mesh = useDeviceMesh(requestJson);

  if (mesh.loading && !mesh.status) {
    return (
      <div className="flex min-h-48 items-center justify-center text-[12px] text-[var(--muted)]">
        Loading device access…
      </div>
    );
  }

  if (!mesh.status) {
    return (
      <div className="p-4 text-[12px] text-[var(--red)]">
        {mesh.error || 'Device access is unavailable.'}
      </div>
    );
  }

  return (
    <CrossDeviceAssistantPolicyPanel
      requestJson={requestJson}
      devices={mesh.status.devices}
      selfDeviceId={mesh.status.selfDeviceId}
      connectedDeviceIds={mesh.status.connectedDeviceIds}
      mode="thread"
      threadId={threadId}
      threadTitle={threadTitle}
      onClose={onClose}
    />
  );
}
