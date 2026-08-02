import React from 'react';
import {
  ActivityIndicator,
  Modal,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
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
  const insets = useSafeAreaInsets();
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
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Branch: ${selectedLabel}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.trigger,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <GitBranch color={colors.muted} size={16} strokeWidth={2} />
        <Text numberOfLines={1} style={styles.triggerValue}>
          {loading ? 'Loading branches…' : selectedLabel}
        </Text>
        {!loading ? (
          <BranchBadge kind={effectiveSource} />
        ) : (
          <ActivityIndicator color={colors.accent} size="small" />
        )}
        <ChevronDown color={colors.accent} size={15} strokeWidth={2.1} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={onClose}
      >
        <View style={styles.layer}>
          <Pressable
            accessibilityLabel="Close branch picker"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.sheet,
              {
                width: Math.min(window.width * 0.94, 420),
                marginBottom: Math.max(insets.bottom + 6, 12),
              },
            ]}
          >
            <Text style={styles.title}>Branch</Text>
            <View style={styles.searchWrap}>
              <Search color={colors.mutedDim} size={15} strokeWidth={2} />
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
              {loading ? (
                <View style={styles.stateRow}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={styles.stateText}>Loading branches…</Text>
                </View>
              ) : (
                <>
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
                  {showHost && filteredRemoteBranches.length > 0 ? (
                    <View style={styles.separator} />
                  ) : null}
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
                </>
              )}
            </ScrollView>
            {!remoteEnabled && remoteBranches.length > 0 ? (
              <Text style={styles.notice}>Remote branches require the Container target.</Text>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
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
  trigger: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.panel,
  },
  triggerValue: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  badge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  hostBadge: { borderColor: colors.onlineBorder, backgroundColor: 'transparent' },
  remoteBadge: { borderColor: colors.border, backgroundColor: 'transparent' },
  badgeText: { fontSize: 8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.45 },
  hostBadgeText: { color: colors.online },
  remoteBadgeText: { color: colors.mutedDim },
  layer: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end', paddingHorizontal: 10 },
  sheet: {
    maxWidth: '94%',
    maxHeight: '72%',
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  title: {
    color: colors.textStrong,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 8,
  },
  searchWrap: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: 9,
    marginBottom: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 7, color: colors.text, fontSize: 12 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  list: { paddingHorizontal: 7, paddingBottom: 7 },
  row: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
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
    marginVertical: 4,
    marginHorizontal: 8,
    backgroundColor: colors.borderSubtle,
  },
  stateRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  stateText: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  notice: {
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 13,
    paddingHorizontal: 13,
    paddingTop: 1,
    paddingBottom: 10,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
