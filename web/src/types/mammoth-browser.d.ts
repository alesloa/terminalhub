// mammoth ships a prebuilt browser bundle at this subpath (no Node deps); the package's own types
// only cover the Node entry, so declare the slice we use here.
declare module "mammoth/mammoth.browser.js" {
  interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  interface MammothInput {
    arrayBuffer: ArrayBuffer;
  }
  const mammoth: {
    convertToHtml(input: MammothInput, options?: Record<string, unknown>): Promise<MammothResult>;
    extractRawText(input: MammothInput): Promise<MammothResult>;
  };
  export default mammoth;
}
