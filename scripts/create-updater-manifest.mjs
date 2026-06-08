import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const repo = process.argv[2];

if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  console.error("Usage: node scripts/create-updater-manifest.mjs owner/repo");
  process.exit(1);
}

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const artifactName = `Google Todo_${version}_x64-setup.exe`;
const bundleDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const signaturePath = join(bundleDir, `${artifactName}.sig`);
const manifestPath = join(bundleDir, "latest.json");
const signature = (await readFile(signaturePath, "utf8")).trim();
const publishedAt = new Date().toISOString();

const manifest = {
  version,
  notes: `Google Todo ${version}`,
  pub_date: publishedAt,
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(
        artifactName,
      )}`,
    },
  },
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifestPath}`);
