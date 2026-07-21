declare module 'refractor/core.js' {
  type Grammar = ((refractor: Refractor) => void) & {
    displayName: string;
    aliases?: string[];
  };

  type Refractor = {
    highlight(value: string, language: string): unknown[];
    register(grammar: Grammar): void;
  };

  const refractor: Refractor;
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
