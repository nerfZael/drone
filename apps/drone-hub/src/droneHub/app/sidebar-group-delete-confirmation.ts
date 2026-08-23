export type SidebarGroupDeleteConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive: true;
};

type SidebarGroupDronesDeleteConfirmationArgs = {
  label: string;
  countHint?: number;
  repoPath?: string | null;
};

type SidebarGroupDeleteConfirmationArgs = {
  kind: 'group' | 'repo';
  label: string;
  countHint?: number;
  repoPath?: string | null;
};

function normalizedCount(countHint: number | undefined): number | null {
  return typeof countHint === 'number' && Number.isFinite(countHint)
    ? Math.max(0, Math.floor(countHint))
    : null;
}

function droneCountLabel(count: number): string {
  return `${count} drone${count === 1 ? '' : 's'}`;
}

export function buildSidebarGroupDeleteConfirmation({
  kind,
  label: labelRaw,
  countHint,
  repoPath: repoPathRaw,
}: SidebarGroupDeleteConfirmationArgs): SidebarGroupDeleteConfirmation {
  const label = String(labelRaw ?? '').trim() || 'this group';
  const repoPath = String(repoPathRaw ?? '').trim();
  const count = normalizedCount(countHint);

  if (kind === 'repo') {
    const target = repoPath ? ` attached to ${repoPath}` : ' without an attached repository';
    const countText = count == null ? 'all drones' : `all ${droneCountLabel(count)}`;
    return {
      title: `Delete drones in “${label}”?`,
      message: `This permanently deletes ${countText}${target}, including their containers and registry entries. The repository itself is not deleted.`,
      confirmLabel: 'Delete drones',
      destructive: true,
    };
  }

  const repositoryScope = repoPath
    ? ` Only this group in ${repoPath} is affected; groups with the same name in other repositories are not affected.`
    : '';
  const contents = count === 0
    ? 'this empty group'
    : count == null
      ? 'this group and all of its contents'
      : `this group and its contents (${droneCountLabel(count)})`;
  const droneCleanup = count === 0
    ? ''
    : ', including the drone containers and registry entries';

  return {
    title: `Delete group “${label}”?`,
    message: `This permanently deletes ${contents}${droneCleanup}.${repositoryScope}`,
    confirmLabel: count === 0 ? 'Delete group' : 'Delete group and contents',
    destructive: true,
  };
}

export function buildSidebarGroupDronesDeleteConfirmation({
  label: labelRaw,
  countHint,
  repoPath: repoPathRaw,
}: SidebarGroupDronesDeleteConfirmationArgs): SidebarGroupDeleteConfirmation {
  const label = String(labelRaw ?? '').trim() || 'this group';
  const repoPath = String(repoPathRaw ?? '').trim();
  const count = normalizedCount(countHint);
  const countText =
    count == null ? 'all drones' : count === 1 ? 'the 1 drone' : `all ${droneCountLabel(count)}`;
  const repositoryScope = repoPath ? ` in ${repoPath}` : '';

  return {
    title: `Delete drones in “${label}”?`,
    message: `This permanently deletes ${countText} in this group and its subgroups${repositoryScope}, including their containers and registry entries. The group and its subgroups are not deleted.`,
    confirmLabel: 'Delete drones',
    destructive: true,
  };
}
