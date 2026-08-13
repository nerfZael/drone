export type {
  ChangeRequestActor,
  ChangeRequestAssessment,
  ChangeRequestChanges,
  ChangeRequestCreateInput,
  ChangeRequestFileChange,
  ChangeRequestGithubMirrorRecord,
  ChangeRequestGithubMirrorState,
  ChangeRequestGithubMirrorView,
  ChangeRequestLineStats,
  ChangeRequestRecord,
  ChangeRequestRevision,
  ChangeRequestRevisionView,
  ChangeRequestSourceCommit,
  ChangeRequestStatus,
  ChangeRequestUpdateInput,
  ChangeRequestView,
} from '@drone/hub-model';

import type { ChangeRequestRevision } from '@drone/hub-model';

export type ChangeRequestRevisionRecord = ChangeRequestRevision & {
  requestId: string;
  snapshotRef: string;
  sourceRef: string;
  objectStorePath: string | null;
};
