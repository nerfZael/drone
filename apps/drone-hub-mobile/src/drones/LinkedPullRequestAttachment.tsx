import React from 'react';
import {
  ActivityIndicator,
  Alert,
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
  githubPullRequestForceMergeReason,
  githubPullRequestMatchesRepo,
  githubPullRequestMergeBlockedReason,
  githubPullRequestStatusBadges,
  type GithubPullRequestLink,
} from '@drone/assistant-chat';
import { colors, radii } from '../theme';
import type { MobileLinkedPullRequestContext } from './use-drone-linked-pull-requests';

type StatusTone = 'accent' | 'danger' | 'muted' | 'success' | 'warning';

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

function LinkedPullRequestRow({
  link,
  context,
}: {
  link: GithubPullRequestLink;
  context: MobileLinkedPullRequestContext;
}) {
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionNotice, setActionNotice] = React.useState<string | null>(null);
  const sameRepo = githubPullRequestMatchesRepo(link, context.data?.github);
  const pullRequest =
    sameRepo === true
      ? (context.data?.pullRequests.find((candidate) => candidate.number === link.pullNumber) ?? null)
      : null;
  const state = String(pullRequest?.state ?? '').trim().toLowerCase();
  const isOpen = state === 'open';
  const blockedReason = pullRequest ? githubPullRequestMergeBlockedReason(pullRequest) : null;
  const forceReason = pullRequest ? githubPullRequestForceMergeReason(pullRequest) : null;
  const busy = context.busyAction?.pullNumber === link.pullNumber;
  const anyActionBusy = context.busyAction != null;
  const statusLabel = pullRequest
    ? state
      ? `${state[0]?.toUpperCase()}${state.slice(1)}`
      : 'Unknown'
    : context.loading
      ? 'Loading status'
      : sameRepo === false
        ? 'External repository'
        : 'Status unavailable';

  React.useEffect(() => {
    setActionError(null);
    setActionNotice(null);
  }, [link.href]);

  const openOnGithub = (event: GestureResponderEvent) => {
    stop(event);
    setActionError(null);
    void Linking.openURL(link.href).catch(() => {
      setActionError('Could not open this pull request in the browser.');
    });
  };

  const merge = (event: GestureResponderEvent) => {
    stop(event);
    if (!pullRequest || blockedReason || anyActionBusy) return;
    const force = Boolean(forceReason);
    Alert.alert(
      force ? `Force merge PR #${pullRequest.number}?` : `Merge PR #${pullRequest.number}?`,
      `${forceReason ? `${forceReason[0]?.toUpperCase()}${forceReason.slice(1)}. ` : ''}Merge into ${pullRequest.baseRefName || 'the base branch'} using a merge commit?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: force ? 'Force merge' : 'Merge',
          onPress: () => {
            setActionError(null);
            setActionNotice(null);
            void context
              .merge(pullRequest.number)
              .then(setActionNotice)
              .catch((error) => setActionError(error instanceof Error ? error.message : String(error)));
          },
        },
      ],
    );
  };

  const close = (event: GestureResponderEvent) => {
    stop(event);
    if (!pullRequest || anyActionBusy) return;
    Alert.alert(
      `Close PR #${pullRequest.number}?`,
      'This closes the pull request without merging it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: () => {
            setActionError(null);
            setActionNotice(null);
            void context
              .close(pullRequest.number)
              .then(setActionNotice)
              .catch((error) => setActionError(error instanceof Error ? error.message : String(error)));
          },
        },
      ],
    );
  };

  return (
    <View style={styles.attachment}>
      <View style={styles.topRow}>
        <View style={styles.identityRow}>
          <Text style={styles.eyebrow}>LINKED REQUEST</Text>
          <Text style={styles.number}>#{link.pullNumber}</Text>
          {context.loading && !pullRequest ? (
            <View
              accessible
              accessibilityLabel={`Loading pull request ${link.pullNumber} status`}
            >
              <ActivityIndicator color={colors.muted} size={11} />
            </View>
          ) : (
            <TonePill label={statusLabel} tone={pullRequest ? statusTone(state) : 'muted'} />
          )}
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open pull request ${link.pullNumber} on GitHub`}
          hitSlop={10}
          onPress={openOnGithub}
          style={({ pressed }) => [styles.externalButton, pressed && styles.pressed]}
        >
          <ExternalLink color={colors.muted} size={14} strokeWidth={2} />
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
        {pullRequest?.headRefName || pullRequest?.baseRefName ? (
          <Text style={styles.branch}>
            {pullRequest.headRefName || '—'} → {pullRequest.baseRefName || '—'}
          </Text>
        ) : null}
        {pullRequest?.authorLogin ? <Text style={styles.author}>by {pullRequest.authorLogin}</Text> : null}
      </View>
      {pullRequest ? (
        <View style={styles.badges}>
          {githubPullRequestStatusBadges(pullRequest).map((badge) => (
            <TonePill key={badge.key} label={badge.label} tone={badge.tone} />
          ))}
        </View>
      ) : null}
      {isOpen && sameRepo && (context.canMerge || context.canClose) ? (
        <View style={styles.actions}>
          {context.canMerge ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={blockedReason ? `Merge blocked: ${blockedReason}` : forceReason ? `Force merge pull request ${link.pullNumber}` : `Merge pull request ${link.pullNumber}`}
              accessibilityState={{ disabled: Boolean(blockedReason) || anyActionBusy, busy }}
              disabled={Boolean(blockedReason) || anyActionBusy}
              hitSlop={{ top: 4, bottom: 4 }}
              onPress={merge}
              style={({ pressed }) => [
                styles.actionButton,
                styles.mergeButton,
                (blockedReason || anyActionBusy) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {busy && context.busyAction?.action === 'merge' ? (
                <ActivityIndicator color={colors.online} size={12} />
              ) : null}
              <Text style={styles.mergeText}>
                {blockedReason ? 'Blocked' : forceReason ? 'Force merge' : 'Merge'}
              </Text>
            </Pressable>
          ) : null}
          {context.canClose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close pull request ${link.pullNumber}`}
              accessibilityState={{ disabled: anyActionBusy, busy }}
              disabled={anyActionBusy}
              hitSlop={{ top: 4, bottom: 4 }}
              onPress={close}
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
        </View>
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
  list: { gap: 9, marginTop: 13 },
  attachment: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accentBorder,
    paddingLeft: 11,
    paddingVertical: 3,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  identityRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  eyebrow: { color: colors.subtle, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  number: { color: colors.accent, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' },
  externalButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.small,
  },
  title: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 7, marginTop: 5 },
  repo: { color: colors.subtle, fontSize: 8, fontFamily: 'monospace' },
  branch: { color: colors.muted, fontSize: 8, lineHeight: 12, fontFamily: 'monospace' },
  author: { color: colors.subtle, fontSize: 8 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  pill: { borderWidth: 1, borderRadius: radii.small, paddingHorizontal: 6, paddingVertical: 2 },
  pillText: { fontSize: 8, lineHeight: 10, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  actionButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radii.small,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mergeButton: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark },
  closeButton: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  mergeText: { color: colors.online, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  closeText: { color: colors.danger, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.4 },
  notice: { color: colors.online, fontSize: 9, lineHeight: 13, marginTop: 7 },
  error: { color: colors.danger, fontSize: 9, lineHeight: 13, marginTop: 7 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorCopy: { flex: 1, minWidth: 0 },
  retryButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 9, marginTop: 5 },
  retryText: { color: colors.accent, fontSize: 9, fontWeight: '800' },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.68 },
});
