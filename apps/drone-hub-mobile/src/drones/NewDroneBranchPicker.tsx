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
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import GitBranch from 'lucide-react-native/icons/git-branch';
import Search from 'lucide-react-native/icons/search';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import { AnchoredPickerPopover } from './AnchoredPickerPopover';
import type { MobileDroneCreateBranch } from './drone-sidebar-model';
import type { MobileDroneCreateBranchSource } from './NewDroneScreen';

function BranchBadge({ kind }: { kind: 'host' | 'remote' }) {
  return (
    <View style={[styles.badge, kind === 'host' ? styles.hostBadge : styles.remoteBadge]}>
      <Text
        style={[styles.badgeText, kind === 'host' ? styles.hostBadgeText : styles.remoteBadgeText]}
      >
        {kind}
      </Text>
    </View>
  );
}

export function mobileHostBranchLabel(hostBranch: string | null): string {
  return String(hostBranch ?? '').trim() || 'Detached HEAD';
}

export function NewDroneBranchPicker({
  open,
  branchSource,
  remoteBranch,
  hostBranch,
  remoteBranches,
  remoteEnabled,
  loading,
  disabled,
  onOpen,
  onClose,
  onSelect,
}: {
  open: boolean;
  branchSource: MobileDroneCreateBranchSource;
  remoteBranch: string;
  hostBranch: string | null;
  remoteBranches: MobileDroneCreateBranch[];
  remoteEnabled: boolean;
  loading?: boolean;
  disabled?: boolean;
  onOpen(): void;
  onClose(): void;
  onSelect(selection: { branchSource: MobileDroneCreateBranchSource; remoteBranch?: string }): void;
}) {
  const window = useWindowDimensions();
  const [query, setQuery] = React.useState('');
  React.useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const effectiveSource = remoteEnabled ? branchSource : 'host';
  const hostLabel = mobileHostBranchLabel(hostBranch);
  const selectedLabel = effectiveSource === 'host' ? hostLabel : remoteBranch || 'Choose branch';
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRemoteBranches = normalizedQuery
    ? remoteBranches.filter((branch) =>
        `${branch.name} ${branch.remote} ${branch.branch}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : remoteBranches;
  const showHost =
    !normalizedQuery || `${hostLabel} host current`.toLocaleLowerCase().includes(normalizedQuery);

  return (
    <AnchoredPickerPopover
      open={open}
      onClose={onClose}
      width={Math.min(window.width - 36, 320)}
      anchorStyle={[styles.root, open && styles.rootOpen]}
      menuStyle={styles.menu}
      trigger={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Branch: ${selectedLabel}`}
          accessibilityState={{ expanded: open, disabled }}
          disabled={disabled || loading}
          hitSlop={4}
          onPress={open ? onClose : onOpen}
          style={({ pressed }) => [
            styles.trigger,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <GitBranch color={colors.muted} size={14} strokeWidth={2} />
          <Text numberOfLines={1} style={styles.triggerValue}>
            {loading ? 'Loading branches…' : selectedLabel}
          </Text>
          {loading ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <ChevronDown
              color={colors.accent}
              size={15}
              strokeWidth={2.1}
              style={open ? styles.chevronOpen : undefined}
            />
          )}
        </Pressable>
      }
    >
      <Text style={styles.menuTitle}>Branch</Text>
      <View style={styles.searchWrap}>
        <Search color={colors.mutedDim} size={14} strokeWidth={2} />
        <ThemedTextInput
          accessibilityLabel="Search branches"
          value={query}
          onChangeText={setQuery}
          placeholder="Search branches"
          placeholderTextColor={colors.mutedDim}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
        contentContainerStyle={styles.list}
      >
        {showHost ? (
          <BranchRow
            label={hostLabel}
            kind="host"
            selected={effectiveSource === 'host'}
            onPress={() => {
              onSelect({ branchSource: 'host' });
              onClose();
            }}
          />
        ) : null}
        {showHost && filteredRemoteBranches.length > 0 ? <View style={styles.separator} /> : null}
        {filteredRemoteBranches.map((branch) => (
          <BranchRow
            key={branch.name}
            label={branch.name}
            kind="remote"
            disabled={!remoteEnabled}
            selected={effectiveSource === 'remote' && branch.name === remoteBranch}
            onPress={() => {
              onSelect({ branchSource: 'remote', remoteBranch: branch.name });
              onClose();
            }}
          />
        ))}
        {!showHost && filteredRemoteBranches.length === 0 ? (
          <View style={styles.stateRow}>
            <Text style={styles.stateText}>No matching branches.</Text>
          </View>
        ) : null}
      </ScrollView>
      {!remoteEnabled && remoteBranches.length > 0 ? (
        <Text style={styles.notice}>Remote branches require the Container target.</Text>
      ) : null}
    </AnchoredPickerPopover>
  );
}

function BranchRow({
  label,
  kind,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  kind: 'host' | 'remote';
  selected: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowActive,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text numberOfLines={1} style={[styles.branchName, selected && styles.activeText]}>
        {label}
      </Text>
      <BranchBadge kind={kind} />
      {selected ? <Check color={colors.accent} size={15} strokeWidth={2.7} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative', flexGrow: 1, flexShrink: 1, minWidth: 64, zIndex: 1 },
  rootOpen: { zIndex: 30 },
  trigger: {
    minHeight: 32,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
  },
  triggerValue: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  menu: {
    maxHeight: 330,
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
    elevation: 14,
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
  badge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  hostBadge: { borderColor: colors.onlineBorder },
  remoteBadge: { borderColor: colors.border },
  badgeText: { fontSize: 8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.45 },
  hostBadgeText: { color: colors.online },
  remoteBadgeText: { color: colors.mutedDim },
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
  row: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  rowActive: { backgroundColor: colors.accentDark },
  branchName: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  activeText: { color: colors.accentAlt },
  separator: {
    height: 1,
    marginVertical: 3,
    marginHorizontal: 8,
    backgroundColor: colors.borderSubtle,
  },
  stateRow: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  stateText: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  notice: {
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 13,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
