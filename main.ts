// Porto Verde — the entry program for the make.fun GTA 6 bounty.
//
// What it does, in three steps:
//   1. Wipe the output folder and copy the playable game (game/) into it.
//   2. Copy the screenshots (screenshots/) alongside, when they exist.
//   3. Write dossier.json with the vendored make.fun library, which reads
//      back exactly what was copied and summarises it for the judge.
//
// Node 22, standard library only, no build step and no network. The
// grader runs this twice and expects identical bytes both times; every
// step here is deterministic (plain file copies plus the library's own
// canonical JSON writer), so the two runs match.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)));
const dest = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Start from a clean folder so a stale file from an earlier run can never
// leak into the entry.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// The game itself: static files, no build step.
cpSync(join(repo, 'game'), join(dest, 'game'), { recursive: true });

// The screenshots, when the repository has them.
const shots = join(repo, 'screenshots');
if (existsSync(shots)) {
  cpSync(shots, join(dest, 'screenshots'), { recursive: true });
}

// The dossier, built from what was just copied — never from the source
// tree, so the file the scorer re-derives is the one we wrote.
writeFileSync(
  join(dest, 'dossier.json'),
  buildDossier(dest, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`entry written to ${dest}`);
