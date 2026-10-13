// The measurement test writes a report file when asked to; the project does not otherwise depend on Node typings.
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
}
declare const process: { env: Record<string, string | undefined> };
