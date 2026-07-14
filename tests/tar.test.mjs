// Tar reader: ustar parsing, pax/GNU long-name overrides, base-256
// sizes, and — most importantly — loud failures on corrupt or truncated
// archives, because a scanner that silently misreads its input is worse
// than none.
import test from "node:test";
import assert from "node:assert/strict";

import { listTarEntries, parsePaxRecords, TarError } from "../dist/tar.js";
import { makeTar, paxEntry, tarEntry } from "./helpers.mjs";

test("reads a plain ustar file entry with its payload", () => {
  const archive = makeTar([tarEntry("package/package.json", '{"name":"a"}')]);
  const entries = listTarEntries(archive);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, "package/package.json");
  assert.equal(entries[0].type, "0");
  assert.equal(entries[0].data.toString("utf8"), '{"name":"a"}');
});

test("reads multiple entries in order, including multi-block and empty payloads", () => {
  const archive = makeTar([
    tarEntry("package/a.js", "aaa"),
    tarEntry("package/b.js", "b".repeat(600)), // spans two data blocks
    tarEntry("package/c.js", ""),
  ]);
  const entries = listTarEntries(archive);
  assert.deepEqual(
    entries.map((e) => e.path),
    ["package/a.js", "package/b.js", "package/c.js"],
  );
  assert.equal(entries[1].data.length, 600);
  assert.equal(entries[2].data.length, 0);
});

test("joins the ustar prefix field and lists directories with their typeflag", () => {
  const archive = makeTar([
    tarEntry("package.json", "{}", { prefix: "package" }),
    tarEntry("package/", "", { type: "5" }),
  ]);
  const entries = listTarEntries(archive);
  assert.equal(entries[0].path, "package/package.json");
  assert.equal(entries[1].type, "5");
  assert.equal(entries[1].data.length, 0);
});

test("pax extended header overrides exactly one following entry's path", () => {
  const longPath = "package/" + "deeply/".repeat(20) + "package.json";
  const archive = makeTar([
    paxEntry({ path: longPath }),
    tarEntry("package/PaxTrunc", "{}"),
    tarEntry("package/second.js", "x"),
  ]);
  const entries = listTarEntries(archive);
  assert.equal(entries[0].path, longPath);
  assert.equal(entries[1].path, "package/second.js"); // override consumed
});

test("GNU 'L' long-name entry names the following entry", () => {
  const longPath = "package/" + "x".repeat(150) + ".js";
  const archive = makeTar([tarEntry("././@LongLink", longPath + "\0", { type: "L" }), tarEntry("stub", "y")]);
  const entries = listTarEntries(archive);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, longPath);
});

test("base-256 size fields are decoded", () => {
  const archive = makeTar([tarEntry("package/big.bin", "z".repeat(1000), { base256Size: true })]);
  const entries = listTarEntries(archive);
  assert.equal(entries[0].size, 1000);
  assert.equal(entries[0].data.length, 1000);
});

test("end-of-archive handling: stops at the zero-block marker, tolerates its absence", () => {
  // Trailing garbage after the marker must not be parsed as entries.
  const withGarbage = Buffer.concat([makeTar([tarEntry("package/a", "1")]), Buffer.from("garbage-after-eof")]);
  assert.equal(listTarEntries(withGarbage).length, 1);
  // Some writers truncate the marker entirely; the entry still reads.
  assert.equal(listTarEntries(tarEntry("package/a", "1")).length, 1);
});

test("corrupt input fails loudly: bad checksum, truncation, emptiness, bad numerics", () => {
  const badChecksum = makeTar([tarEntry("package/a", "1", { corruptChecksum: true })]);
  assert.throws(() => listTarEntries(badChecksum), TarError);
  assert.throws(() => listTarEntries(badChecksum), /checksum mismatch/);

  const full = tarEntry("package/a", "x".repeat(600));
  assert.throws(() => listTarEntries(full.subarray(0, 512 + 100)), /truncated archive/);

  assert.throws(() => listTarEntries(Buffer.alloc(1024)), /no entries/);

  const entry = tarEntry("package/a", "x");
  entry.write("not-octal!! ", 124); // clobber the size field
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : entry[i];
  entry.write(sum.toString(8).padStart(6, "0") + "\0 ", 148); // re-seal checksum
  assert.throws(() => listTarEntries(makeTar([entry])), /invalid numeric field/);
});

test("parsePaxRecords decodes multiple records and rejects malformed input", () => {
  const records = parsePaxRecords(Buffer.from("14 path=a/b/c\n18 mtime=123.4567\n"));
  assert.equal(records.get("path"), "a/b/c");
  assert.equal(records.get("mtime"), "123.4567");
  assert.throws(() => parsePaxRecords(Buffer.from("999 path=a\n")), /bad length/);
  assert.throws(() => parsePaxRecords(Buffer.from("nolength\n")), TarError);
});
