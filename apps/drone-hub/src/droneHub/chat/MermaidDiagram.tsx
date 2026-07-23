import React from 'react';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';

type MermaidApi = (typeof import('mermaid'))['default'];

const MAX_MERMAID_SOURCE_LENGTH = 50_000;
const MAX_MERMAID_SOURCE_LINES = 1_000;

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidRenderSequence = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        darkMode: true,
        themeVariables: {
          background: '#181825',
          primaryColor: '#313244',
          primaryTextColor: '#cdd6f4',
          primaryBorderColor: '#6c7086',
          lineColor: '#9399b2',
          secondaryColor: '#45475a',
          secondaryTextColor: '#cdd6f4',
          secondaryBorderColor: '#7f849c',
          tertiaryColor: '#1e1e2e',
          tertiaryTextColor: '#cdd6f4',
          tertiaryBorderColor: '#585b70',
          noteBkgColor: '#313244',
          noteTextColor: '#cdd6f4',
          noteBorderColor: '#6c7086',
          fontFamily: 'inherit',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export function MermaidDiagram({ source }: { source: string }) {
  const reactId = React.useId();
  const diagramId = React.useMemo(
    () => `drone-hub-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId],
  );
  const [svg, setSvg] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const [showSource, setShowSource] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const renderId = `${diagramId}-${mermaidRenderSequence++}`;
    setSvg('');
    setErrorMessage('');
    setShowSource(false);

    if (
      source.length > MAX_MERMAID_SOURCE_LENGTH ||
      source.split('\n').length > MAX_MERMAID_SOURCE_LINES
    ) {
      setErrorMessage('This Mermaid diagram is too large to render.');
      return () => {
        active = false;
      };
    }

    void loadMermaid()
      .then((mermaid) => mermaid.render(renderId, source))
      .then((result) => {
        if (!active) return;
        setSvg(result.svg);
      })
      .catch(() => {
        if (!active) return;
        setErrorMessage('Could not render this Mermaid diagram. Check the syntax below.');
      });

    return () => {
      active = false;
    };
  }, [diagramId, source]);

  const sourceVisible = showSource || Boolean(errorMessage);

  return (
    <section
      data-markdown-code-block={true}
      className="dh-mermaid-card"
      aria-label="Mermaid diagram"
    >
      <div className="dh-mermaid-card__toolbar">
        <span className="dh-mermaid-card__label">Diagram</span>
        {errorMessage ? null : (
          <button
            type="button"
            className="dh-mermaid-card__source-toggle"
            aria-label={sourceVisible ? 'Show rendered diagram' : 'Show Mermaid source'}
            onClick={() => setShowSource((visible) => !visible)}
          >
            {sourceVisible ? 'Diagram' : 'Source'}
          </button>
        )}
      </div>
      {sourceVisible ? (
        <div className="dh-mermaid-card__source">
          <ChatMessageCopyAction text={source} position="code" copyLabel="diagram source" />
          {errorMessage ? (
            <div className="dh-mermaid-card__error" role="alert">
              {errorMessage}
            </div>
          ) : null}
          <pre>
            <code className="language-mermaid">{source}</code>
          </pre>
        </div>
      ) : svg ? (
        <div
          className="dh-mermaid-card__diagram"
          role="img"
          aria-label="Rendered Mermaid diagram"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="dh-mermaid-card__loading" role="status">
          Rendering diagram…
        </div>
      )}
    </section>
  );
}
