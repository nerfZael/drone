import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import X from 'lucide-react-native/icons/x';
import { colors } from '../theme';
import type { MobileChatImage } from './pick-chat-images';

function imageSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ChatImageStrip({
  images,
  disabled,
  onRemove,
}: {
  images: readonly MobileChatImage[];
  disabled?: boolean;
  onRemove(id: string): void;
}) {
  if (images.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {images.map((image, index) => (
        <View key={image.id} style={styles.card}>
          <Image source={{ uri: image.uri }} resizeMode="cover" style={styles.thumbnail} />
          <View style={styles.copy}>
            <Text numberOfLines={1} style={styles.name}>
              {image.name}
            </Text>
            <Text style={styles.meta}>
              IMAGE {index + 1} · {imageSize(image.size)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${image.name}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={7}
            onPress={() => onRemove(image.id)}
            style={({ pressed }) => [
              styles.remove,
              disabled && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <X color={colors.muted} size={14} strokeWidth={2.2} />
          </Pressable>
        </View>
      ))}
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
