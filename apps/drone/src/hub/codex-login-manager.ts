type CodexOAuthCredentials = {
  access: string;
  refresh: string;
  expires: number;
  accountId?: unknown;
  idToken?: unknown;
};

type CodexOAuthLogin = (options: {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (prompt: { message: string }) => Promise<string>;
  onManualCodeInput: () => Promise<string>;
  originator: string;
}) => Promise<CodexOAuthCredentials>;

export type CodexLoginStatus = {
  ok: true;
  status: 'idle' | 'starting' | 'waiting' | 'finishing' | 'connected' | 'error';
  authorizationUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

type ActiveLogin = {
  sequence: number;
  phase: 'authorizing' | 'installing';
  cancel: (error: Error) => void;
  resolveStart: (status: CodexLoginStatus) => void;
  rejectStart: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const LOGIN_TIMEOUT_MS = 10 * 60_000;

function cleanCredential(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function codexAuthJsonFromOAuthCredentials(
  credentials: CodexOAuthCredentials,
  refreshedAt = new Date().toISOString(),
): string {
  const accessToken = cleanCredential(credentials.access);
  const refreshToken = cleanCredential(credentials.refresh);
  const accountId = cleanCredential(credentials.accountId);
  const idToken = cleanCredential(credentials.idToken);
  if (!accessToken || !refreshToken || !accountId)
    throw new Error('OpenAI returned incomplete Codex credentials.');
  return JSON.stringify(
    {
      auth_mode: 'chatgpt',
      tokens: {
        ...(idToken ? { id_token: idToken } : {}),
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: accountId,
      },
      last_refresh: refreshedAt,
    },
    null,
    2,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCodexLoginManager(deps: {
  login: CodexOAuthLogin;
  installAuthJson: (authJson: string) => Promise<void>;
  now?: () => Date;
  loginTimeoutMs?: number;
}) {
  const now = deps.now ?? (() => new Date());
  const loginTimeoutMs = Math.max(1, deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS);
  let sequence = 0;
  let active: ActiveLogin | null = null;
  let state: CodexLoginStatus = {
    ok: true,
    status: 'idle',
    authorizationUrl: null,
    startedAt: null,
    completedAt: null,
    error: null,
  };

  const snapshot = (): CodexLoginStatus => ({ ...state });

  const cancel = () => {
    const current = active;
    if (current?.phase === 'installing') return snapshot();
    active = null;
    sequence += 1;
    if (current) {
      clearTimeout(current.timeout);
      current.cancel(new Error('Codex sign-in cancelled.'));
    }
    state = {
      ok: true,
      status: 'idle',
      authorizationUrl: null,
      startedAt: null,
      completedAt: null,
      error: null,
    };
    current?.resolveStart(snapshot());
    return snapshot();
  };

  const start = async (): Promise<CodexLoginStatus> => {
    if (active) return snapshot();

    const loginSequence = ++sequence;
    const startedAt = now().toISOString();
    let rejectManualInput!: (error: Error) => void;
    const manualInput = new Promise<string>((_resolve, reject) => {
      rejectManualInput = reject;
    });
    // Cancellation can happen before the OAuth helper starts awaiting this promise.
    // Mark it handled immediately while still returning the original rejection to the helper.
    void manualInput.catch(() => {});
    let resolveReady!: (status: CodexLoginStatus) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<CodexLoginStatus>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const timeout = setTimeout(() => {
      if (active?.sequence !== loginSequence) return;
      const error = new Error('Codex sign-in timed out. Start a new sign-in and try again.');
      const current = active;
      active = null;
      sequence += 1;
      state = {
        ...state,
        status: 'error',
        authorizationUrl: null,
        completedAt: now().toISOString(),
        error: error.message,
      };
      current.cancel(error);
      current.rejectStart(error);
    }, loginTimeoutMs);
    timeout.unref?.();
    active = {
      sequence: loginSequence,
      phase: 'authorizing',
      cancel: rejectManualInput,
      resolveStart: resolveReady,
      rejectStart: rejectReady,
      timeout,
    };
    state = {
      ok: true,
      status: 'starting',
      authorizationUrl: null,
      startedAt,
      completedAt: null,
      error: null,
    };

    void deps
      .login({
        originator: 'drone-hub',
        onAuth: (info) => {
          if (active?.sequence !== loginSequence) return;
          state = {
            ...state,
            status: 'waiting',
            authorizationUrl: info.url,
          };
          resolveReady(snapshot());
        },
        onPrompt: async () => {
          throw new Error(
            'The automatic localhost callback is unavailable. Close other Codex sign-ins and try again.',
          );
        },
        onManualCodeInput: () => manualInput,
      })
      .then(async (credentials) => {
        if (active?.sequence !== loginSequence) return;
        clearTimeout(active.timeout);
        active.phase = 'installing';
        state = {
          ...state,
          status: 'finishing',
          authorizationUrl: null,
        };
        await deps.installAuthJson(
          codexAuthJsonFromOAuthCredentials(credentials, now().toISOString()),
        );
        if (active?.sequence !== loginSequence) return;
        clearTimeout(active.timeout);
        active = null;
        state = {
          ...state,
          status: 'connected',
          authorizationUrl: null,
          completedAt: now().toISOString(),
          error: null,
        };
        resolveReady(snapshot());
      })
      .catch((error) => {
        if (active?.sequence !== loginSequence) return;
        clearTimeout(active.timeout);
        active = null;
        state = {
          ...state,
          status: 'error',
          authorizationUrl: null,
          completedAt: now().toISOString(),
          error: errorMessage(error),
        };
        rejectReady(error instanceof Error ? error : new Error(String(error)));
      });

    return await ready;
  };

  return {
    start,
    status: snapshot,
    cancel,
  };
}

export type CodexLoginManager = ReturnType<typeof createCodexLoginManager>;
