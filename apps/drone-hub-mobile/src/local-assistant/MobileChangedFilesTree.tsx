import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Folder from 'lucide-react-native/icons/folder';
import type { AgentRunFileChangeEntry } from '@blip/protocol';
import { buildAgentRunChangeTree, type AgentRunChangeTreeNode } from '@drone/assistant-chat';
import { colors } from '../theme';

export function MobileChangedFilesTree({
  entries,
  renderFile,
}: {
  entries: AgentRunFileChangeEntry[];
  renderFile: (entry: AgentRunFileChangeEntry, name: string) => React.JSX.Element;
}) {
  const nodes = React.useMemo(() => buildAgentRunChangeTree(entries), [entries]);
  const [collapsedDirectories, setCollapsedDirectories] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleDirectory = React.useCallback((path: string) => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const renderNode = (node: AgentRunChangeTreeNode, depth: number): React.JSX.Element => {
    if (node.kind === 'file') {
      return (
        <View key={`file:${node.path}`} style={[styles.file, { paddingLeft: 12 + depth * 14 }]}>
          {renderFile(node.entry, node.name)}
        </View>
      );
    }

    const collapsed = collapsedDirectories.has(node.path);
    return (
      <View key={`directory:${node.path}`}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${node.name}`}
          accessibilityState={{ expanded: !collapsed }}
          onPress={() => toggleDirectory(node.path)}
          style={[styles.directory, { paddingLeft: 12 + depth * 14 }]}
        >
          {({ pressed }) => (
            <>
              {collapsed ? (
                <ChevronRight
                  color={pressed ? colors.accent : colors.mutedDim}
                  size={12}
                  strokeWidth={2}
                />
              ) : (
                <ChevronDown
                  color={pressed ? colors.accent : colors.mutedDim}
                  size={12}
                  strokeWidth={2}
                />
              )}
              <Folder color={pressed ? colors.text : colors.muted} size={13} strokeWidth={1.8} />
              <Text
                numberOfLines={1}
                style={[styles.directoryName, pressed && styles.directoryNamePressed]}
              >
                {node.name}
              </Text>
              {collapsed ? (
                <View style={[styles.stats, pressed && styles.statsPressed]}>
                  {node.stats.additions > 0 ? (
                    <Text style={styles.additions}>+{node.stats.additions}</Text>
                  ) : null}
                  {node.stats.deletions > 0 ? (
                    <Text style={styles.deletions}>-{node.stats.deletions}</Text>
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </Pressable>
        {!collapsed ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </View>
    );
  };

  return <View>{nodes.map((node) => renderNode(node, 0))}</View>;
}

const styles = StyleSheet.create({
  directory: {
    minHeight: 29,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 12,
    paddingVertical: 5,
  },
  directoryName: {
    flex: 1,
    color: colors.muted,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  directoryNamePressed: { color: colors.text },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 6, opacity: 0.75 },
  statsPressed: { opacity: 1 },
  additions: { color: colors.online, fontSize: 9, fontFamily: 'monospace' },
  deletions: { color: colors.danger, fontSize: 9, fontFamily: 'monospace' },
  file: { paddingRight: 0 },
});
