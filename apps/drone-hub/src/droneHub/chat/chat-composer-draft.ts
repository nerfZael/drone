export type ChatComposerDraftSnapshot<TAttachment> = {
  prompt: string;
  attachments: TAttachment[];
  revision: number;
};

type MutableValue<T> = {
  current: T;
};

export function takeChatComposerDraftSnapshot<TAttachment>(input: {
  draft: MutableValue<string>;
  attachments: MutableValue<TAttachment[]>;
  revision: MutableValue<number>;
}): ChatComposerDraftSnapshot<TAttachment> | null {
  const prompt = input.draft.current.trim();
  const attachments = input.attachments.current.slice();
  if (!prompt && attachments.length === 0) return null;

  input.draft.current = '';
  input.attachments.current = [];
  return { prompt, attachments, revision: input.revision.current };
}

export function restoreChatComposerDraftSnapshot<TAttachment>(input: {
  draft: MutableValue<string>;
  attachments: MutableValue<TAttachment[]>;
  revision: MutableValue<number>;
  snapshot: ChatComposerDraftSnapshot<TAttachment>;
}): { draftRestored: boolean; attachmentsRestored: boolean } {
  const revisionMatches = input.revision.current === input.snapshot.revision;
  const draftRestored = revisionMatches && input.draft.current.trim().length === 0;
  const attachmentsRestored = revisionMatches && input.attachments.current.length === 0;
  if (draftRestored) input.draft.current = input.snapshot.prompt;
  if (attachmentsRestored) input.attachments.current = input.snapshot.attachments;
  return { draftRestored, attachmentsRestored };
}
