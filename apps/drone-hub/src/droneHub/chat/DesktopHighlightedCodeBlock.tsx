import React from 'react';
import { highlightDesktopCodeFence } from './desktop-syntax-highlighting';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { MermaidDiagram } from './MermaidDiagram';

export function DesktopHighlightedCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const isMermaid = language.trim().toLowerCase() === 'mermaid';
  const result = React.useMemo(
    () => (isMermaid ? null : highlightDesktopCodeFence(code, language)),
    [code, isMermaid, language],
  );
  if (isMermaid) {
    return <MermaidDiagram source={code} />;
  }

  const highlighted = result!;
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
          <code className={highlighted.language ? `language-${highlighted.language}` : undefined}>
            {highlighted.tokens.map((token, index) => (
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
