import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Mic from 'lucide-react-native/icons/mic';
import Plus from 'lucide-react-native/icons/plus';
import Square from 'lucide-react-native/icons/square';
import { colors } from '../theme';

type ComposerIcon = typeof ArrowUp;

export function compactAssistantModelName(value: string): string {
  const name = value.trim();
  if (!/^gpt(?:[-_\s]|$)/i.test(name)) return name.replace(/[-_]+/g, ' ');
  const parts = name
    .replace(/^gpt[-_\s]*/i, '')
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return parts
    .map((part, index) =>
      index === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`,
    )
    .join(' ');
}

export function assistantReasoningName(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` : '';
}

function IconButton({
  label,
  icon: Icon,
  accent = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: ComposerIcon;
  accent?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        accent && styles.iconButtonAccent,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        color={accent ? colors.background : colors.text}
        size={17}
        strokeWidth={accent ? 2.6 : 2.1}
      />
    </Pressable>
  );
}

export function AssistantComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  onOpenModel,
  modelLabel,
  reasoningLabel,
  running = false,
  sending = false,
  editable = true,
  maxLength = 32_000,
  placeholder = 'Ask the assistant…',
}: {
  value: string;
  onChangeText(value: string): void;
  onSend(): void;
  onStop?(): void;
  onOpenModel(): void;
  modelLabel: string;
  reasoningLabel?: string;
  running?: boolean;
  sending?: boolean;
  editable?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  const [focused, setFocused] = React.useState(false);
  const expanded = focused || Boolean(value.trim()) || running;
  const canSend = Boolean(value.trim()) && !sending && editable;
  const reasoning = assistantReasoningName(String(reasoningLabel ?? '').trim());
  const model = compactAssistantModelName(modelLabel);

  return (
    <View style={styles.frame}>
      <View style={[styles.composer, expanded && styles.composerExpanded]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={editable && !running}
          multiline
          maxLength={maxLength}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          textAlignVertical="top"
          style={[styles.input, expanded && styles.inputExpanded]}
        />
        {expanded ? (
          <View style={styles.controls}>
            <IconButton label="Add attachment — coming soon" icon={Plus} onPress={() => {}} />
            <View style={styles.controlSpacer} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose model and reasoning"
              disabled={running}
              onPress={onOpenModel}
              style={({ pressed }) => [
                styles.modelControl,
                running && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text numberOfLines={1} style={styles.modelLabel}>
                {model}
                {reasoning ? ` ${reasoning}` : ''}
              </Text>
              <ChevronDown color={colors.accent} size={14} strokeWidth={2.2} />
            </Pressable>
            <IconButton label="Voice input — coming soon" icon={Mic} onPress={() => {}} />
            {running && onStop ? (
              <IconButton label="Stop assistant" icon={Square} accent onPress={onStop} />
            ) : (
              <IconButton
                label="Send message"
                icon={ArrowUp}
                accent
                disabled={!canSend}
                onPress={onSend}
              />
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    paddingHorizontal: 11,
    paddingTop: 7,
    paddingBottom: 10,
    backgroundColor: colors.background,
  },
  composer: {
    minHeight: 52,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#294047',
    backgroundColor: colors.panelRaised,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    overflow: 'hidden',
  },
  composerExpanded: { borderRadius: 20, borderColor: '#36545d' },
  input: {
    minHeight: 50,
    maxHeight: 132,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 11,
  },
  inputExpanded: { minHeight: 44, paddingTop: 12, paddingBottom: 0 },
  controls: {
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingBottom: 9,
  },
  controlSpacer: { flex: 1 },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  iconButtonAccent: { borderColor: colors.accent, backgroundColor: colors.accent },
  modelControl: {
    minHeight: 32,
    maxWidth: '58%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  modelLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', flexShrink: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
