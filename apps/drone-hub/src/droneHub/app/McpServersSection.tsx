import React from 'react';
import { MCP_AGENT_OPTIONS } from './mcp-server-library-model';
import { buttonClassName, inputClassName, textareaClassName } from './skill-library-ui';
import type { UseMcpServersResult } from './use-mcp-servers';

export function McpServersSection({ mcp }: { mcp: UseMcpServersResult }) {
  const {
    mcpServers,
    mcpAccessTokens,
    mcpServersLoading,
    mcpServersSaving,
    mcpServersDeleting,
    mcpAccessTokensLoading,
    mcpAccessTokensSaving,
    mcpServersError,
    mcpServersNotice,
    mcpHostTokenName,
    mcpTokenRevealValue,
    selectedMcpServerId,
    mcpDraft,
    mcpDraftDirty,
    loadMcpServers,
    loadMcpAccessTokens,
    setMcpHostTokenName,
    createHostMcpToken,
    regenerateMcpToken,
    revokeMcpToken,
    clearMcpTokenRevealValue,
    selectMcpServer,
    startNewMcpServer,
    updateMcpDraftField,
    toggleMcpDraftAgent,
    resetMcpDraft,
    saveMcpDraft,
    deleteSelectedMcpServer,
    upsertDroneHubMcpServer,
    clearMcpServersError,
    clearMcpServersNotice,
  } = mcp;

  const busy = mcpServersSaving || mcpServersDeleting || mcpAccessTokensSaving;
  const activeTokens = mcpAccessTokens.filter((token) => !token.revokedAt);

  const handleSelect = React.useCallback(
    (serverId: string) => {
      if (serverId === selectedMcpServerId) return;
      if (mcpDraftDirty) {
        const ok = window.confirm('Discard unsaved MCP server edits?');
        if (!ok) return;
      }
      selectMcpServer(serverId);
    },
    [mcpDraftDirty, selectMcpServer, selectedMcpServerId],
  );

  const handleNew = React.useCallback(() => {
    if (mcpDraftDirty) {
      const ok = window.confirm('Discard unsaved MCP server edits and start a new one?');
      if (!ok) return;
    }
    startNewMcpServer();
  }, [mcpDraftDirty, startNewMcpServer]);

  const handleRefresh = React.useCallback(() => {
    if (mcpDraftDirty) {
      const ok = window.confirm('Discard unsaved MCP server edits and reload?');
      if (!ok) return;
    }
    void loadMcpServers();
  }, [loadMcpServers, mcpDraftDirty]);

  const handleAddDroneHub = React.useCallback(() => {
    if (mcpDraftDirty) {
      const ok = window.confirm('Discard unsaved MCP server edits and add the Drone Hub MCP preset?');
      if (!ok) return;
    }
    void upsertDroneHubMcpServer();
  }, [mcpDraftDirty, upsertDroneHubMcpServer]);

  const handleDelete = React.useCallback(() => {
    if (!mcpDraft.id) return;
    const ok = window.confirm(`Delete ${mcpDraft.name.trim() || 'this MCP server'}?`);
    if (!ok) return;
    void deleteSelectedMcpServer();
  }, [deleteSelectedMcpServer, mcpDraft.id, mcpDraft.name]);

  const handleRegenerateToken = React.useCallback((tokenId: string, tokenName: string) => {
    const ok = window.confirm(`Regenerate ${tokenName}? Existing configs using the old token will stop working until updated.`);
    if (!ok) return;
    void regenerateMcpToken(tokenId);
  }, [regenerateMcpToken]);

  const handleRevokeToken = React.useCallback((tokenId: string, tokenName: string) => {
    const ok = window.confirm(`Revoke ${tokenName}? Agents using this token will lose Drone Hub MCP access.`);
    if (!ok) return;
    void revokeMcpToken(tokenId);
  }, [revokeMcpToken]);

  const formatTokenDate = React.useCallback((value?: string) => {
    if (!value) return 'Never';
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return value;
    return new Date(time).toLocaleString();
  }, []);

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
      <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
              Drone Hub MCP access
            </div>
            <div className="text-[11px] text-[var(--muted-dim)] mt-1 leading-relaxed">
              Named tokens identify host agents and container drones when they connect to Drone Hub over MCP.
            </div>
          </div>
          <button type="button" onClick={() => void loadMcpAccessTokens()} disabled={mcpAccessTokensLoading} className={buttonClassName('secondary', mcpAccessTokensLoading)} style={{ fontFamily: 'var(--display)' }}>
            {mcpAccessTokensLoading ? 'Refreshing...' : 'Refresh tokens'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">New host token name</span>
            <input value={mcpHostTokenName} onChange={(e) => setMcpHostTokenName(e.target.value)} className={inputClassName()} placeholder="host codex" />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void createHostMcpToken()} disabled={busy || !mcpHostTokenName.trim()} className={buttonClassName('primary', busy || !mcpHostTokenName.trim())} style={{ fontFamily: 'var(--display)' }}>
              {mcpAccessTokensSaving ? 'Saving...' : 'Generate token'}
            </button>
          </div>
        </div>

        {mcpTokenRevealValue && (
          <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[#34d399]" style={{ fontFamily: 'var(--display)' }}>
                New token value
              </div>
              <button type="button" onClick={clearMcpTokenRevealValue} className="text-[10px] uppercase tracking-wide text-[#34d399] opacity-80 hover:opacity-100">
                Hide
              </button>
            </div>
            <textarea readOnly value={mcpTokenRevealValue} className={`${textareaClassName()} min-h-[70px] font-mono text-[11px]`} />
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          {mcpAccessTokens.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-4 text-[11px] text-[var(--muted-dim)]">
              No MCP access tokens yet.
            </div>
          ) : (
            mcpAccessTokens.map((token) => {
              const revoked = Boolean(token.revokedAt);
              return (
                <div key={token.id} className={`rounded border px-3 py-3 flex flex-col gap-2 ${revoked ? 'border-[rgba(255,90,90,.2)] bg-[rgba(255,90,90,.04)]' : 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.10)]'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-[var(--fg-secondary)] truncate">{token.name}</div>
                      <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-1 truncate">{token.tokenPreview}</div>
                    </div>
                    <div className={`text-[9px] uppercase ${revoked ? 'text-[var(--red)]' : token.kind === 'drone' ? 'text-[var(--accent)]' : 'text-[#34d399]'}`}>
                      {revoked ? 'Revoked' : token.kind}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-[10px] text-[var(--muted-dim)]">
                    <div>Created {formatTokenDate(token.createdAt)}</div>
                    <div>Last used {formatTokenDate(token.lastUsedAt)}</div>
                    {token.droneId && <div className="md:col-span-2 font-mono truncate">Drone {token.droneId}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {token.kind === 'host' && (
                      <button type="button" onClick={() => handleRegenerateToken(token.id, token.name)} disabled={busy} className={buttonClassName('secondary', busy)} style={{ fontFamily: 'var(--display)' }}>
                        Regenerate
                      </button>
                    )}
                    <button type="button" onClick={() => handleRevokeToken(token.id, token.name)} disabled={busy || revoked} className={buttonClassName('danger', busy || revoked)} style={{ fontFamily: 'var(--display)' }}>
                      Revoke
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="text-[10px] text-[var(--muted-dim)]">
          Active identities: {activeTokens.length}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Global MCP servers
          </div>
          <div className="text-[11px] text-[var(--muted-dim)] mt-1 leading-relaxed">
            Drone Hub writes these into each drone's global agent config before Codex, Cursor, Claude, or OpenCode chats run.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleRefresh} disabled={mcpServersLoading} className={buttonClassName('secondary', mcpServersLoading)} style={{ fontFamily: 'var(--display)' }}>
            {mcpServersLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" onClick={handleAddDroneHub} disabled={busy} className={buttonClassName('secondary', busy)} style={{ fontFamily: 'var(--display)' }}>
            Add Drone Hub
          </button>
          <button type="button" onClick={handleNew} disabled={busy} className={buttonClassName('secondary', busy)} style={{ fontFamily: 'var(--display)' }}>
            New server
          </button>
          <button type="button" onClick={() => void saveMcpDraft()} disabled={busy} className={buttonClassName('primary', busy)} style={{ fontFamily: 'var(--display)' }}>
            {mcpServersSaving ? 'Saving...' : mcpDraft.id ? 'Save server' : 'Create server'}
          </button>
        </div>
      </div>

      {(mcpServersError || mcpServersNotice) && (
        <div className="flex flex-col gap-2">
          {mcpServersError && (
            <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)] flex items-center justify-between gap-3">
              <span>{mcpServersError}</span>
              <button type="button" onClick={clearMcpServersError} className="text-[10px] uppercase tracking-wide opacity-80 hover:opacity-100">
                Dismiss
              </button>
            </div>
          )}
          {mcpServersNotice && (
            <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399] flex items-center justify-between gap-3">
              <span>{mcpServersNotice}</span>
              <button type="button" onClick={clearMcpServersNotice} className="text-[10px] uppercase tracking-wide opacity-80 hover:opacity-100">
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-3 min-w-0">
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-2 flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Servers
            </div>
            <div className="text-[10px] text-[var(--muted-dim)]">{mcpServers.length}</div>
          </div>
          <div className="flex flex-col gap-1 max-h-[70vh] overflow-y-auto pr-1">
            {mcpServers.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-4 text-[11px] text-[var(--muted-dim)]">
                No global MCP servers yet.
              </div>
            ) : (
              mcpServers.map((server) => {
                const active = server.id === selectedMcpServerId;
                return (
                  <button
                    key={server.id}
                    type="button"
                    onClick={() => handleSelect(server.id)}
                    className={`w-full text-left rounded border px-3 py-2 transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[rgba(255,255,255,.05)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.01)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] text-[var(--fg-secondary)] font-medium truncate">{server.name}</div>
                      <div className={`text-[9px] uppercase ${server.enabled ? 'text-[#34d399]' : 'text-[var(--muted-dim)]'}`}>
                        {server.enabled ? 'On' : 'Off'}
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-1 truncate">{server.transport}</div>
                    <div className="text-[10px] text-[var(--muted-dim)] mt-2 line-clamp-2">
                      {server.description || server.command || server.url || 'No description'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-3 flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[var(--fg)] truncate">{mcpDraft.id ? mcpDraft.name || 'Untitled MCP server' : 'New MCP server draft'}</div>
              <div className="text-[10px] text-[var(--muted-dim)] mt-1">
                Projects to global user config only. Repo files are not changed.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={`text-[10px] uppercase tracking-[0.08em] ${mcpDraftDirty ? 'text-[var(--accent)]' : 'text-[var(--muted-dim)]'}`}>
                {mcpDraftDirty ? 'Unsaved changes' : 'Saved'}
              </div>
              <button type="button" onClick={resetMcpDraft} disabled={!mcpDraftDirty || busy} className={buttonClassName('secondary', !mcpDraftDirty || busy)} style={{ fontFamily: 'var(--display)' }}>
                Revert
              </button>
              <button type="button" onClick={handleDelete} disabled={!mcpDraft.id || busy} className={buttonClassName('danger', !mcpDraft.id || busy)} style={{ fontFamily: 'var(--display)' }}>
                {mcpServersDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Name</span>
              <input value={mcpDraft.name} onChange={(e) => updateMcpDraftField('name', e.target.value)} className={`${inputClassName()} font-mono`} placeholder="github" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Transport</span>
              <select value={mcpDraft.transport} onChange={(e) => updateMcpDraftField('transport', e.target.value === 'http' ? 'http' : 'stdio')} className={inputClassName()}>
                <option value="stdio">stdio command</option>
                <option value="http">HTTP URL</option>
              </select>
            </label>
            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Description</span>
              <input value={mcpDraft.description} onChange={(e) => updateMcpDraftField('description', e.target.value)} className={inputClassName()} placeholder="Short note for humans." />
            </label>
          </div>

          {mcpDraft.transport === 'stdio' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Command</span>
                <input value={mcpDraft.command} onChange={(e) => updateMcpDraftField('command', e.target.value)} className={`${inputClassName()} font-mono`} placeholder="npx" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Args</span>
                <textarea value={mcpDraft.argsText} onChange={(e) => updateMcpDraftField('argsText', e.target.value)} className={`${textareaClassName()} min-h-[90px]`} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/work/repo'} />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">URL</span>
              <input value={mcpDraft.url} onChange={(e) => updateMcpDraftField('url', e.target.value)} className={`${inputClassName()} font-mono`} placeholder="https://example.com/mcp" />
            </label>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Environment JSON</span>
              <textarea value={mcpDraft.envJson} onChange={(e) => updateMcpDraftField('envJson', e.target.value)} className={`${textareaClassName()} min-h-[110px]`} placeholder={'{\n  "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"\n}'} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Headers JSON</span>
              <textarea value={mcpDraft.headersJson} onChange={(e) => updateMcpDraftField('headersJson', e.target.value)} disabled={mcpDraft.transport !== 'http'} className={`${textareaClassName()} min-h-[110px] ${mcpDraft.transport !== 'http' ? 'opacity-40 cursor-not-allowed' : ''}`} placeholder={'{\n  "Authorization": "Bearer {env:GITHUB_TOKEN}"\n}'} />
            </label>
          </div>

          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Agents</div>
                <div className="text-[11px] text-[var(--muted-dim)] mt-1">
                  Pick which built-in agent configs receive this server.
                </div>
              </div>
              <button type="button" onClick={() => updateMcpDraftField('enabled', !mcpDraft.enabled)} className={buttonClassName('secondary')} style={{ fontFamily: 'var(--display)' }}>
                {mcpDraft.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {MCP_AGENT_OPTIONS.map((agent) => {
                const selected = mcpDraft.agents.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleMcpDraftAgent(agent.id)}
                    className={`h-9 rounded border px-3 text-[11px] font-semibold transition-colors ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    {agent.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
