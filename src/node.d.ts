/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

interface MinimalBuffer {
  readonly length: number;
  [index: number]: number | undefined;
  subarray(start?: number, end?: number): MinimalBuffer;
  toString(encoding?: "utf8" | "base64" | "hex"): string;
}

declare var Buffer: {
  from(data: MinimalBuffer | string, encoding?: "utf8"): MinimalBuffer;
  alloc(size: number): MinimalBuffer;
};

type Buffer = MinimalBuffer;

declare module "node:fs" {
  export function readFileSync(path: string | number): Buffer;
  export function readFileSync(path: string | number, encoding: "utf8"): string;
}

declare module "node:zlib" {
  export function gunzipSync(data: Buffer): Buffer;
}

declare module "node:crypto" {
  interface Hash {
    update(data: Buffer | string): Hash;
    digest(encoding: "hex" | "base64"): string;
  }
  export function createHash(algorithm: "sha1" | "sha256" | "sha512"): Hash;
}

declare var process: {
  argv: string[];
  exit(code?: number): never;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
};
