import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, ".pages");

const publicFiles = [
  "index.html",
  "leaderboard.html",
  "favicon.svg",
  "styles.css",
  "config.js",
  "questions.js",
  "app.js",
  "leaderboard.js",
];

const publicDirectories = ["assets", "vendor"];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const file of publicFiles) {
  await cp(path.join(projectRoot, file), path.join(outputRoot, file));
}

for (const directory of publicDirectories) {
  const source = path.join(projectRoot, directory);
  try {
    await cp(source, path.join(outputRoot, directory), { recursive: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await writeFile(path.join(outputRoot, ".nojekyll"), "", "utf8");
process.stdout.write(`Prepared GitHub Pages artifact at ${outputRoot}\n`);
