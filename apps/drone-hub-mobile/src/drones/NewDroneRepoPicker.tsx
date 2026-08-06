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
import FolderGit2 from 'lucide-react-native/icons/folder-git-2';
import Search from 'lucide-react-native/icons/search';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import { AnchoredPickerPopover } from './AnchoredPickerPopover';
import { mobileRepoLabel, type MobileDroneCreateRepo } from './drone-sidebar-model';

export function NewDroneRepoPicker({
  open,
  value,
  repos,
  loading,
  disabled,
  onOpen,
  onClose,
  onSelect,
}: {
  open: boolean;
  value: string;
  repos: MobileDroneCreateRepo[];
  loading?: boolean;
  disabled?: boolean;
  onOpen(): void;
  onClose(): void;
  onSelect(path: string): void;
}) {
  const window = useWindowDimensions();
  const [query, setQuery] = React.useState('');
  React.useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const selectedRepo = repos.find((repo) => repo.path === value) ?? null;
  const selectedLabel = selectedRepo ? mobileRepoLabel(selectedRepo.path) : 'No repo';
  const compact = window.width < 420;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRepos = normalizedQuery
    ? repos.filter((repo) =>
        `${mobileRepoLabel(repo.path)} ${repo.path}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : repos;

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
          accessibilityLabel={`Repository: ${loading ? 'Loading repositories' : selectedLabel}`}
          accessibilityState={{ expanded: open, disabled: disabled || loading }}
          disabled={disabled || loading}
          hitSlop={4}
          onPress={open ? onClose : onOpen}
          style={({ pressed }) => [
            styles.trigger,
            (disabled || loading) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {!compact ? (
            <FolderGit2
              color={selectedRepo ? colors.accent : colors.muted}
              size={15}
              strokeWidth={2}
            />
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.triggerLabel, compact && styles.triggerLabelCompact]}
          >
            {loading ? 'Loading…' : selectedLabel}
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
      <Text style={styles.menuTitle}>Repository</Text>
      <View style={styles.searchWrap}>
        <Search color={colors.mutedDim} size={14} strokeWidth={2} />
        <ThemedTextInput
          accessibilityLabel="Search repositories"
          value={query}
          onChangeText={setQuery}
          placeholder="Search repositories"
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
        {!normalizedQuery || 'no repository'.includes(normalizedQuery) ? (
          <RepoRow
            label="No repository"
            detail="Create without a repository"
            selected={!value}
            onPress={() => onSelect('')}
          />
        ) : null}
        {filteredRepos.map((repo) => (
          <RepoRow
            key={repo.path}
            label={mobileRepoLabel(repo.path)}
            detail={repo.path}
            selected={repo.path === value}
            onPress={() => onSelect(repo.path)}
          />
        ))}
        {filteredRepos.length === 0 &&
        normalizedQuery &&
        !'no repository'.includes(normalizedQuery) ? (
          <View style={styles.stateRow}>
            <Text style={styles.stateText}>No matching repositories.</Text>
          </View>
        ) : null}
      </ScrollView>
    </AnchoredPickerPopover>
  );
}

function RepoRow({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.rowActive, pressed && styles.pressed]}
    >
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowLabel, selected && styles.activeText]}>
          {label}
        </Text>
        <Text numberOfLines={1} style={styles.rowDetail}>
          {detail}
        </Text>
      </View>
      {selected ? <Check color={colors.accent} size={15} strokeWidth={2.7} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative', flexShrink: 1, minWidth: 48, marginLeft: 'auto', zIndex: 1 },
  rootOpen: { zIndex: 30 },
  trigger: {
    minHeight: 32,
    maxWidth: 176,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
  },
  triggerLabel: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 124,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  triggerLabelCompact: { maxWidth: 96 },
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
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  rowActive: { backgroundColor: colors.accentDark },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { color: colors.text, fontSize: 11, fontWeight: '700' },
  rowDetail: { color: colors.mutedDim, fontSize: 9, marginTop: 2, fontFamily: 'monospace' },
  activeText: { color: colors.accentAlt },
  stateRow: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  stateText: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
