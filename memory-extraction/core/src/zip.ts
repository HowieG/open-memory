import { Readable } from "node:stream";
import yauzl from "yauzl";
import type { ArchiveReader } from "./sources/types";

/**
 * yauzl-backed read-in-place archive access.
 *
 * yauzl reads the zip's central directory (from the end, as the format intends),
 * so we can pull a single small JSON entry out of a multi-hundred-MB archive
 * without extracting anything to disk. No extraction => no temp-dir cleanup,
 * no disk doubling, no Zip Slip surface.
 */

const isJunk = (path: string): boolean =>
  path.startsWith("__MACOSX/") || path.endsWith("/") || path.split("/").pop()!.startsWith("._");

function open(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("failed to open zip"));
      resolve(zip);
    });
  });
}

export function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    open(zipPath).then((zip) => {
      const out: string[] = [];
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!isJunk(entry.fileName)) out.push(entry.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolve(out));
      zip.on("error", reject);
      zip.readEntry();
    }, reject);
  });
}

/** Returns a stream of the first non-junk entry matching `match`, or rejects if none. */
export function readZipEntryStream(
  zipPath: string,
  match: (entryPath: string) => boolean,
): Promise<Readable> {
  return new Promise((resolve, reject) => {
    open(zipPath).then((zip) => {
      let found = false;
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!found && !isJunk(entry.fileName) && match(entry.fileName)) {
          found = true;
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) return reject(err ?? new Error("failed to open entry stream"));
            stream.on("end", () => zip.close());
            resolve(stream);
          });
          return; // stop advancing; caller drains the stream
        }
        zip.readEntry();
      });
      zip.on("end", () => {
        if (!found) reject(new Error(`no entry matched in ${zipPath}`));
      });
      zip.on("error", reject);
      zip.readEntry();
    }, reject);
  });
}

export async function readZipEntryText(
  zipPath: string,
  match: (entryPath: string) => boolean,
): Promise<string> {
  const stream = await readZipEntryStream(zipPath, match);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
}

/** Build an ArchiveReader over a zip file on disk. */
export function zipReader(zipPath: string, filename: string): ArchiveReader {
  return {
    filename,
    entries: () => listZipEntries(zipPath),
    readText: (match) => readZipEntryText(zipPath, match),
    readStream: (match) => readZipEntryStream(zipPath, match),
  };
}
