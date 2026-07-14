/**
 * A minimal, dependency-free tar reader — just enough of POSIX ustar,
 * pax extended headers, and GNU long names to read every npm tarball in
 * the wild. It never writes, never touches the filesystem, and validates
 * header checksums so corrupt input fails loudly instead of yielding
 * garbage entries.
 */

const BLOCK = 512;

/** Raised for anything that stops the archive from being read safely. */
export class TarError extends Error {
  override name = "TarError";
}

/** One regular file (or other object) inside the archive. */
export interface TarEntry {
  /** Full path as recorded (pax/GNU overrides already applied). */
  path: string;
  /** Payload size in bytes. */
  size: number;
  /** Raw typeflag: "0" file, "5" dir, "2" symlink, … */
  type: string;
  /** File payload. Empty buffer for non-file entries. */
  data: Buffer;
}

/** Read a NUL-terminated string field. */
function cstr(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  let end = slice.length;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) {
      end = i;
      break;
    }
  }
  return slice.subarray(0, end).toString("utf8");
}

/**
 * Parse a tar numeric field: octal ASCII, or GNU base-256 when the top
 * bit of the first byte is set (used for entries larger than 8 GiB).
 */
function parseNumeric(buf: Buffer, offset: number, length: number): number {
  const first = buf[offset];
  if (first !== undefined && (first & 0x80) !== 0) {
    // Base-256: big-endian, top bit of the first byte is the marker.
    let value = (first & 0x7f) as number;
    for (let i = 1; i < length; i++) {
      value = value * 256 + (buf[offset + i] as number);
    }
    return value;
  }
  const text = cstr(buf, offset, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw new TarError(`invalid numeric field at offset ${offset}: ${JSON.stringify(text)}`);
  }
  return parseInt(text, 8);
}

/** Sum of header bytes with the checksum field treated as spaces. */
function computeChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : (header[i] as number);
  }
  return sum;
}

/** True when the 512-byte block is entirely NUL (end-of-archive marker). */
function isZeroBlock(buf: Buffer, offset: number): boolean {
  for (let i = 0; i < BLOCK; i++) {
    if (buf[offset + i] !== 0) return false;
  }
  return true;
}

/**
 * Parse pax extended-header records: `"<len> <key>=<value>\n"` repeated.
 * Returns only the keys we honor; unknown keys are ignored per spec.
 */
export function parsePaxRecords(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    let space = -1;
    for (let i = offset; i < Math.min(offset + 20, data.length); i++) {
      if (data[i] === 0x20) {
        space = i;
        break;
      }
    }
    if (space === -1) throw new TarError("malformed pax record: missing length");
    const len = parseInt(data.subarray(offset, space).toString("utf8"), 10);
    if (!Number.isInteger(len) || len <= space - offset + 1 || offset + len > data.length) {
      throw new TarError("malformed pax record: bad length");
    }
    const record = data.subarray(space + 1, offset + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq === -1) throw new TarError("malformed pax record: missing '='");
    out.set(record.slice(0, eq), record.slice(eq + 1));
    offset += len;
  }
  return out;
}

/**
 * List every entry in a (already-decompressed) tar archive.
 * Tolerates a missing end-of-archive marker (some writers truncate it)
 * but rejects corrupt headers and payloads that run past the buffer.
 */
export function listTarEntries(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let nextPath: string | null = null; // from pax `path` or GNU "L"
  let globalPax: Map<string, string> = new Map();

  while (offset + BLOCK <= archive.length) {
    if (isZeroBlock(archive, offset)) break; // end-of-archive marker
    const header = archive.subarray(offset, offset + BLOCK);
    const stored = parseNumeric(header, 148, 8);
    if (stored !== computeChecksum(header)) {
      throw new TarError(`corrupt tar header at offset ${offset}: checksum mismatch`);
    }

    const size = parseNumeric(header, 124, 12);
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156] as number);
    const dataStart = offset + BLOCK;
    if (dataStart + size > archive.length) {
      throw new TarError(`truncated archive: entry at offset ${offset} claims ${size} bytes`);
    }
    const data = archive.subarray(dataStart, dataStart + size);

    if (type === "x") {
      // pax extended header for the NEXT entry.
      const pax = parsePaxRecords(data);
      const p = pax.get("path");
      if (p !== undefined) nextPath = p;
    } else if (type === "g") {
      // pax global header: applies to all subsequent entries.
      globalPax = parsePaxRecords(data);
    } else if (type === "L") {
      // GNU long name for the NEXT entry (NUL-terminated payload).
      nextPath = cstr(data, 0, data.length);
    } else if (type === "K") {
      // GNU long linkname: irrelevant for our use, consume and move on.
    } else {
      let path: string;
      if (nextPath !== null) {
        path = nextPath;
      } else {
        const name = cstr(header, 0, 100);
        const magic = cstr(header, 257, 6);
        const prefix = magic === "ustar" ? cstr(header, 345, 155) : "";
        path = prefix !== "" ? `${prefix}/${name}` : name;
        const globalPath = globalPax.get("path");
        if (globalPath !== undefined) path = globalPath;
      }
      nextPath = null;
      entries.push({ path, size, type, data: type === "0" ? Buffer.from(data) : Buffer.alloc(0) });
    }

    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  if (entries.length === 0) {
    throw new TarError("archive contains no entries");
  }
  return entries;
}
