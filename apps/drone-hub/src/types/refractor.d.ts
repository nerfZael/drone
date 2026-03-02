declare module 'refractor' {
  type RefractorNode = unknown;
  const refractor: {
    highlight: (value: string, language: string) => RefractorNode;
  };
  export default refractor;
}
