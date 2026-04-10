import React from 'react';
import { CreateDronesFromAgentMessageModal } from '../../CreateDronesFromAgentMessageModal';
import { CreateDronesModal } from './CreateDronesModal';
import { CustomAgentsModal } from './CustomAgentsModal';
import { DirtyDroneApplyModal } from './DirtyDroneApplyModal';
import { DroneDropActionModal } from './DroneDropActionModal';
import { DraftCreateDroneModal } from './DraftCreateDroneModal';
import { DroneErrorModal } from './DroneErrorModal';
import { HubTransientToasts } from './HubTransientToasts';
import { ReposModal } from './ReposModal';

export type DroneHubOverlaysProps = {
  createDronesModalProps: React.ComponentProps<typeof CreateDronesModal>;
  draftCreateDroneModalProps: React.ComponentProps<typeof DraftCreateDroneModal>;
  customAgentsModalProps: React.ComponentProps<typeof CustomAgentsModal>;
  hubTransientToastsProps: React.ComponentProps<typeof HubTransientToasts>;
  createFromAgentMessageModalProps: React.ComponentProps<typeof CreateDronesFromAgentMessageModal>;
  reposModalProps: React.ComponentProps<typeof ReposModal> | null;
  dirtyDroneApplyModalProps: React.ComponentProps<typeof DirtyDroneApplyModal> | null;
  droneErrorModalProps: React.ComponentProps<typeof DroneErrorModal> | null;
  droneDropActionModalProps: React.ComponentProps<typeof DroneDropActionModal> | null;
};

export function DroneHubOverlays({
  createDronesModalProps,
  draftCreateDroneModalProps,
  customAgentsModalProps,
  hubTransientToastsProps,
  createFromAgentMessageModalProps,
  reposModalProps,
  dirtyDroneApplyModalProps,
  droneErrorModalProps,
  droneDropActionModalProps,
}: DroneHubOverlaysProps) {
  return (
    <>
      <CreateDronesModal {...createDronesModalProps} />
      <DraftCreateDroneModal {...draftCreateDroneModalProps} />
      <CustomAgentsModal {...customAgentsModalProps} />
      <HubTransientToasts {...hubTransientToastsProps} />
      <CreateDronesFromAgentMessageModal {...createFromAgentMessageModalProps} />
      {reposModalProps && <ReposModal {...reposModalProps} />}
      {dirtyDroneApplyModalProps && <DirtyDroneApplyModal {...dirtyDroneApplyModalProps} />}
      {droneErrorModalProps && <DroneErrorModal {...droneErrorModalProps} />}
      {droneDropActionModalProps && <DroneDropActionModal {...droneDropActionModalProps} />}
    </>
  );
}
