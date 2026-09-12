import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Check from 'lucide-react-native/icons/check';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Folder from 'lucide-react-native/icons/folder';
import Maximize2 from 'lucide-react-native/icons/maximize-2';
import X from 'lucide-react-native/icons/x';
import type {
  CompanionProposal,
  CompanionProposalExecution,
  CompanionProposalExecutionItem,
  CompanionProposalOperation,
} from '@drone/assistant-chat';

import { colors, radii } from '../theme';
import {
  mobileProposalApplyLabel,
  mobileProposalCreatedInStep,
  mobileProposalCreationPills,
  mobileProposalDroneLabel,
  mobileProposalHeadline,
  mobileProposalLocation,
  mobileProposalOperationDetailRows,
  mobileProposalOutcomeText,
  mobileProposalStatus,
  type MobileProposalActionKind,
  type MobileProposalPillTone,
} from './mobile-companion-proposal-model';

const ACTION_COLOR: Record<MobileProposalActionKind, string> = {
  create: colors.online,
  delete: colors.danger,
  clone: colors.accent,
  rename: colors.warning,
  message: colors.info,
};

const PILL_STYLE: Record<MobileProposalPillTone, { container: object; color: string }> = {
  neutral: { container: { borderColor: colors.borderSubtle, backgroundColor: colors.controlSurface }, color: colors.muted },
  accent: { container: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark }, color: colors.accent },
  success: { container: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark }, color: colors.online },
  warning: { container: { borderColor: colors.warningBorder, backgroundColor: colors.warningDark }, color: colors.warning },
  danger: { container: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark }, color: colors.danger },
  info: { container: { borderColor: colors.infoDark, backgroundColor: colors.infoDark }, color: colors.info },
};

function Pill({ tone = 'neutral', children }: { tone?: MobileProposalPillTone; children: string }) {
  return (
    <View style={[styles.pill, PILL_STYLE[tone].container]}>
      <Text numberOfLines={1} style={[styles.pillText, { color: PILL_STYLE[tone].color }]}>
        {children}
      </Text>
    </View>
  );
}

function StepMarker({
  index,
  active,
  outcome,
}: {
  index: number;
  active: boolean;
  outcome?: CompanionProposalExecutionItem;
}) {
  if (active) {
    return (
      <View accessibilityLabel={`Applying operation ${index}`} style={[styles.marker, styles.markerAccent]}>
        <ActivityIndicator color={colors.accent} size={10} />
      </View>
    );
  }
  if (outcome?.status === 'completed') {
    return (
      <View accessibilityLabel={`Operation ${index} applied`} style={[styles.marker, styles.markerSuccess]}>
        <Check color={colors.online} size={11} strokeWidth={2.6} />
      </View>
    );
  }
  if (outcome?.status === 'failed') {
    return (
      <View accessibilityLabel={`Operation ${index} failed`} style={[styles.marker, styles.markerDanger]}>
        <X color={colors.danger} size={11} strokeWidth={2.6} />
      </View>
    );
  }
  if (outcome?.status === 'skipped') {
    return (
      <View accessibilityLabel={`Operation ${index} not run`} style={[styles.marker, styles.markerSkipped]}>
        <Text style={[styles.markerText, { color: colors.mutedDim }]}>–</Text>
      </View>
    );
  }
  return (
    <View style={styles.marker}>
      <Text style={styles.markerText}>{index}</Text>
    </View>
  );
}

type ListProps = {
  proposal: CompanionProposal;
  defaultRepoPath: string;
  execution: CompanionProposalExecution | null;
  executing: boolean;
  resolveDroneName(droneId: string): string | null;
  /** Show every operation in full: details open and no clamped previews. */
  full?: boolean;
};

function OperationList({ proposal, defaultRepoPath, execution, executing, resolveDroneName, full = false }: ListProps) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => setExpanded(new Set()), [proposal]);
  const outcomes = React.useMemo(
    () => new Map((execution?.operations ?? []).map((item) => [item.id, item])),
    [execution],
  );
  const droneLabel = (droneId: string) => mobileProposalDroneLabel(proposal, droneId, resolveDroneName);
  // Without per-step progress the whole list shows the same working state while applying.
  const activeOperationId = executing && !execution ? proposal.operations[0]?.id : undefined;

  if (proposal.operations.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Companion has not added any operations yet.</Text>
      </View>
    );
  }

  return (
    <View>
      {proposal.operations.map((operation, index) => {
        const outcome = outcomes.get(operation.id);
        const isLast = index === proposal.operations.length - 1;
        const headline = mobileProposalHeadline(operation, droneLabel);
        const details = mobileProposalOperationDetailRows(operation, defaultRepoPath);
        const detailsOpen = full || expanded.has(operation.id);
        const targetStep = 'droneId' in operation ? mobileProposalCreatedInStep(proposal, operation.droneId) : null;
        const message = operation.type === 'send_message' ? operation : null;
        const create = operation.type === 'create_drone' ? operation : null;
        const location = create ? mobileProposalLocation(create, defaultRepoPath) : null;
        const pills = create ? mobileProposalCreationPills(create) : [];
        const canToggle = details.length > 0 && !full;
        const body = (
          <>
            <View style={styles.headlineRow}>
              <Text style={styles.headline}>
                <Text style={[styles.action, { color: ACTION_COLOR[headline.kind] }]}>{headline.action}</Text>
                {headline.parts.map((part, partIndex) => (
                  <Text key={partIndex} style={part.name ? styles.name : undefined}>
                    {partIndex === 0 && part.name ? ' ' : ''}
                    {part.text}
                  </Text>
                ))}
              </Text>
              {canToggle ? (
                <ChevronRight
                  color={colors.muted}
                  size={13}
                  strokeWidth={2}
                  style={[styles.chevron, detailsOpen && styles.chevronOpen]}
                />
              ) : null}
            </View>
            {targetStep !== null || (message && message.chatName && message.chatName !== 'default') || message?.delivery === 'asap' ? (
              <View style={styles.pillRow}>
                {targetStep !== null ? <Pill tone="accent">{`↑ Step ${targetStep}`}</Pill> : null}
                {message && message.chatName && message.chatName !== 'default' ? <Pill>{message.chatName}</Pill> : null}
                {message?.delivery === 'asap' ? <Pill tone="warning">Send immediately</Pill> : null}
              </View>
            ) : null}
            {message ? (
              <View style={styles.quote}>
                <Text numberOfLines={full ? undefined : 4} style={styles.quoteText}>
                  {message.message}
                </Text>
              </View>
            ) : null}
            {create ? (
              <>
                <Text numberOfLines={full ? undefined : 2} style={styles.prompt}>
                  {create.prompt}
                </Text>
                <View style={styles.pillRow}>
                  <View style={styles.location}>
                    <Folder color={colors.muted} size={12} strokeWidth={1.8} />
                    <Text numberOfLines={1} style={styles.locationText}>{location?.groupPath}</Text>
                  </View>
                  {pills.map((pill) => (
                    <Pill key={pill.key} tone={pill.tone}>{pill.label}</Pill>
                  ))}
                </View>
              </>
            ) : null}
          </>
        );
        return (
          <View key={operation.id} style={[styles.step, !isLast && styles.stepSpaced]}>
            <View style={styles.rail}>
              <StepMarker index={index + 1} active={activeOperationId === operation.id} outcome={outcome} />
              {!isLast ? <View style={styles.railLine} /> : null}
            </View>
            <View style={styles.stepBody}>
              {canToggle ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${detailsOpen ? 'Hide' : 'Review'} details for step ${index + 1}`}
                  accessibilityState={{ expanded: detailsOpen }}
                  onPress={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(operation.id)) next.delete(operation.id);
                      else next.add(operation.id);
                      return next;
                    })
                  }
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  {body}
                </Pressable>
              ) : (
                body
              )}
              {details.length > 0 && detailsOpen ? (
                <View style={styles.details}>
                  {details.map((detail) => (
                    <View key={detail.label} style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{detail.label}</Text>
                      <Text selectable style={styles.detailValue}>{detail.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {outcome && outcome.status !== 'completed' ? (
                <Text style={[styles.outcome, outcome.status === 'failed' && styles.outcomeFailed]}>
                  {mobileProposalOutcomeText(outcome)}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function StatusPill({ execution }: { execution: CompanionProposalExecution | null }) {
  const status = mobileProposalStatus(execution);
  if (!status) return null;
  return <Pill tone={status.tone}>{status.label}</Pill>;
}

function Actions({
  executing,
  execution,
  applyDisabled,
  onExecute,
  onDiscard,
}: {
  executing: boolean;
  execution: CompanionProposalExecution | null;
  applyDisabled: boolean;
  onExecute(): void;
  onDiscard(): void;
}) {
  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Discard Companion proposal"
        disabled={executing}
        onPress={onDiscard}
        style={({ pressed }) => [styles.discard, pressed && styles.pressed, executing && styles.disabled]}
      >
        <Text style={styles.discardText}>Discard</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Apply Companion proposal"
        disabled={applyDisabled}
        onPress={onExecute}
        style={({ pressed }) => [styles.apply, pressed && styles.pressed, applyDisabled && styles.disabled]}
      >
        {executing ? <ActivityIndicator color={colors.onAccent} size="small" /> : null}
        <Text style={styles.applyText}>{mobileProposalApplyLabel(executing, execution)}</Text>
      </Pressable>
    </View>
  );
}

export type MobileCompanionProposalProps = ListProps & {
  applyDisabled: boolean;
  onExecute(): void;
  onDiscard(): void;
};

/** The proposal as it sits in the Companion sheet: an inline step list with a quiet footer. */
export function MobileCompanionProposal(props: MobileCompanionProposalProps) {
  const { proposal, execution, executing, applyDisabled, onExecute, onDiscard } = props;
  const [descriptionOpen, setDescriptionOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  React.useEffect(() => setDescriptionOpen(false), [proposal]);
  const actions = (
    <Actions
      executing={executing}
      execution={execution}
      applyDisabled={applyDisabled}
      onExecute={onExecute}
      onDiscard={onDiscard}
    />
  );
  return (
    <View accessibilityLabel="Companion proposal" style={styles.inline}>
      <OperationList {...props} />
      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={descriptionOpen ? 'Hide proposal description' : 'Show proposal description'}
            accessibilityState={{ expanded: descriptionOpen }}
            disabled={!proposal.summary}
            onPress={() => setDescriptionOpen((open) => !open)}
            style={styles.titleButton}
          >
            <Text numberOfLines={1} style={styles.title}>{proposal.title}</Text>
            {proposal.summary ? (
              <ChevronRight
                color={colors.mutedDim}
                size={11}
                strokeWidth={2}
                style={[styles.chevron, descriptionOpen && styles.chevronOpen]}
              />
            ) : null}
          </Pressable>
          <StatusPill execution={execution} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Expand proposal"
            disabled={proposal.operations.length === 0}
            hitSlop={6}
            onPress={() => setDialogOpen(true)}
            style={({ pressed }) => [styles.expand, pressed && styles.pressed, proposal.operations.length === 0 && styles.disabled]}
          >
            <Maximize2 color={colors.muted} size={14} strokeWidth={2} />
          </Pressable>
        </View>
        {proposal.summary && descriptionOpen ? (
          <Text style={styles.summary}>{proposal.summary}</Text>
        ) : null}
        {actions}
      </View>
      {dialogOpen ? (
        <MobileCompanionProposalDialog {...props} onClose={() => setDialogOpen(false)} />
      ) : null}
    </View>
  );
}

/** Full-size review for long proposals: every step open, nothing clamped, approve from here. */
export function MobileCompanionProposalDialog(props: MobileCompanionProposalProps & { onClose(): void }) {
  const { proposal, execution, executing, applyDisabled, onExecute, onDiscard, onClose } = props;
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.page, { paddingTop: insets.top }]}>
        <View style={styles.pageHeader}>
          <View style={styles.pageHeading}>
            <Text style={styles.eyebrow}>Companion proposal</Text>
            <Text style={styles.pageTitle}>{proposal.title}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close proposal review"
            onPress={onClose}
            style={styles.close}
          >
            <X size={22} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator>
          {proposal.summary ? <Text style={styles.pageSummary}>{proposal.summary}</Text> : null}
          <OperationList {...props} full />
        </ScrollView>
        <View style={[styles.pageFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.pageFooterStatus}>
            <StatusPill execution={execution} />
          </View>
          <Actions
            executing={executing}
            execution={execution}
            applyDisabled={applyDisabled}
            onExecute={onExecute}
            onDiscard={onDiscard}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  inline: {
    marginTop: 2,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  empty: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radii.large,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderSubtle,
    alignItems: 'center',
  },
  emptyText: { color: colors.muted, fontSize: 12 },
  step: { flexDirection: 'row', gap: 10 },
  stepSpaced: { paddingBottom: 14 },
  rail: { alignItems: 'center', width: 20 },
  railLine: { flex: 1, width: StyleSheet.hairlineWidth, marginTop: 4, backgroundColor: colors.borderSubtle },
  marker: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.controlSurface,
  },
  markerAccent: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  markerSuccess: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark },
  markerDanger: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  markerSkipped: { borderColor: colors.borderSubtle, backgroundColor: 'transparent' },
  markerText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', lineHeight: 13 },
  stepBody: { flex: 1, minWidth: 0, paddingTop: 1 },
  headlineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  headline: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  action: { fontWeight: '700' },
  name: { color: colors.text, fontWeight: '600' },
  chevron: { marginTop: 3 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  pill: {
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    maxWidth: '100%',
  },
  pillText: { fontSize: 10.5, fontWeight: '600' },
  quote: {
    marginTop: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: colors.info,
  },
  quoteText: { color: colors.text, fontSize: 12, lineHeight: 17 },
  prompt: { marginTop: 5, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 },
  locationText: { color: colors.muted, fontSize: 11, flexShrink: 1 },
  details: {
    marginTop: 8,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.medium,
    backgroundColor: colors.controlSurface,
  },
  detailRow: { flexDirection: 'row', gap: 10 },
  detailLabel: { width: 96, color: colors.mutedDim, fontSize: 11, lineHeight: 15 },
  detailValue: { flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  outcome: { marginTop: 5, color: colors.mutedDim, fontSize: 11 },
  outcomeFailed: { color: colors.danger },
  footer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    gap: 8,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { flexShrink: 1, color: colors.muted, fontSize: 11.5, fontWeight: '600' },
  summary: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  expand: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radii.medium },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 },
  discard: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radii.medium },
  discardText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  apply: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radii.medium,
    backgroundColor: colors.accent,
  },
  applyText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  page: { flex: 1, backgroundColor: colors.panelRaised },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  pageHeading: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accent, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  pageTitle: { marginTop: 3, color: colors.text, fontSize: 17, fontWeight: '700' },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pageContent: { padding: 16, gap: 14 },
  pageSummary: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  pageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.panel,
  },
  pageFooterStatus: { flex: 1, flexDirection: 'row' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
});
