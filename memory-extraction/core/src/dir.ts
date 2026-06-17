import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { ArchiveReader } from "./sources/types";

/** ArchiveReader over a directory of loose files (e.g. a fixture dir, or an
 *  already-unzipped export). Same interface as the zip reader. */

async function walk(dir: string, base: string = dir): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name === ".DS_Store" || ent.name.startsWith("._")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

export function dirReader(dir: string, filename: string = path.basename(dir)): ArchiveReader {
  const resolve = async (match: (e: string) => boolean): Promise<string> => {
    const hit = (await walk(dir)).find(match);
    if (!hit) throw new Error(`no entry matched in ${dir}`);
    return hit;
  };
  return {
    filename,
    entries: () => walk(dir),
    async readText(match) {
      const hit = await resolve(match);
      return (await readFile(path.join(dir, hit), "utf8")).replace(/^﻿/, "");
    },
    async readStream(match) {
      const hit = await resolve(match);
      return createReadStream(path.join(dir, hit)) as Readable;
    },
  };
}
