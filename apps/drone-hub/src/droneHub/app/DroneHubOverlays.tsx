import React from 'react';
import { CreateDronesFromAgentMessageModal } from '../../CreateDronesFromAgentMessageModal';
import { CreateDronesModal } from './CreateDronesModal';
import { CustomAgentsModal } from './CustomAgentsModal';
import { DraftCreateDroneModal } from './DraftCreateDroneModal';
import { DroneErrorModal } from './DroneErrorModal';
import { HubTransientToasts } from './HubTransientToasts';
import { ReposModal } from './ReposModal';

type DroneHubOverlaysProps = {
  createDronesModalProps: React.ComponentProps<typeof CreateDronesModal>;
  draftCreateDroneModalProps: React.ComponentProps<typeof DraftCreateDroneModal>;
  customAgentsModalProps: React.ComponentProps<typeof CustomAgentsModal>;
  hubTransientToastsProps: React.ComponentProps<typeof HubTransientToasts>;
  createFromAgentMessageModalProps: React.ComponentProps<typeof CreateDronesFromAgentMessageModal>;
  reposModalProps: React.ComponentProps<typeof ReposModal> | null;
  droneErrorModalProps: React.ComponentProps<typeof DroneErrorModal> | null;
};

export function DroneHubOverlays({
  createDronesModalProps,
  draftCreateDroneModalProps,
  customAgentsModalProps,
  hubTransientToastsProps,
  createFromAgentMessageModalProps,
  reposModalProps,
  droneErrorModalProps,
}: DroneHubOverlaysProps) {
  return (
    <>
      <CreateDronesModal {...createDronesModalProps} />
      <DraftCreateDroneModal {...draftCreateDroneModalProps} />
      <CustomAgentsModal {...customAgentsModalProps} />
      <HubTransientToasts {...hubTransientToastsProps} />
      <CreateDronesFromAgentMessageModal {...createFromAgentMessageModalProps} />
      {reposModalProps && <ReposModal {...reposModalProps} />}
      {droneErrorModalProps && <DroneErrorModal {...droneErrorModalProps} />}
    </>
  );
}
