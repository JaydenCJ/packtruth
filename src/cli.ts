#!/usr/bin/env node
/**
 * CLI entry point. All file/stdin I/O lives here; everything below it is
 * pure and unit-testable. Exit codes: 0 clean (at the --fail-on
 * threshold), 1 divergence found, 2 usage or input error.
 */

import { readFileSync } from "node:fs";
import { parseArgs, UsageError, USAGE, type CliOptions } from "./cliargs.js";
import { failsAt, runCheck, type CheckOptions } from "./check.js";
import { ManifestError } from "./manifest.js";
import { extractManifestText, TarballError } from "./tarball.js";
import { renderFields, renderJson, renderText } from "./report.js";
import { VERSION } from "./version.js";

/** Read a document from a path or stdin (`-`). */
function readText(path: string): string {
  try {
    return readFileSync(path === "-" ? 0 : path, "utf8");
  } catch (err) {
    throw new UsageError(`cannot read ${path === "-" ? "stdin" : path}: ${(err as Error).message}`);
  }
}

function readBytes(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (err) {
    throw new UsageError(`cannot read ${path}: ${(err as Error).message}`);
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${label} is not valid JSON: ${(err as Error).message}`);
  }
}

function commandCheck(opts: CliOptions): number {
  const tarballPath = opts.tarball as string;
  const manifestPath = opts.manifest as string;
  const registryDoc = parseJson(readText(manifestPath), manifestPath === "-" ? "stdin" : manifestPath);
  const tarballRaw = readBytes(tarballPath);

  const checkOptions: CheckOptions = {
    ignore: opts.ignore,
    noIntegrity: opts.noIntegrity,
    manifestLabel: manifestPath === "-" ? "stdin" : manifestPath,
    tarballLabel: tarballPath,
  };
  if (opts.registryVersion !== undefined) checkOptions.registryVersion = opts.registryVersion;
  const report = runCheck(registryDoc, tarballRaw, checkOptions);

  if (!opts.quiet) {
    process.stdout.write(opts.format === "json" ? renderJson(report) : renderText(report));
  }
  return failsAt(report, opts.failOn) ? 1 : 0;
}

function commandExtract(opts: CliOptions): number {
  const raw = readBytes(opts.tarball as string);
  const { text } = extractManifestText(raw);
  if (opts.pretty) {
    const parsed = parseJson(text, "embedded package.json");
    process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
  } else {
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
  }
  return 0;
}

export function main(argv: string[]): number {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`packtruth: ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  try {
    switch (opts.command) {
      case "help":
        process.stdout.write(USAGE + "\n");
        return 0;
      case "version":
        process.stdout.write(VERSION + "\n");
        return 0;
      case "fields":
        process.stdout.write(renderFields(opts.json));
        return 0;
      case "extract":
        return commandExtract(opts);
      case "check":
        return commandCheck(opts);
    }
  } catch (err) {
    if (err instanceof UsageError || err instanceof TarballError || err instanceof ManifestError) {
      process.stderr.write(`packtruth: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

process.exit(main(process.argv.slice(2)));
