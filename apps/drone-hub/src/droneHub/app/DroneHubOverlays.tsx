import React from 'react';
import type { CreateDronesModal as CreateDronesModalComponent } from './CreateDronesModal';
import type { CustomAgentsModal as CustomAgentsModalComponent } from './CustomAgentsModal';
import type { DirtyDroneApplyModal as DirtyDroneApplyModalComponent } from './DirtyDroneApplyModal';
import { DroneDeleteConfirmModal } from './DroneDeleteConfirmModal';
import { DroneRenameModal } from './DroneRenameModal';
import type { DroneDropActionModal as DroneDropActionModalComponent } from './DroneDropActionModal';
import type { DraftCreateDroneModal as DraftCreateDroneModalComponent } from './DraftCreateDroneModal';
import type { DroneErrorModal as DroneErrorModalComponent } from './DroneErrorModal';
import { HubTransientToasts } from './HubTransientToasts';
import type { ReposModal as ReposModalComponent } from './ReposModal';

const CreateDronesModal = React.lazy(async () => {
  const { CreateDronesModal } = await import('./CreateDronesModal');
  return { default: CreateDronesModal };
});

const CustomAgentsModal = React.lazy(async () => {
  const { CustomAgentsModal } = await import('./CustomAgentsModal');
  return { default: CustomAgentsModal };
});

const DirtyDroneApplyModal = React.lazy(async () => {
  const { DirtyDroneApplyModal } = await import('./DirtyDroneApplyModal');
  return { default: DirtyDroneApplyModal };
});

const DroneDropActionModal = React.lazy(async () => {
  const { DroneDropActionModal } = await import('./DroneDropActionModal');
  return { default: DroneDropActionModal };
});

const DraftCreateDroneModal = React.lazy(async () => {
  const { DraftCreateDroneModal } = await import('./DraftCreateDroneModal');
  return { default: DraftCreateDroneModal };
});

const DroneErrorModal = React.lazy(async () => {
  const { DroneErrorModal } = await import('./DroneErrorModal');
  return { default: DroneErrorModal };
});

const ReposModal = React.lazy(async () => {
  const { ReposModal } = await import('./ReposModal');
  return { default: ReposModal };
});

export type DroneHubOverlaysProps = {
  createDronesModalProps: React.ComponentProps<typeof CreateDronesModalComponent>;
  draftCreateDroneModalProps: React.ComponentProps<typeof DraftCreateDroneModalComponent>;
  customAgentsModalProps: React.ComponentProps<typeof CustomAgentsModalComponent>;
  hubTransientToastsProps: React.ComponentProps<typeof HubTransientToasts>;
  reposModalProps: React.ComponentProps<typeof ReposModalComponent> | null;
  dirtyDroneApplyModalProps: React.ComponentProps<typeof DirtyDroneApplyModalComponent> | null;
  droneDeleteConfirmModalProps: React.ComponentProps<typeof DroneDeleteConfirmModal> | null;
  droneRenameModalProps: React.ComponentProps<typeof DroneRenameModal> | null;
  droneErrorModalProps: React.ComponentProps<typeof DroneErrorModalComponent> | null;
  droneDropActionModalProps: React.ComponentProps<typeof DroneDropActionModalComponent> | null;
};

export function DroneHubOverlays({
  createDronesModalProps,
  draftCreateDroneModalProps,
  customAgentsModalProps,
  hubTransientToastsProps,
  reposModalProps,
  dirtyDroneApplyModalProps,
  droneDeleteConfirmModalProps,
  droneRenameModalProps,
  droneErrorModalProps,
  droneDropActionModalProps,
}: DroneHubOverlaysProps) {
  return (
    <>
      <React.Suspense fallback={null}>
        {createDronesModalProps.open && <CreateDronesModal {...createDronesModalProps} />}
      </React.Suspense>
      <React.Suspense fallback={null}>
        {draftCreateDroneModalProps.open && <DraftCreateDroneModal {...draftCreateDroneModalProps} />}
      </React.Suspense>
      <React.Suspense fallback={null}>
        {customAgentsModalProps.open && <CustomAgentsModal {...customAgentsModalProps} />}
      </React.Suspense>
      <HubTransientToasts {...hubTransientToastsProps} />
      <React.Suspense fallback={null}>{reposModalProps && <ReposModal {...reposModalProps} />}</React.Suspense>
      <React.Suspense fallback={null}>
        {dirtyDroneApplyModalProps && <DirtyDroneApplyModal {...dirtyDroneApplyModalProps} />}
      </React.Suspense>
      {droneDeleteConfirmModalProps && <DroneDeleteConfirmModal {...droneDeleteConfirmModalProps} />}
      {droneRenameModalProps && <DroneRenameModal {...droneRenameModalProps} />}
      <React.Suspense fallback={null}>
        {droneErrorModalProps && <DroneErrorModal {...droneErrorModalProps} />}
      </React.Suspense>
      <React.Suspense fallback={null}>
        {droneDropActionModalProps && <DroneDropActionModal {...droneDropActionModalProps} />}
      </React.Suspense>
    </>
  );
}
