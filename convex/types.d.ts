// pdf-parse ships no types and its index entrypoint reads a bundled test fixture,
// so the library entrypoint is imported directly.
declare module 'pdf-parse/lib/pdf-parse.js' {
  const pdfParse: (
    data: Buffer,
    options?: Record<string, unknown>,
  ) => Promise<{ text: string; numpages: number; info: unknown; metadata: unknown; version: string }>;
  export default pdfParse;
}
