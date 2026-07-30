import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { chatAttachmentTypeLabel } from '@drone/assistant-chat';
import X from 'lucide-react-native/icons/x';
import FileText from 'lucide-react-native/icons/file-text';
import { colors } from '../theme';
import type { MobileChatAttachment } from './pick-chat-images';

function attachmentSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ChatAttachmentStrip({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: readonly MobileChatAttachment[];
  disabled?: boolean;
  onRemove(id: string): void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {attachments.map((attachment, index) => {
        const typeLabel = chatAttachmentTypeLabel(attachment);
        const isImage = typeLabel === 'Image';
        return (
          <View key={attachment.id} style={styles.card}>
            {isImage ? (
              <Image source={{ uri: attachment.uri }} resizeMode="cover" style={styles.thumbnail} />
            ) : (
              <View style={[styles.thumbnail, styles.fileThumbnail]}>
                <FileText color={colors.accent} size={20} strokeWidth={1.9} />
              </View>
            )}
            <View style={styles.copy}>
              <Text numberOfLines={1} style={styles.name}>
                {attachment.name}
              </Text>
              <Text style={styles.meta}>
                {typeLabel.toUpperCase()} {index + 1} ·{' '}
                {attachmentSize(attachment.size)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${attachment.name}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              hitSlop={7}
              onPress={() => onRemove(attachment.id)}
              style={({ pressed }) => [
                styles.remove,
                disabled && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <X color={colors.muted} size={14} strokeWidth={2.2} />
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingHorizontal: 9, paddingTop: 8, paddingBottom: 2 },
  card: {
    width: 190,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 6,
    paddingRight: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  thumbnail: { width: 42, height: 42, borderRadius: 4, backgroundColor: colors.background },
  fileThumbnail: { alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: colors.text, fontSize: 11, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.45 },
  remove: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.65 },
});
