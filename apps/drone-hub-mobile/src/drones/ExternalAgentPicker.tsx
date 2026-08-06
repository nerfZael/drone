import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Search from 'lucide-react-native/icons/search';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import { AnchoredPickerPopover } from './AnchoredPickerPopover';

export type ExternalAgentPickerOption = {
  id: string;
  label: string;
  detail: string;
};

export function ExternalAgentPicker({
  open,
  value,
  options,
  disabled = false,
  onOpen,
  onClose,
  onSelect,
}: {
  open: boolean;
  value: string;
  options: ExternalAgentPickerOption[];
  disabled?: boolean;
  onOpen(): void;
  onClose(): void;
  onSelect(value: string): void;
}) {
  const window = useWindowDimensions();
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const selected = options.find((option) => option.id === value) ?? options[0];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        `${option.label} ${option.detail}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : options;

  return (
    <AnchoredPickerPopover
      open={open}
      onClose={onClose}
      width={Math.min(window.width - 36, 300)}
      align="left"
      anchorStyle={[styles.root, open && styles.rootOpen]}
      menuStyle={styles.menu}
      trigger={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Agent: ${selected?.label ?? value}`}
          accessibilityState={{ expanded: open, disabled }}
          disabled={disabled}
          hitSlop={4}
          onPress={open ? onClose : onOpen}
          style={({ pressed }) => [
            styles.trigger,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text numberOfLines={1} style={styles.triggerLabel}>
            {selected?.label ?? value}
          </Text>
          <ChevronDown
            color={colors.accent}
            size={15}
            strokeWidth={2.1}
            style={open ? styles.chevronOpen : undefined}
          />
        </Pressable>
      }
    >
      <Text style={styles.menuTitle}>Choose agent</Text>
      <View style={styles.searchWrap}>
        <Search color={colors.mutedDim} size={14} strokeWidth={2} />
        <ThemedTextInput
          accessibilityLabel="Search agents"
          value={query}
          onChangeText={setQuery}
          placeholder="Search agents"
          placeholderTextColor={colors.mutedDim}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
      </View>
      <ScrollView
        accessibilityRole="radiogroup"
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
        contentContainerStyle={styles.list}
      >
        {filteredOptions.map((option) => {
          const active = option.id === value;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled }}
              disabled={disabled}
              onPress={() => {
                onSelect(option.id);
                onClose();
              }}
              style={({ pressed }) => [
                styles.option,
                active && styles.optionActive,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.optionCopy}>
                <Text style={[styles.optionLabel, active && styles.activeText]}>
                  {option.label}
                </Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </View>
              {active ? <Check color={colors.accent} size={15} strokeWidth={2.7} /> : null}
            </Pressable>
          );
        })}
        {filteredOptions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No matching agents.</Text>
          </View>
        ) : null}
      </ScrollView>
    </AnchoredPickerPopover>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative', zIndex: 1 },
  rootOpen: { zIndex: 40 },
  trigger: {
    minHeight: 32,
    maxWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 5,
  },
  triggerLabel: { flexShrink: 1, color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  menu: {
    maxHeight: 340,
    overflow: 'hidden',
    paddingTop: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  menuTitle: {
    color: colors.mutedDim,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
    paddingHorizontal: 9,
    paddingBottom: 6,
  },
  searchWrap: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: 7,
    marginBottom: 5,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 7,
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 6, color: colors.text, fontSize: 12 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  list: { paddingHorizontal: 6, paddingBottom: 6 },
  option: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  optionActive: { backgroundColor: colors.accentDark },
  optionCopy: { flex: 1, minWidth: 0 },
  optionLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  optionDetail: { color: colors.mutedDim, fontSize: 9, lineHeight: 13, marginTop: 1 },
  activeText: { color: colors.accentAlt },
  emptyState: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.muted, fontSize: 11 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
