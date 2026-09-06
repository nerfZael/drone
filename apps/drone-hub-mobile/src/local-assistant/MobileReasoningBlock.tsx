import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

export function MobileReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const value = text.trim();
  if (!value) return null;

  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Hide reasoning' : 'Show reasoning'}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
      >
        <Text style={styles.label}>Reasoning</Text>
        <Text style={styles.action}>{expanded ? 'Hide' : 'Show'}</Text>
      </Pressable>
      <Text
        numberOfLines={expanded ? undefined : 3}
        selectable={expanded}
        style={[styles.text, !expanded && styles.textCollapsed]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginBottom: 10,
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.mantle,
  },
  header: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerPressed: { backgroundColor: colors.surface0 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  action: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  text: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textCollapsed: { color: colors.subtle },
});
