/**
 * Argument parsing for the packtruth CLI. Strict by design: unknown
 * flags, missing values and conflicting options are hard usage errors
 * (exit 2), never silently ignored.
 */

import { SEVERITIES, type Severity } from "./types.js";

/** Raised for anything the user typed wrong; the CLI maps it to exit 2. */
export class UsageError extends Error {
  override name = "UsageError";
}

export const USAGE = `packtruth — detect manifest confusion between an npm registry manifest and the package.json inside the tarball

Usage:
  packtruth check <tarball.tgz> --manifest <file|-> [options]
  packtruth extract <tarball.tgz> [--pretty]
  packtruth fields [--json]
  packtruth -h|--help | -V|--version

check options:
  -m, --manifest <file|->        registry document: version manifest or packument ("-" = stdin)
      --registry-version <v>     pick this version out of a packument (default: the tarball's)
  -f, --format <text|json>       report format (default: text)
      --fail-on <severity|never> exit 1 at/above this severity (default: low; "never" always exits 0)
      --ignore <field>           skip a field; repeatable (e.g. --ignore devDependencies)
      --no-integrity             skip dist.integrity / dist.shasum verification
  -q, --quiet                    print nothing; communicate via exit code only

extract options:
      --pretty                   re-indent the embedded package.json (default: exact bytes)

Exit codes: 0 no divergence at/above --fail-on · 1 divergence found · 2 usage or input error

Obtaining inputs: "npm pack <pkg>" saves the tarball, and
"npm view <pkg> --json > manifest.json" saves the registry document.
packtruth itself never touches the network.`;

export type Command = "check" | "extract" | "fields" | "help" | "version";

export interface CliOptions {
  command: Command;
  tarball?: string;
  manifest?: string;
  registryVersion?: string;
  format: "text" | "json";
  failOn: Severity | "never";
  ignore: string[];
  noIntegrity: boolean;
  quiet: boolean;
  pretty: boolean;
  json: boolean;
}

function defaults(command: Command): CliOptions {
  return {
    command,
    format: "text",
    failOn: "low",
    ignore: [],
    noIntegrity: false,
    quiet: false,
    pretty: false,
    json: false,
  };
}

/** Take the value for a value-carrying flag. */
function takeValue(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined) throw new UsageError(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) return defaults("help");
  if (argv.includes("--version") || argv.includes("-V")) return defaults("version");
  const [first, ...rest] = argv;
  if (first === undefined) throw new UsageError("missing command (try --help)");

  let command: Command;
  let args: string[];
  if (first === "check" || first === "extract" || first === "fields") {
    command = first;
    args = rest;
  } else if (first.startsWith("-")) {
    throw new UsageError(`unknown option: ${first}`);
  } else {
    // Bare tarball path implies `check`.
    command = "check";
    args = argv;
  }

  const opts = defaults(command);
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    switch (arg) {
      case "-m":
      case "--manifest":
        opts.manifest = takeValue(args, i, arg);
        i++;
        break;
      case "--registry-version":
        opts.registryVersion = takeValue(args, i, arg);
        i++;
        break;
      case "-f":
      case "--format": {
        const value = takeValue(args, i, arg);
        if (value !== "text" && value !== "json") {
          throw new UsageError(`--format must be one of: text, json (got ${JSON.stringify(value)})`);
        }
        opts.format = value;
        i++;
        break;
      }
      case "--fail-on": {
        const value = takeValue(args, i, arg);
        if (value !== "never" && !(SEVERITIES as readonly string[]).includes(value)) {
          throw new UsageError(`--fail-on must be one of: ${SEVERITIES.join(", ")}, never`);
        }
        opts.failOn = value as Severity | "never";
        i++;
        break;
      }
      case "--ignore":
        opts.ignore.push(takeValue(args, i, arg));
        i++;
        break;
      case "--no-integrity":
        opts.noIntegrity = true;
        break;
      case "-q":
      case "--quiet":
        opts.quiet = true;
        break;
      case "--pretty":
        opts.pretty = true;
        break;
      case "--json":
        opts.json = true;
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option: ${arg}`);
        positionals.push(arg);
    }
  }

  // Per-command validation of positionals and flags.
  if (command === "check") {
    if (positionals.length === 0) throw new UsageError("check needs a tarball path");
    if (positionals.length > 1) throw new UsageError(`unexpected argument: ${positionals[1]}`);
    if (opts.manifest === undefined) throw new UsageError("check needs --manifest <file|->");
    if (opts.pretty) throw new UsageError("--pretty only applies to extract");
    if (opts.json) throw new UsageError("use --format json for check (--json is for fields)");
    opts.tarball = positionals[0] as string;
  } else if (command === "extract") {
    if (positionals.length === 0) throw new UsageError("extract needs a tarball path");
    if (positionals.length > 1) throw new UsageError(`unexpected argument: ${positionals[1]}`);
    forbidCheckFlags(opts, "extract");
    if (opts.json) throw new UsageError("--json is for fields; extract prints the manifest itself");
    opts.tarball = positionals[0] as string;
  } else if (command === "fields") {
    if (positionals.length > 0) throw new UsageError("fields takes no positional arguments");
    forbidCheckFlags(opts, "fields");
    if (opts.pretty) throw new UsageError("--pretty only applies to extract");
  }
  return opts;
}

function forbidCheckFlags(opts: CliOptions, command: string): void {
  if (opts.manifest !== undefined) throw new UsageError(`--manifest only applies to check, not ${command}`);
  if (opts.registryVersion !== undefined) {
    throw new UsageError(`--registry-version only applies to check, not ${command}`);
  }
  if (opts.ignore.length > 0) throw new UsageError(`--ignore only applies to check, not ${command}`);
  if (opts.noIntegrity) throw new UsageError(`--no-integrity only applies to check, not ${command}`);
  if (opts.format !== "text") throw new UsageError(`--format only applies to check, not ${command}`);
  if (opts.failOn !== "low") throw new UsageError(`--fail-on only applies to check, not ${command}`);
  if (opts.quiet) throw new UsageError(`--quiet only applies to check, not ${command}`);
}
