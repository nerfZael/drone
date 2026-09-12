import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Bell from 'lucide-react-native/icons/bell';
import X from 'lucide-react-native/icons/x';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii } from '../theme';
import {
  mobileChatSubscriptionEventLabel,
  mobileChatSubscriptionDisplayIntent,
  mobileChatSubscriptionNextRunLabel,
  mobileChatSubscriptionResourceLabel,
  mobileChatSubscriptionSummary,
  type MobileChatSubscription,
} from './chat-subscriptions';

export function ChatSubscriptionIndicator({
  subscriptions,
  companion = false,
}: {
  subscriptions: MobileChatSubscription[];
  companion?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    if (!companion && subscriptions.length === 0) setOpen(false);
  }, [companion, subscriptions.length]);

  if (!companion && subscriptions.length === 0) return null;
  const title = companion ? 'Companion subscriptions' : 'Chat subscriptions';
  const summary = mobileChatSubscriptionSummary(subscriptions);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${summary}. Show ${title.toLowerCase()}.`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Bell color={colors.accent} size={15} strokeWidth={2} />
        <Text numberOfLines={1} style={styles.triggerText}>
          {companion ? subscriptions.length : summary}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <View style={[styles.layer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${title.toLowerCase()}`}
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text accessibilityRole="header" style={styles.title}>
                  {title}
                </Text>
                <Text style={styles.subtitle}>
                  Watching {subscriptions.length} resource{subscriptions.length === 1 ? '' : 's'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close ${title.toLowerCase()}`}
                hitSlop={8}
                onPress={() => setOpen(false)}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <X color={colors.textSecondary} size={19} strokeWidth={2.1} />
              </Pressable>
            </View>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {companion && subscriptions.length === 0 ? (
                <Text style={styles.intent}>Companion has no active subscriptions.</Text>
              ) : null}
              {subscriptions.map((subscription) => {
                const nextRun = mobileChatSubscriptionNextRunLabel(subscription);
                const displayIntent = mobileChatSubscriptionDisplayIntent(
                  subscription.intent,
                  subscriptions,
                );
                return (
                  <View key={subscription.id} style={styles.card}>
                    <Text style={styles.resource}>
                      {mobileChatSubscriptionResourceLabel(subscription)}
                    </Text>
                    {subscription.resourceType === 'cron' &&
                    subscription.resourceConfig?.expression ? (
                      <Text numberOfLines={1} style={styles.cronExpression}>
                        Cron · {subscription.resourceConfig.expression}
                      </Text>
                    ) : null}
                    <Text style={styles.events}>
                      {subscription.events.map(mobileChatSubscriptionEventLabel).join(', ')}
                    </Text>
                    {nextRun ? <Text style={styles.nextRun}>{nextRun}</Text> : null}
                    {displayIntent ? (
                      <Text style={styles.intent}>{displayIntent}</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 32,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  triggerText: { flexShrink: 1, color: colors.muted, fontSize: 12, fontWeight: '500' },
  pressed: { opacity: 0.7 },
  layer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    backgroundColor: colors.overlay,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '72%',
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: radii.xlarge,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.textStrong, fontSize: 17, fontWeight: '800' },
  subtitle: { color: colors.mutedDim, fontSize: 10, marginTop: 2 },
  close: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.whiteWashSoft,
  },
  list: { flexShrink: 1 },
  listContent: { padding: 10, gap: 7 },
  card: {
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.whiteWashSoft,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  resource: { color: colors.text, fontSize: 12, fontWeight: '700' },
  cronExpression: {
    color: colors.mutedDim,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  events: { color: colors.mutedDim, fontSize: 10, lineHeight: 15, marginTop: 4 },
  nextRun: { color: colors.mutedDim, fontSize: 10, lineHeight: 15, marginTop: 3 },
  intent: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
});
