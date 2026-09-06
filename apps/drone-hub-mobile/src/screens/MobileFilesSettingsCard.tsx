import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Label, textStyles } from '../components/Ui';
import {
  setMobileExplorerFolderIcons,
  useMobileExplorerFolderIcons,
} from '../mobile-explorer-folder-icons';
import { colors } from '../theme';

export function MobileFilesSettingsCard() {
  const folderIcons = useMobileExplorerFolderIcons();
  return (
    <View style={styles.section}>
      <Label>Files</Label>
      <Text style={[textStyles.heading, styles.title]}>File explorer</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.fieldLabel}>Folder icons</Text>
          <Text style={styles.helper}>
            Show an icon beside each folder in the file list. Files always show their type icon.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Show folder icons"
          value={folderIcons}
          onValueChange={(value) => void setMobileExplorerFolderIcons(value)}
          trackColor={{ false: colors.borderStrong, true: colors.accent }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { marginTop: 6, marginBottom: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchCopy: { flex: 1, gap: 3 },
  fieldLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  helper: { color: colors.secondary, fontSize: 11, lineHeight: 16 },
});
