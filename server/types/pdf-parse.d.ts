declare module 'pdf-parse' {
  interface PDFParseResult {
    text: string;
    total: number;
  }

  interface PDFParseInstance {
    getText(): Promise<PDFParseResult>;
    destroy(): Promise<void>;
  }

  interface PDFParseConstructor {
    new (options: { data: Buffer }): PDFParseInstance;
  }

  const PDFParse: PDFParseConstructor;
  export default PDFParse;
  export { PDFParse, PDFParseConstructor, PDFParseInstance, PDFParseResult };
}
