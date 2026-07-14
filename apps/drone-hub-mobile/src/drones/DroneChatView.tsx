import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import Bot from 'lucide-react-native/icons/bot';
import Square from 'lucide-react-native/icons/square';
import User from 'lucide-react-native/icons/user';
import { colors } from '../theme';
import type { MobileDroneTurn } from './drone-sidebar-model';

function displayTime(value: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function displayBytes(value: number | null): string {
  if (value == null) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function cleanOutput(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

function RoleIcon({ role }: { role: 'user' | 'agent' }) {
  const Icon = role === 'user' ? User : Bot;
  return (
    <View style={[styles.roleIcon, role === 'agent' ? styles.agentIcon : styles.userIcon]}>
      <Icon color={role === 'agent' ? colors.accent : '#b7c6ca'} size={14} strokeWidth={2} />
    </View>
  );
}

function TurnAttachments({ attachments }: { attachments: MobileDroneTurn['attachments'] }) {
  if (attachments.length === 0) return null;
  return (
    <View style={styles.attachments}>
      {attachments.map((attachment, index) => (
        <View key={`${attachment.name}:${index}`} style={styles.attachment}>
          <Text style={styles.attachmentMark}>▧</Text>
          <View style={styles.attachmentCopy}>
            <Text numberOfLines={1} style={styles.attachmentName}>
              {attachment.name}
            </Text>
            <Text numberOfLines={1} style={styles.attachmentMeta}>
              {attachment.mime}
              {attachment.size == null ? '' : ` · ${displayBytes(attachment.size)}`}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function DroneChatTurn({ item }: { item: MobileDroneTurn }) {
  const response = cleanOutput(item.ok ? item.output : item.error || 'Agent failed');
  const promptTime = displayTime(item.promptAt);
  const responseTime = displayTime(item.completedAt);
  return (
    <View style={styles.turn}>
      <View style={styles.userRow}>
        <View style={styles.userColumn}>
          <View style={styles.userMeta}>
            {promptTime ? <Text style={styles.time}>{promptTime}</Text> : null}
            <Text style={styles.userRole}>YOU</Text>
          </View>
          <View style={styles.userBubble}>
            {item.prompt ? (
              <Text selectable style={styles.messageText}>
                {item.prompt}
              </Text>
            ) : null}
            <TurnAttachments attachments={item.attachments} />
          </View>
        </View>
        <RoleIcon role="user" />
      </View>

      <View style={styles.agentRow}>
        <RoleIcon role="agent" />
        <View style={styles.agentColumn}>
          <View style={styles.agentMeta}>
            <Text style={styles.agentRole}>AGENT</Text>
            <View style={styles.agentMetaRight}>
              {item.model ? (
                <Text numberOfLines={1} style={styles.model}>
                  {item.model}
                </Text>
              ) : null}
              {responseTime ? <Text style={styles.time}>{responseTime}</Text> : null}
            </View>
          </View>
          <View style={[styles.agentBubble, !item.ok && styles.agentBubbleError]}>
            {item.reasoning ? (
              <View style={styles.reasoningBadge}>
                <Text numberOfLines={1} style={styles.reasoningText}>
                  {item.reasoning}
                </Text>
              </View>
            ) : null}
            {response ? (
              <Text selectable style={[styles.messageText, !item.ok && styles.errorText]}>
                {response}
              </Text>
            ) : (
              <Text style={styles.emptyResponse}>No agent output.</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

export function DroneChatTranscript({
  turns,
  loading = false,
  running = false,
}: {
  turns: MobileDroneTurn[];
  loading?: boolean;
  running?: boolean;
}) {
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>Loading conversation…</Text>
      </View>
    );
  }
  if (turns.length === 0 && !running) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIconFrame}>
          <Bot color={colors.accent} size={25} strokeWidth={1.7} />
          <View style={[styles.corner, styles.cornerTop]} />
          <View style={[styles.corner, styles.cornerBottom]} />
        </View>
        <Text style={styles.emptyTitle}>This drone chat is ready.</Text>
        <Text style={styles.emptyBody}>Send a prompt to start the conversation.</Text>
      </View>
    );
  }
  return (
    <View style={styles.transcript}>
      {turns.map((turn, index) => (
        <DroneChatTurn key={`${turn.id}:${index}`} item={turn} />
      ))}
      {running ? (
        <View style={styles.runningRow}>
          <RoleIcon role="agent" />
          <View style={styles.runningBubble}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.runningText}>Agent is working…</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function DroneChatComposer({
  value,
  chatName,
  model,
  sending,
  running,
  onChangeText,
  onSend,
  onStop,
}: {
  value: string;
  chatName: string;
  model?: string;
  sending?: boolean;
  running?: boolean;
  onChangeText(value: string): void;
  onSend(): void;
  onStop(): void;
}) {
  const canSend = Boolean(value.trim()) && !sending;
  return (
    <View style={composerStyles.frame}>
      <View style={composerStyles.composer}>
        <View style={composerStyles.accentLine} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Send a prompt…"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={32_000}
          textAlignVertical="top"
          style={composerStyles.input}
        />
        <View style={composerStyles.controls}>
          <View style={composerStyles.route}>
            <Text numberOfLines={1} style={composerStyles.chatName}>
              {chatName}
            </Text>
            {model ? (
              <Text numberOfLines={1} style={composerStyles.model}>
                {model}
              </Text>
            ) : null}
          </View>
          {running ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop agent"
              onPress={onStop}
              style={({ pressed }) => [
                composerStyles.action,
                composerStyles.actionAccent,
                pressed && composerStyles.pressed,
              ]}
            >
              <Square color={colors.background} size={15} fill={colors.background} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send prompt"
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={onSend}
              style={({ pressed }) => [
                composerStyles.action,
                composerStyles.actionAccent,
                !canSend && composerStyles.disabled,
                pressed && composerStyles.pressed,
              ]}
            >
              {sending ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <ArrowUp color={colors.background} size={17} strokeWidth={2.6} />
              )}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  transcript: { gap: 25, paddingHorizontal: 14, paddingTop: 18, paddingBottom: 28 },
  turn: { gap: 15 },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-start' },
  userColumn: { maxWidth: '84%', minWidth: 120 },
  userMeta: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingRight: 2,
  },
  userRole: { color: '#9fb2b7', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  userBubble: {
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.16)',
    borderRadius: 11,
    borderTopRightRadius: 3,
    backgroundColor: 'rgba(148,163,184,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  agentRow: { flexDirection: 'row', alignItems: 'flex-start' },
  agentColumn: { flex: 1, minWidth: 0 },
  agentMeta: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 2,
  },
  agentMetaRight: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  agentRole: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  model: { color: colors.muted, fontSize: 8, fontFamily: 'monospace', maxWidth: 130 },
  time: { color: '#587078', fontSize: 8, fontFamily: 'monospace' },
  agentBubble: {
    borderWidth: 1,
    borderColor: 'rgba(98,217,199,0.15)',
    borderRadius: 11,
    borderTopLeftRadius: 3,
    backgroundColor: 'rgba(98,217,199,0.065)',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  agentBubbleError: {
    backgroundColor: 'rgba(243,123,130,0.08)',
    borderColor: 'rgba(243,123,130,0.24)',
  },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  errorText: { color: '#ffabb0' },
  emptyResponse: { color: colors.muted, fontSize: 12, fontStyle: 'italic' },
  roleIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginTop: 20,
  },
  userIcon: {
    marginLeft: 10,
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderColor: 'rgba(148,163,184,0.17)',
  },
  agentIcon: {
    marginRight: 10,
    backgroundColor: colors.accentDark,
    borderColor: 'rgba(98,217,199,0.2)',
  },
  reasoningBadge: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 5,
    backgroundColor: 'rgba(98,217,199,0.09)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginBottom: 8,
  },
  reasoningText: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  attachments: { gap: 6, marginTop: 9 },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.12)',
    padding: 8,
  },
  attachmentMark: { color: colors.accent, fontSize: 16 },
  attachmentCopy: { flex: 1, minWidth: 0 },
  attachmentName: { color: colors.text, fontSize: 10, fontWeight: '700' },
  attachmentMeta: { color: colors.muted, fontSize: 8, marginTop: 1 },
  loading: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 11 },
  loadingText: { color: colors.muted, fontSize: 11 },
  empty: { minHeight: 390, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyIconFrame: {
    width: 62,
    height: 62,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 17,
  },
  corner: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderColor: colors.accent,
    opacity: 0.35,
  },
  cornerTop: { top: -1, left: -1, borderTopWidth: 1, borderLeftWidth: 1 },
  cornerBottom: { right: -1, bottom: -1, borderRightWidth: 1, borderBottomWidth: 1 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  emptyBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: 'center',
  },
  runningRow: { flexDirection: 'row', alignItems: 'flex-start' },
  runningBubble: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(98,217,199,0.15)',
    borderRadius: 11,
    borderTopLeftRadius: 3,
    backgroundColor: 'rgba(98,217,199,0.055)',
    paddingHorizontal: 14,
    marginTop: 20,
  },
  runningText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
});

const composerStyles = StyleSheet.create({
  frame: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 11,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composer: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#294047',
    borderRadius: 13,
    backgroundColor: colors.panelRaised,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    backgroundColor: colors.accent,
    opacity: 0.22,
  },
  input: {
    minHeight: 58,
    maxHeight: 140,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 6,
  },
  controls: {
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 9,
    paddingBottom: 9,
  },
  route: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatName: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  model: { color: colors.muted, fontSize: 8, fontFamily: 'monospace', flexShrink: 1 },
  action: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionAccent: { backgroundColor: colors.accent, borderColor: colors.accent },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.72 },
});
