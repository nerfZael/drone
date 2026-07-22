import React from 'react';
import { highlightDesktopCodeFence } from './desktop-syntax-highlighting';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';

export function DesktopHighlightedCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const result = React.useMemo(
    () => highlightDesktopCodeFence(code, language),
    [code, language],
  );
  const languageLabel = language.trim() || 'plain text';
  return (
    <section
      data-markdown-code-block={true}
      className="dh-code-card group/code-block"
      aria-label={`${languageLabel} code block`}
    >
      <ChatMessageCopyAction text={code} position="code" copyLabel="code" />
      <div className="dh-code-card__scroll" tabIndex={0}>
        <pre>
          <code className={result.language ? `language-${result.language}` : undefined}>
            {result.tokens.map((token, index) => (
              <span
                key={`${index}:${token.text.length}`}
                className={token.types.length > 0 ? `token ${token.types.join(' ')}` : undefined}
              >
                {token.text}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </section>
  );
}
