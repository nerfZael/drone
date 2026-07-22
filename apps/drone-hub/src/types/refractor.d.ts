declare module 'refractor' {
  const refractor: {
    highlight(value: string, language: string): unknown;
  };
  export default refractor;
}

declare module 'refractor/core.js' {
  type Grammar = ((refractor: unknown) => void) & {
    displayName: string;
    aliases?: string[];
  };

  const refractor: {
    highlight(value: string, language: string): unknown[];
    register(grammar: Grammar): void;
  };
  export default refractor;
}

declare module 'refractor/lang/*.js' {
  type Grammar = ((refractor: unknown) => void) & {
    displayName: string;
    aliases?: string[];
  };

  const grammar: Grammar;
  export default grammar;
}
