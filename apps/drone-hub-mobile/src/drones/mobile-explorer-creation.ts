export function mobileExplorerCreationAction(name: string): 'create-file' | 'create-directory' {
  // A leading dot alone is a hidden name, not an extension.
  return /.+\.[^.]+$/.test(name.trim()) ? 'create-file' : 'create-directory';
}
