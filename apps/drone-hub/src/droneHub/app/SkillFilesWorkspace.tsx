import React from 'react';

import { desktopMonacoTheme } from '../../theme';
import { AppShortcutBoundary } from './AppShortcutBoundary';
import { DroneEditorWorkspace } from './DroneEditorWorkspace';
import {
  normalizeSkillPackagePath,
  skillPackageDraftFromSkill,
  type SkillPackageDraft,
  type SkillRecord,
} from './skill-library-model';
import { buttonClassName } from './skill-library-ui';
import type { UseSkillLibraryResult } from './use-skill-library';
import { editorLanguageForPath } from '../code-languages';
import { IconChevron } from '../icons';
import { FileTypeIcon, FolderTypeIcon } from '../files/FileTypeIcon';
import {
  DRONE_HUB_MONACO_SCROLLBAR_OPTIONS,
  defineDroneHubMonacoThemes,
  MonacoEditor,
  MonacoEditorErrorBoundary,
  type MonacoEditorMountHandler,
  type MonacoEditorProps,
} from '../files/monaco-editor-loader';
import { editorZoomedPixels, useEditorZoomLevel } from '../files/editor-zoom';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type SkillTreeNode = {
  key: string;
  kind: 'directory' | 'file';
  name: string;
  skillKey: string;
  skillId: string | null;
  relativePath: string;
  root: boolean;
  children: SkillTreeNode[];
};

type SkillTreeSelection = {
  skillKey: string;
  relativePath: string;
  kind: 'directory' | 'file';
};

function pathParent(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index < 0 ? '' : filePath.slice(0, index);
}

function packageTreeForSkill(
  skillKey: string,
  skillId: string | null,
  packageDraft: SkillPackageDraft,
): SkillTreeNode {
  const root: SkillTreeNode = {
    key: `${skillKey}:`,
    kind: 'directory',
    name: packageDraft.slug || 'new-skill',
    skillKey,
    skillId,
    relativePath: '',
    root: true,
    children: [],
  };
  const directories = new Map<string, SkillTreeNode>([['', root]]);
  for (const file of packageDraft.files) {
    const parts = file.path.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let parent = root;
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let directory = directories.get(currentPath);
      if (!directory) {
        directory = {
          key: `${skillKey}:${currentPath}`,
          kind: 'directory',
          name: part,
          skillKey,
          skillId,
          relativePath: currentPath,
          root: false,
          children: [],
        };
        directories.set(currentPath, directory);
        parent.children.push(directory);
      }
      parent = directory;
    }
    parent.children.push({
      key: `${skillKey}:${file.path}`,
      kind: 'file',
      name: fileName,
      skillKey,
      skillId,
      relativePath: file.path,
      root: false,
      children: [],
    });
  }
  const sortDeep = (nodes: SkillTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
      if (left.name === 'SKILL.md') return -1;
      if (right.name === 'SKILL.md') return 1;
      return left.name.localeCompare(right.name);
    });
    for (const node of nodes) sortDeep(node.children);
  };
  sortDeep(root.children);
  return root;
}

function findTreeNode(
  nodes: SkillTreeNode[],
  selection: SkillTreeSelection | null,
): SkillTreeNode | null {
  if (!selection) return null;
  const key = `${selection.skillKey}:${selection.relativePath}`;
  const visit = (items: SkillTreeNode[]): SkillTreeNode | null => {
    for (const item of items) {
      if (item.key === key && item.kind === selection.kind) return item;
      const nested = visit(item.children);
      if (nested) return nested;
    }
    return null;
  };
  return visit(nodes);
}

function PlainSkillEditor({
  value,
  saving,
  onChange,
  onSave,
}: {
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const editorZoomLevel = useEditorZoomLevel();
  return (
    <textarea
      value={value}
      readOnly={saving}
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          onSave();
        }
      }}
      className="h-full w-full resize-none border-0 bg-[var(--panel-alt)] p-3 font-mono text-[var(--text-12)] leading-5 text-[var(--fg-secondary)] outline-none"
      style={{
        fontSize: `${editorZoomedPixels(12, editorZoomLevel)}px`,
        lineHeight: `${editorZoomedPixels(20, editorZoomLevel)}px`,
      }}
      aria-label="Skill file editor"
    />
  );
}

function SkillTextEditor({
  skillKey,
  slug,
  filePath,
  value,
  saving,
  onChange,
  onSave,
}: {
  skillKey: string;
  slug: string;
  filePath: string;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const themeId = useDroneHubUiStore((state) => state.themeId);
  const monacoTheme = desktopMonacoTheme(themeId);
  const editorZoomLevel = useEditorZoomLevel();
  // Monaco runs onMount only once, so its command must dereference the current callback.
  const onSaveRef = React.useRef(onSave);
  onSaveRef.current = onSave;
  const fallback = (
    <PlainSkillEditor value={value} saving={saving} onChange={onChange} onSave={onSave} />
  );
  const options = React.useMemo<MonacoEditorProps['options']>(
    () => ({
      readOnly: saving,
      fontSize: editorZoomedPixels(12, editorZoomLevel),
      minimap: { enabled: false },
      scrollbar: DRONE_HUB_MONACO_SCROLLBAR_OPTIONS,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 12, bottom: 12 },
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, highlightActiveIndentation: true },
    }),
    [editorZoomLevel, saving],
  );
  const handleMount = React.useCallback<MonacoEditorMountHandler>(
    (editor, monaco) => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current());
      editor.focus();
    },
    [],
  );
  return (
    <AppShortcutBoundary data-editor-zoom-surface="file-editor" className="h-full w-full">
      <MonacoEditorErrorBoundary fallback={fallback}>
        <React.Suspense fallback={fallback}>
          <MonacoEditor
            path={`inmemory://skills/${encodeURIComponent(skillKey)}/${slug}/${filePath}`}
            language={editorLanguageForPath(filePath)}
            value={value}
            loading={fallback}
            onChange={(next) => onChange(next ?? '')}
            beforeMount={defineDroneHubMonacoThemes}
            onMount={handleMount}
            theme={monacoTheme.id}
            options={options}
          />
        </React.Suspense>
      </MonacoEditorErrorBoundary>
    </AppShortcutBoundary>
  );
}

export function SkillFilesWorkspace({ skillLibrary }: { skillLibrary: UseSkillLibraryResult }) {
  const {
    skills,
    selectedSkillId,
    packageDraft,
    draftDirty,
    skillsSaving,
    skillsDeleting,
    draft,
    selectSkill,
    updatePackageFileContent,
    addPackageFile,
    renamePackagePath,
    deletePackagePath,
    updatePackageSlug,
    savePackageDraft,
    deleteSelectedSkill,
    resetDraft,
  } = skillLibrary;
  const activeSkillKey = selectedSkillId ?? '__new__';
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [selection, setSelection] = React.useState<SkillTreeSelection | null>(() => ({
    skillKey: activeSkillKey,
    relativePath: 'SKILL.md',
    kind: 'file',
  }));

  const roots = React.useMemo(() => {
    const out = skills.map((skill: SkillRecord) =>
      packageTreeForSkill(
        skill.id,
        skill.id,
        skill.id === selectedSkillId ? packageDraft : skillPackageDraftFromSkill(skill),
      ),
    );
    if (!selectedSkillId) out.unshift(packageTreeForSkill('__new__', null, packageDraft));
    return out;
  }, [packageDraft, selectedSkillId, skills]);

  React.useEffect(() => {
    setExpanded((current) => ({ ...current, [`${activeSkillKey}:`]: true }));
    setSelection((current) => {
      if (current?.skillKey === activeSkillKey) return current;
      return { skillKey: activeSkillKey, relativePath: 'SKILL.md', kind: 'file' };
    });
  }, [activeSkillKey]);

  React.useEffect(() => {
    if (findTreeNode(roots, selection)) return;
    setSelection({ skillKey: activeSkillKey, relativePath: 'SKILL.md', kind: 'file' });
  }, [activeSkillKey, roots, selection]);

  const selectedNode = React.useMemo(() => findTreeNode(roots, selection), [roots, selection]);
  const selectedFile =
    selectedNode?.kind === 'file' && selectedNode.skillKey === activeSkillKey
      ? (packageDraft.files.find((file) => file.path === selectedNode.relativePath) ?? null)
      : null;
  const activeSlug = packageDraft.slug || 'new-skill';

  const activateNode = React.useCallback(
    (node: SkillTreeNode) => {
      if (node.skillKey !== activeSkillKey) {
        if (draftDirty && !window.confirm('Discard unsaved skill edits?')) return;
        selectSkill(node.skillId);
      }
      setSelection({
        skillKey: node.skillKey,
        relativePath: node.relativePath,
        kind: node.kind,
      });
      if (node.kind === 'directory') {
        setExpanded((current) => ({ ...current, [node.key]: current[node.key] !== true }));
      }
    },
    [activeSkillKey, draftDirty, selectSkill],
  );

  const createFile = React.useCallback(() => {
    const basePath =
      selectedNode?.kind === 'directory'
        ? selectedNode.relativePath
        : selectedNode?.relativePath
          ? pathParent(selectedNode.relativePath)
          : '';
    const raw = window.prompt(
      'File path relative to the skill folder',
      basePath ? `${basePath}/` : '',
    );
    if (raw == null || !raw.trim()) return;
    if (!addPackageFile(raw)) return;
    const normalized = normalizeSkillPackagePath(raw);
    setSelection({ skillKey: activeSkillKey, relativePath: normalized, kind: 'file' });
    const parent = pathParent(normalized);
    if (parent) setExpanded((current) => ({ ...current, [`${activeSkillKey}:${parent}`]: true }));
  }, [activeSkillKey, addPackageFile, selectedNode]);

  const renameSelected = React.useCallback(() => {
    if (!selectedNode) return;
    if (selectedNode.root) {
      const raw = window.prompt('Skill folder name', activeSlug);
      if (raw == null || !raw.trim() || !updatePackageSlug(raw)) return;
      setSelection({ skillKey: activeSkillKey, relativePath: '', kind: 'directory' });
      return;
    }
    const raw = window.prompt('New package path', selectedNode.relativePath);
    if (raw == null || !raw.trim() || !renamePackagePath(selectedNode.relativePath, raw)) return;
    const normalized = normalizeSkillPackagePath(raw);
    setSelection({
      skillKey: activeSkillKey,
      relativePath: normalized,
      kind: selectedNode.kind,
    });
  }, [activeSkillKey, activeSlug, renamePackagePath, selectedNode, updatePackageSlug]);

  const deleteSelected = React.useCallback(() => {
    if (!selectedNode || selectedNode.relativePath === 'SKILL.md') return;
    if (selectedNode.root) {
      if (!draft.id) return;
      if (!window.confirm(`Delete skill folder ${activeSlug}? This cannot be undone.`)) return;
      void deleteSelectedSkill();
      return;
    }
    const label = selectedNode.kind === 'directory' ? 'folder and all of its files' : 'file';
    if (!window.confirm(`Delete this ${label}: ${selectedNode.relativePath}?`)) return;
    if (!deletePackagePath(selectedNode.relativePath)) return;
    setSelection({ skillKey: activeSkillKey, relativePath: 'SKILL.md', kind: 'file' });
  }, [activeSkillKey, activeSlug, deletePackagePath, deleteSelectedSkill, draft.id, selectedNode]);

  const revertPackage = React.useCallback(() => {
    if (!draftDirty || !window.confirm('Discard unsaved skill edits?')) return;
    resetDraft();
  }, [draftDirty, resetDraft]);

  function renderNodes(nodes: SkillTreeNode[], depth: number, zoom: number): React.ReactNode {
    const rowHeight = Math.round(23 * zoom);
    const textSize = Math.round(12 * zoom * 10) / 10;
    return nodes.map((node) => {
      const open = expanded[node.key] === true;
      const selected = selectedNode?.key === node.key;
      return (
        <React.Fragment key={node.key}>
          <button
            type="button"
            role="treeitem"
            aria-expanded={node.kind === 'directory' ? open : undefined}
            aria-selected={selected}
            onClick={() => activateNode(node)}
            className={`flex w-full min-w-0 items-center gap-1.5 pr-2 text-left transition-colors ${
              selected
                ? 'bg-[var(--info-subtle)] text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)]'
                : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-strong)]'
            }`}
            style={{
              height: `${rowHeight}px`,
              paddingLeft: `${6 + depth * Math.round(14 * zoom)}px`,
              fontSize: `${textSize}px`,
            }}
            title={node.root ? node.name : `${activeSlug}/${node.relativePath}`}
          >
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--muted)]">
              {node.kind === 'directory' ? <IconChevron down={open} size={12 * zoom} /> : null}
            </span>
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
              {node.kind === 'directory' ? (
                <FolderTypeIcon path={node.relativePath || node.name} size={15 * zoom} />
              ) : (
                <FileTypeIcon path={node.relativePath} size={15 * zoom} />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {node.root && node.skillKey === activeSkillKey && draftDirty ? (
              <span className="text-[var(--accent)]" aria-label="Unsaved changes">
                ●
              </span>
            ) : null}
          </button>
          {node.kind === 'directory' && open ? renderNodes(node.children, depth + 1, zoom) : null}
        </React.Fragment>
      );
    });
  }

  return (
    <div className="h-[clamp(560px,70vh,780px)] min-h-0 overflow-hidden border border-[var(--border-subtle)] bg-[var(--panel-alt)]">
      <DroneEditorWorkspace
        explorer={(zoom) => (
          <div className="flex h-full min-h-0 flex-col">
            <div className="grid shrink-0 grid-cols-2 gap-0.5 border-b border-[var(--border-subtle)] p-1">
              <button
                type="button"
                onClick={createFile}
                className={`${buttonClassName('secondary', skillsSaving)} !h-7 px-1`}
                disabled={skillsSaving}
              >
                New file
              </button>
              <button
                type="button"
                onClick={renameSelected}
                className={`${buttonClassName(
                  'secondary',
                  !selectedNode || skillsSaving || selectedNode.relativePath === 'SKILL.md',
                )} !h-7 px-1`}
                disabled={!selectedNode || skillsSaving || selectedNode.relativePath === 'SKILL.md'}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                className={`${buttonClassName(
                  'danger',
                  !selectedNode ||
                    selectedNode.relativePath === 'SKILL.md' ||
                    (selectedNode.root && !draft.id) ||
                    skillsSaving ||
                    skillsDeleting,
                )} !h-7 px-1`}
                disabled={
                  !selectedNode ||
                  selectedNode.relativePath === 'SKILL.md' ||
                  (selectedNode.root && !draft.id) ||
                  skillsSaving ||
                  skillsDeleting
                }
              >
                Delete
              </button>
              <button
                type="button"
                onClick={revertPackage}
                className={`${buttonClassName(
                  'secondary',
                  !draftDirty || skillsSaving || skillsDeleting,
                )} !h-7 px-1`}
                disabled={!draftDirty || skillsSaving || skillsDeleting}
              >
                Revert
              </button>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto py-1"
              role="tree"
              aria-label="Skill package files"
            >
              {renderNodes(roots, 0, zoom)}
            </div>
          </div>
        )}
        editor={
          selectedFile ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3">
                <span className="min-w-0 truncate font-mono text-[var(--text-11)] text-[var(--fg-secondary)]">
                  {activeSlug}/{selectedFile.path}
                </span>
                <span
                  className={`shrink-0 dh-type-menu-meta ${draftDirty ? '!text-[var(--accent)]' : ''}`}
                >
                  {draftDirty ? 'Unsaved changes' : 'Saved'}
                </span>
              </div>
              {selectedFile.path === 'SKILL.md' ? (
                <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-1.5 dh-type-supporting">
                  Portable frontmatter lives here. Agent-specific options remain available in
                  Details.
                </div>
              ) : null}
              <div className="min-h-0 flex-1">
                <SkillTextEditor
                  skillKey={activeSkillKey}
                  slug={activeSlug}
                  filePath={selectedFile.path}
                  value={selectedFile.content}
                  saving={skillsSaving}
                  onChange={(content) => updatePackageFileContent(selectedFile.path, content)}
                  onSave={() => void savePackageDraft()}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-5 text-center text-[var(--text-12)] text-[var(--muted)]">
              Select a file to edit it. Folders are represented by their contained files.
            </div>
          )
        }
      />
    </div>
  );
}
