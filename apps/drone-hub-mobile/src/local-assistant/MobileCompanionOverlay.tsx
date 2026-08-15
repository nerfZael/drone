import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Mic from 'lucide-react-native/icons/mic';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { NativeMarkdown } from './NativeMarkdown';
import { formatMobileVoiceDuration } from './mobile-voice-transcription-model';
import { useMobileCompanion } from './MobileCompanionContext';

function statusLabel(status: ReturnType<typeof useMobileCompanion>['status'], duration: number) {
  if (status === 'starting') return 'Starting microphone…';
  if (status === 'recording') return `Listening · ${formatMobileVoiceDuration(duration)}`;
  if (status === 'transcribing') return 'Transcribing…';
  if (status === 'working') return 'Working…';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'error') return 'Needs attention';
  return '';
}

export function MobileCompanionOverlay() {
  const companion = useMobileCompanion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [activityExpanded, setActivityExpanded] = React.useState(true);
  const [expandedCalls, setExpandedCalls] = React.useState<Set<string>>(() => new Set());
  const [, tick] = React.useState(0);

  React.useEffect(() => {
    if (companion.status !== 'working') return;
    const timer = setInterval(() => tick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [companion.status]);

  React.useEffect(() => {
    if (companion.status === 'idle') {
      setActivityExpanded(true);
      setExpandedCalls(new Set());
    }
  }, [companion.status]);

  if (companion.status === 'idle') return null;
  const active = companion.status === 'working';
  const elapsed = companion.startedAt
    ? Math.max(0, (companion.endedAt ?? Date.now()) - companion.startedAt)
    : 0;
  const showActivity = active || companion.activity.length > 0;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { paddingTop: insets.top + 8, paddingHorizontal: 10 }]}
    >
      <View
        style={[
          styles.card,
          { maxHeight: Math.max(180, Math.min(height - insets.top - 20, height * 0.62)) },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Companion</Text>
            <Text accessibilityLiveRegion="polite" style={styles.status}>
              {statusLabel(companion.status, companion.durationMillis)}
            </Text>
          </View>
          {companion.status === 'recording' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop Companion recording"
              onPress={() => void companion.toggle()}
              style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
            >
              <Square color={colors.online} size={13} strokeWidth={2.5} />
              <Text style={styles.stopText}>Stop</Text>
            </Pressable>
          ) : companion.status === 'starting' || companion.status === 'transcribing' ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Companion"
            hitSlop={8}
            onPress={() => void companion.close()}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <X color={colors.muted} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {companion.transcript ? (
            <View style={styles.transcript}>
              <Mic color={colors.muted} size={13} strokeWidth={2} />
              <Text style={styles.transcriptText}>“{companion.transcript}”</Text>
            </View>
          ) : null}
          {showActivity ? (
            <View style={styles.activity}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  activityExpanded ? 'Hide Companion tool calls' : 'Show Companion tool calls'
                }
                accessibilityState={{ expanded: activityExpanded }}
                onPress={() => setActivityExpanded((value) => !value)}
                style={({ pressed }) => [styles.activitySummary, pressed && styles.pressed]}
              >
                {active ? <ActivityIndicator color={colors.accent} size="small" /> : null}
                <Text style={styles.activitySummaryText}>
                  {active ? 'Working' : 'Worked'} · {Math.round(elapsed / 1_000)}s
                  {companion.activity.length > 0
                    ? ` · ${companion.activity.length} tool ${companion.activity.length === 1 ? 'call' : 'calls'}`
                    : ''}
                </Text>
                <ChevronRight
                  color={colors.muted}
                  size={15}
                  strokeWidth={2}
                  style={{ transform: [{ rotate: activityExpanded ? '90deg' : '0deg' }] }}
                />
              </Pressable>
              {activityExpanded
                ? companion.activity.map((item) => {
                    const expanded = expandedCalls.has(item.callId);
                    const detail = item.error ?? item.result ?? item.args;
                    return (
                      <View key={item.callId} style={styles.toolCall}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded }}
                          onPress={() =>
                            setExpandedCalls((current) => {
                              const next = new Set(current);
                              if (next.has(item.callId)) next.delete(item.callId);
                              else next.add(item.callId);
                              return next;
                            })
                          }
                          style={({ pressed }) => [styles.toolHeader, pressed && styles.pressed]}
                        >
                          <ChevronRight
                            color={colors.mutedDim}
                            size={13}
                            strokeWidth={2}
                            style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
                          />
                          <Text numberOfLines={1} style={styles.toolName}>
                            {item.status === 'running'
                              ? 'Running'
                              : item.status === 'failed'
                                ? 'Failed'
                                : 'Used'}{' '}
                            {item.tool}
                          </Text>
                        </Pressable>
                        {expanded ? (
                          <Text selectable style={styles.toolDetail}>
                            {JSON.stringify(detail, null, 2)}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })
                : null}
            </View>
          ) : null}
          {companion.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{companion.error}</Text>
            </View>
          ) : null}
          {companion.reply ? (
            <View style={styles.reply}>
              <NativeMarkdown text={companion.reply} />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 200,
    elevation: 30,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 18,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  status: { marginTop: 2, color: colors.muted, fontSize: 11 },
  stopButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  stopText: { color: colors.online, fontSize: 11, fontWeight: '700' },
  closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingBottom: 12 },
  transcript: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  transcriptText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
  activity: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  activitySummary: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
  },
  activitySummaryText: { flex: 1, color: colors.textSecondary, fontSize: 11 },
  toolCall: { marginLeft: 14, borderLeftWidth: 1, borderLeftColor: colors.borderSubtle },
  toolHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  toolName: { flex: 1, color: colors.textSecondary, fontSize: 10 },
  toolDetail: {
    marginHorizontal: 10,
    marginBottom: 9,
    padding: 8,
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 13,
    fontFamily: 'monospace',
    backgroundColor: colors.sidebarSurfaceInset,
  },
  errorBox: {
    marginHorizontal: 12,
    marginTop: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerDark,
  },
  errorText: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  reply: { paddingHorizontal: 14, paddingTop: 12 },
  pressed: { opacity: 0.68 },
});
