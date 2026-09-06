import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Bell from 'lucide-react-native/icons/bell';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import {
  eventNotificationCollapsedSummary,
  eventNotificationDataFields,
  eventNotificationEventLabel,
  eventNotificationResourceLabel,
  type EventNotificationDisplay,
} from '@drone/assistant-chat';

import { colors, radii } from '../theme';

export function MobileEventNotification({
  notification,
  onLongPress,
}: {
  notification: EventNotificationDisplay;
  onLongPress?: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const { title, subtitle } = eventNotificationCollapsedSummary(notification);

  return (
    <View style={styles.group}>
      <View style={styles.label}>
        <Text style={styles.labelText}>Event notification</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${subtitle}`}
        accessibilityHint="Shows or hides event details"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View style={styles.summaryRow}>
          <View style={styles.icon}>
            <Bell color={colors.accent} size={16} strokeWidth={2} />
          </View>
          <View style={styles.summaryCopy}>
            <Text style={styles.title}>{title}</Text>
            <Text numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          </View>
          <ChevronDown
            color={colors.muted}
            size={16}
            strokeWidth={2}
            style={expanded ? styles.chevronExpanded : undefined}
          />
        </View>
        {expanded ? (
          <View style={styles.details}>
            {notification.events.map((event, index) => {
              const fields = eventNotificationDataFields(event.providerContentText);
              return (
                <View
                  key={`${event.provider}:${event.resourceType}:${event.resourceId}:${event.eventType}:${index}`}
                  style={[styles.event, index > 0 && styles.eventWithDivider]}
                >
                  <Text style={styles.eventTitle}>
                    {eventNotificationEventLabel(event.eventType)}
                  </Text>
                  <Text style={styles.resource}>{eventNotificationResourceLabel(event)}</Text>
                  {event.summary ? <Text style={styles.summary}>{event.summary}</Text> : null}
                  {fields.length > 0 ? (
                    <View style={styles.data}>
                      <Text style={styles.dataLabel}>Event data</Text>
                      {fields.map((field, fieldIndex) => (
                        <View key={`${field.label}:${fieldIndex}`} style={styles.dataRow}>
                          <Text style={styles.dataKey}>{field.label}</Text>
                          <Text selectable style={styles.dataValue}>
                            {field.value}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    width: '90%',
    maxWidth: 560,
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    marginHorizontal: 16,
    marginVertical: 6,
  },
  label: {
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.accentBorder,
    borderTopLeftRadius: radii.large,
    borderTopRightRadius: radii.large,
    backgroundColor: colors.accentDark,
  },
  labelText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  card: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.userBubbleBorder,
    borderRadius: 16,
    borderTopRightRadius: 0,
    backgroundColor: colors.userBubble,
  },
  pressed: { opacity: 0.76 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  icon: {
    width: 20,
    height: 28,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 5,
  },
  summaryCopy: { minWidth: 0, flex: 1 },
  title: { color: colors.userBubbleText, fontSize: 14, fontWeight: '700' },
  subtitle: { color: colors.secondary, fontSize: 11, marginTop: 2 },
  chevronExpanded: { transform: [{ rotate: '180deg' }] },
  details: {
    marginTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.userBubbleBorder,
  },
  event: {
    paddingVertical: 10,
  },
  eventWithDivider: { borderTopWidth: 1, borderTopColor: colors.userBubbleBorder },
  eventTitle: { color: colors.userBubbleText, fontSize: 13, fontWeight: '700' },
  resource: { color: colors.secondary, fontSize: 11, marginTop: 2 },
  summary: { color: colors.userBubbleText, fontSize: 13, lineHeight: 19, marginTop: 7 },
  data: { marginTop: 9 },
  dataLabel: { color: colors.secondary, fontSize: 11, fontWeight: '700', marginBottom: 5 },
  dataRow: { flexDirection: 'row', gap: 10, paddingVertical: 2 },
  dataKey: {
    width: '38%',
    color: colors.secondary,
    fontSize: 10,
    lineHeight: 15,
  },
  dataValue: { flex: 1, color: colors.userBubbleText, fontSize: 10, lineHeight: 15 },
});
