import React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import ExternalLink from 'lucide-react-native/icons/external-link';
import {
  extractGithubPullRequestLinks,
  githubPullRequestDiffStatsPresentation,
  githubPullRequestForceMergeReason,
  githubPullRequestMatchesRepo,
  githubPullRequestMergeBlockedReason,
  githubPullRequestStatusBadges,
  pullRequestCloseConfirmation,
  pullRequestMergeConfirmation,
  type GithubPullRequestLink,
  type GithubPullRequestSummary,
} from '@drone/assistant-chat';
import { colors, radii } from '../theme';
import { ConfirmDialog } from '../components/Ui';
import type { MobileLinkedPullRequestContext } from './use-drone-linked-pull-requests';
import {
  MOBILE_PULL_REQUEST_MERGE_METHOD_OPTIONS,
  mobilePullRequestMergeFailureMessage,
  mobilePullRequestMergePresentation,
  type MobilePullRequestMergeMethod,
} from './linked-pull-request-model';

type StatusTone = 'accent' | 'danger' | 'muted' | 'success' | 'warning';
type PullRequestDiffStatsData = NonNullable<GithubPullRequestSummary['diffStats']>;
type PullRequestConfirmation =
  | { action: 'merge'; method: MobilePullRequestMergeMethod }
  | { action: 'close' }
  | null;

function stop(event: GestureResponderEvent): void {
  event.stopPropagation();
}

function statusTone(stateRaw: string): StatusTone {
  const state = String(stateRaw ?? '').trim().toLowerCase();
  if (state === 'open') return 'success';
  if (state === 'merged') return 'accent';
  if (state === 'closed') return 'danger';
  return 'muted';
}

function TonePill({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <View style={[styles.pill, toneStyles[tone]]}>
      <Text style={[styles.pillText, toneTextStyles[tone]]}>{label}</Text>
    </View>
  );
}

function PullRequestDiffStats({ stats }: { stats: PullRequestDiffStatsData }) {
  const presentation = githubPullRequestDiffStatsPresentation(stats);
  return (
    <View
      accessible
      accessibilityLabel={presentation.accessibilityLabel}
      style={styles.diffStats}
    >
      <Text style={[styles.diffStatText, styles.diffFiles]}>({presentation.changed})</Text>
      <Text style={[styles.diffStatText, styles.diffAdded]}>+{presentation.additions}</Text>
      <Text style={[styles.diffStatText, styles.diffDeleted]}>-{presentation.deletions}</Text>
      <Text style={styles.diffDivider}>|</Text>
      <Text style={[styles.diffStatText, styles.diffNet]}>{presentation.netLabel}</Text>
    </View>
  );
}

function LinkedPullRequestRow({
  link,
  context,
}: {
  link: GithubPullRequestLink;
  context: MobileLinkedPullRequestContext;
}) {
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionNotice, setActionNotice] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<PullRequestConfirmation>(null);
  const [confirmationBusy, setConfirmationBusy] = React.useState(false);
  const sameRepo = githubPullRequestMatchesRepo(link, context.data?.github);
  const pullRequest =
    sameRepo === true
      ? (context.data?.pullRequests.find((candidate) => candidate.number === link.pullNumber) ?? null)
      : null;
  const state = String(pullRequest?.state ?? '').trim().toLowerCase();
  const isOpen = state === 'open';
  const isDraft = isOpen && Boolean(pullRequest?.draft);
  const blockedReason = pullRequest ? githubPullRequestMergeBlockedReason(pullRequest) : null;
  const forceReason = pullRequest ? githubPullRequestForceMergeReason(pullRequest) : null;
  const mergePresentation = mobilePullRequestMergePresentation({
    method:
      confirmation?.action === 'merge' ? confirmation.method : context.mergeMethod,
    blockedReason,
    forceReason,
    confirmation: pullRequestMergeConfirmation({
      pullNumber: pullRequest?.number ?? link.pullNumber,
      baseRefName: pullRequest?.baseRefName,
      method: confirmation?.action === 'merge' ? confirmation.method : context.mergeMethod,
      forceReason,
    }),
  });
  const busy = context.busyAction?.pullNumber === link.pullNumber;
  const anyActionBusy = context.busyAction != null;
  const showActions = isOpen && sameRepo && (context.canMerge || context.canClose);
  const statusLabel = pullRequest
    ? isDraft
      ? 'Draft'
      : state
      ? `${state[0]?.toUpperCase()}${state.slice(1)}`
      : 'Unknown'
    : context.loading
      ? 'Loading status'
      : sameRepo === false
        ? 'External repository'
        : 'Status unavailable';
  const confirmationCopy =
    confirmation?.action === 'close'
      ? pullRequestCloseConfirmation({ pullNumber: pullRequest?.number ?? link.pullNumber })
      : mergePresentation.confirmation;

  React.useEffect(() => {
    setActionError(null);
    setActionNotice(null);
    setConfirmation(null);
    setConfirmationBusy(false);
  }, [link.href]);

  const openOnGithub = (event: GestureResponderEvent) => {
    stop(event);
    setActionError(null);
    void Linking.openURL(link.href).catch(() => {
      setActionError('Could not open this pull request in the browser.');
    });
  };

  const requestMerge = (event: GestureResponderEvent) => {
    stop(event);
    if (!pullRequest || !mergePresentation.canRequestMerge || anyActionBusy) return;
    setConfirmation({ action: 'merge', method: context.mergeMethod });
  };

  const requestClose = (event: GestureResponderEvent) => {
    stop(event);
    if (!pullRequest || anyActionBusy) return;
    setConfirmation({ action: 'close' });
  };

  const confirmAction = () => {
    if (!pullRequest || !confirmation || confirmationBusy || anyActionBusy) return;
    const action = confirmation;
    if (action.action === 'merge' && blockedReason) {
      setActionError(
        mobilePullRequestMergeFailureMessage({
          pullNumber: pullRequest.number,
          method: action.method,
          error: blockedReason,
        }),
      );
      setConfirmation(null);
      return;
    }
    setConfirmationBusy(true);
    setActionError(null);
    setActionNotice(null);
    void (action.action === 'merge'
      ? context.merge(pullRequest.number, action.method)
      : context.close(pullRequest.number))
      .then(setActionNotice)
      .catch((error) => setActionError(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setConfirmationBusy(false);
        setConfirmation(null);
      });
  };

  return (
    <View style={styles.attachment} onTouchStart={stop} onTouchEnd={stop}>
      <View style={styles.topRow}>
        <View style={styles.identityRow}>
          <Text style={styles.eyebrow}>PULL REQUEST</Text>
          <Text style={styles.number}>#{link.pullNumber}</Text>
          {context.loading && !pullRequest ? (
            <View
              accessible
              accessibilityLabel={`Loading pull request ${link.pullNumber} status`}
            >
              <ActivityIndicator color={colors.muted} size={11} />
            </View>
          ) : (
            <TonePill
              label={statusLabel}
              tone={pullRequest ? (isDraft ? 'muted' : statusTone(state)) : 'muted'}
            />
          )}
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open pull request ${link.pullNumber} on GitHub`}
          hitSlop={10}
          onPress={openOnGithub}
          style={({ pressed }) => [styles.externalButton, pressed && styles.pressed]}
        >
          <ExternalLink color={colors.link} size={14} strokeWidth={2} />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open pull request ${link.pullNumber}: ${pullRequest?.title ?? `${link.owner}/${link.repo}`}`}
        onPress={openOnGithub}
      >
        <Text numberOfLines={2} style={styles.title}>
          {pullRequest?.title ?? `${link.owner}/${link.repo} pull request #${link.pullNumber}`}
        </Text>
      </Pressable>
      <View style={styles.metaRow}>
        <Text style={styles.repo}>{link.owner}/{link.repo}</Text>
        {pullRequest?.diffStats ? <PullRequestDiffStats stats={pullRequest.diffStats} /> : null}
        {pullRequest?.headRefName || pullRequest?.baseRefName ? (
          <Text style={styles.branch}>
            {pullRequest.headRefName || '—'} → {pullRequest.baseRefName || '—'}
          </Text>
        ) : null}
        {pullRequest?.authorLogin ? <Text style={styles.author}>by {pullRequest.authorLogin}</Text> : null}
      </View>
      {isOpen && sameRepo && context.canMerge ? (
        <View style={styles.mergeMethodSection}>
          <Text style={styles.mergeMethodLabel}>MERGE METHOD</Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Pull request merge method"
            style={[styles.mergeMethods, anyActionBusy && styles.disabled]}
          >
            {MOBILE_PULL_REQUEST_MERGE_METHOD_OPTIONS.map((option) => {
              const selected = context.mergeMethod === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.label} merge method`}
                  accessibilityState={{ selected, disabled: anyActionBusy }}
                  disabled={anyActionBusy}
                  onPress={(event) => {
                    stop(event);
                    context.setMergeMethod(option.value);
                  }}
                  style={({ pressed }) => [
                    styles.mergeMethod,
                    selected && styles.mergeMethodSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.mergeMethodText,
                      selected && styles.mergeMethodTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {isOpen ? (
        <View style={styles.statusActionsRow}>
          {pullRequest ? (
            <View style={styles.badges}>
              {githubPullRequestStatusBadges(pullRequest).map((badge) => (
                <TonePill key={badge.key} label={badge.label} tone={badge.tone} />
              ))}
            </View>
          ) : null}
          {showActions ? (
            <View style={styles.actions}>
              {context.canClose ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Close pull request ${link.pullNumber}`}
                  accessibilityState={{ disabled: anyActionBusy, busy }}
                  disabled={anyActionBusy}
                  hitSlop={{ top: 4, bottom: 4 }}
                  onPress={requestClose}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.closeButton,
                    anyActionBusy && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {busy && context.busyAction?.action === 'close' ? (
                    <ActivityIndicator color={colors.danger} size={12} />
                  ) : null}
                  <Text style={styles.closeText}>Close</Text>
                </Pressable>
              ) : null}
              {context.canMerge ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${mergePresentation.accessibilityLabel} for pull request ${link.pullNumber}`}
                  accessibilityState={{
                    disabled: !mergePresentation.canRequestMerge || anyActionBusy,
                    busy,
                  }}
                  disabled={!mergePresentation.canRequestMerge || anyActionBusy}
                  hitSlop={{ top: 4, bottom: 4 }}
                  onPress={requestMerge}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.mergeButton,
                    (!mergePresentation.canRequestMerge || anyActionBusy) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {busy && context.busyAction?.action === 'merge' ? (
                    <ActivityIndicator color={colors.online} size={12} />
                  ) : null}
                  <Text style={styles.mergeText}>
                    {mergePresentation.buttonLabel}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {isOpen && sameRepo && blockedReason ? (
        <Text style={styles.actionHint}>Merge blocked: {blockedReason}.</Text>
      ) : null}
      {isOpen && sameRepo && context.mergeUnavailableReason ? (
        <Text style={styles.actionHint}>{context.mergeUnavailableReason}</Text>
      ) : null}
      {isOpen && sameRepo && context.closeUnavailableReason ? (
        <Text style={styles.actionHint}>{context.closeUnavailableReason}</Text>
      ) : null}
      {actionNotice ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {actionNotice}
        </Text>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : !pullRequest && context.error ? (
        <View style={styles.errorRow}>
          <Text accessibilityRole="alert" style={[styles.error, styles.errorCopy]}>
            Status unavailable: {context.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry pull request ${link.pullNumber} status`}
            accessibilityState={{ disabled: context.loading, busy: context.loading }}
            disabled={context.loading}
            hitSlop={{ top: 5, bottom: 5 }}
            onPress={(event) => {
              stop(event);
              void context.refresh();
            }}
            style={({ pressed }) => [
              styles.retryButton,
              context.loading && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <ConfirmDialog
        visible={confirmation != null}
        title={confirmationCopy.title}
        message={confirmationCopy.message}
        confirmLabel={confirmationCopy.confirmLabel}
        destructive={confirmationCopy.destructive}
        busy={confirmationBusy}
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmAction}
      />
    </View>
  );
}

export function LinkedPullRequestAttachments({
  text,
  context,
}: {
  text: string;
  context?: MobileLinkedPullRequestContext;
}) {
  const links = React.useMemo(() => extractGithubPullRequestLinks(text), [text]);
  if (!context || links.length === 0) return null;
  return (
    <View style={styles.list} accessibilityLabel="Pull requests linked in this message">
      {links.map((link) => (
        <LinkedPullRequestRow
          key={`${link.owner}/${link.repo}#${link.pullNumber}`}
          link={link}
          context={context}
        />
      ))}
    </View>
  );
}

const toneStyles = StyleSheet.create({
  accent: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  danger: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  muted: { borderColor: colors.border, backgroundColor: colors.whiteWashSoft },
  success: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark },
  warning: { borderColor: colors.warningBorder, backgroundColor: colors.warningDark },
});

const toneTextStyles = StyleSheet.create({
  accent: { color: colors.accent },
  danger: { color: colors.danger },
  muted: { color: colors.muted },
  success: { color: colors.online },
  warning: { color: colors.warning },
});

const styles = StyleSheet.create({
  list: { gap: 10, marginTop: 12 },
  attachment: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accentBorder,
    paddingLeft: 11,
    paddingVertical: 2,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  identityRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  eyebrow: { color: colors.subtle, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  number: { color: colors.accent, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },
  externalButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.small,
  },
  title: { color: colors.link, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 7, marginTop: 5 },
  repo: { color: colors.subtle, fontSize: 8, fontFamily: 'monospace' },
  diffStats: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  diffStatText: {
    fontSize: 9,
    lineHeight: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  diffFiles: { color: colors.muted },
  diffAdded: { color: colors.online },
  diffDeleted: { color: colors.danger },
  diffDivider: {
    color: colors.border,
    fontSize: 9,
    lineHeight: 12,
    fontFamily: 'monospace',
  },
  diffNet: { color: colors.accent },
  branch: { color: colors.muted, fontSize: 8, lineHeight: 12, fontFamily: 'monospace' },
  author: { color: colors.subtle, fontSize: 8 },
  mergeMethodSection: { gap: 5, marginTop: 9 },
  mergeMethodLabel: {
    color: colors.subtle,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.65,
  },
  mergeMethods: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.small,
    backgroundColor: colors.whiteWashSoft,
  },
  mergeMethod: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  mergeMethodSelected: { backgroundColor: colors.accentDark },
  mergeMethodText: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  mergeMethodTextSelected: { color: colors.accent },
  statusActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  badges: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  pill: { borderWidth: 1, borderRadius: radii.small, paddingHorizontal: 6, paddingVertical: 2 },
  pillText: { fontSize: 8, lineHeight: 10, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexShrink: 0,
    gap: 6,
  },
  actionButton: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: radii.small,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mergeButton: { minWidth: 56, borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark },
  closeButton: { minWidth: 52, borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  mergeText: { color: colors.online, fontSize: 10, fontWeight: '700' },
  closeText: { color: colors.danger, fontSize: 10, fontWeight: '700' },
  actionHint: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 6 },
  notice: { color: colors.online, fontSize: 9, lineHeight: 13, marginTop: 7 },
  error: { color: colors.danger, fontSize: 9, lineHeight: 13, marginTop: 7 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorCopy: { flex: 1, minWidth: 0 },
  retryButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 9, marginTop: 5 },
  retryText: { color: colors.accent, fontSize: 9, fontWeight: '800' },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.68 },
});
