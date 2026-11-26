#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const STAGE_DIR = path.join(REPO_ROOT, ".npm-stage");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function assertExists(filePath, hint) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Missing required artifact at ${filePath}. ${hint}`);
  }
}

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function toPosixRelativeImport(fromFile, targetFile) {
  let rel = path.posix.relative(
    path.posix.dirname(fromFile.split(path.sep).join("/")),
    targetFile.split(path.sep).join("/"),
  );
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  return rel;
}

async function main() {
  const rootPkg = await readJson(path.join(REPO_ROOT, "package.json"));
  const sharedPkg = await readJson(
    path.join(REPO_ROOT, "packages", "shared", "package.json"),
  );
  const serverPkg = await readJson(
    path.join(REPO_ROOT, "packages", "server", "package.json"),
  );
  const uiPkg = await readJson(
    path.join(REPO_ROOT, "packages", "ui", "package.json"),
  );

  const versions = new Map([
    ["package.json", rootPkg.version],
    ["packages/shared/package.json", sharedPkg.version],
    ["packages/server/package.json", serverPkg.version],
    ["packages/ui/package.json", uiPkg.version],
  ]);
  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size !== 1 || !rootPkg.version) {
    const summary = [...versions.entries()]
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    throw new Error(`Workspace package versions must match exactly: ${summary}`);
  }

  const sharedDist = path.join(REPO_ROOT, "packages", "shared", "dist");
  const serverDist = path.join(REPO_ROOT, "packages", "server", "dist");
  const uiDist = path.join(REPO_ROOT, "packages", "ui", "dist");

  await assertExists(
    path.join(sharedDist, "index.js"),
    "Run `npm run build` first.",
  );
  await assertExists(
    path.join(serverDist, "cli.js"),
    "Run `npm run build` first.",
  );
  await assertExists(
    path.join(uiDist, "index.html"),
    "Run `npm run build` first.",
  );

  await fs.rm(STAGE_DIR, { recursive: true, force: true });
  await fs.mkdir(STAGE_DIR, { recursive: true });

  const stageDist = path.join(STAGE_DIR, "dist");
  const stageShared = path.join(stageDist, "_shared");
  const stageUiDist = path.join(STAGE_DIR, "ui-dist");
  const stageSkillDir = path.join(STAGE_DIR, "skill");

  await fs.cp(serverDist, stageDist, { recursive: true });
  await fs.cp(sharedDist, stageShared, { recursive: true });
  await fs.cp(uiDist, stageUiDist, { recursive: true });
  await fs.cp(
    path.join(REPO_ROOT, "README.md"),
    path.join(STAGE_DIR, "README.md"),
  );
  await fs.cp(
    path.join(REPO_ROOT, "LICENSE"),
    path.join(STAGE_DIR, "LICENSE"),
  );
  await fs.mkdir(stageSkillDir, { recursive: true });
  await fs.cp(
    path.join(REPO_ROOT, "skill", "SKILL.md"),
    path.join(stageSkillDir, "SKILL.md"),
  );

  const sharedEntryFile = path.join(stageShared, "index.js");
  const distFiles = await walkFiles(stageDist);
  const sharedSpecifierRe =
    /(from\s+|import\s*\(\s*)(['"])@redlinify\/shared(?:\/index\.js)?\2/g;

  for (const file of distFiles) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
    const relFromShared = path.relative(stageShared, file);
    if (!relFromShared.startsWith("..") && !path.isAbsolute(relFromShared)) {
      continue;
    }

    const original = await fs.readFile(file, "utf8");
    const relTarget = toPosixRelativeImport(file, sharedEntryFile);
    const rewritten = original.replace(
      sharedSpecifierRe,
      (_match, prefix, quote) => `${prefix}${quote}${relTarget}${quote}`,
    );

    if (rewritten !== original) {
      await fs.writeFile(file, rewritten, "utf8");
    }

    if (/(['"])@redlinify\/shared(?:\/[^'"]*)?\1/.test(rewritten)) {
      throw new Error(
        `Residual @redlinify/shared specifier remained in staged file: ${file}`,
      );
    }
  }

  try {
    await fs.chmod(path.join(stageDist, "cli.js"), 0o755);
  } catch {
    // Ignore chmod limitations on filesystems that don't support POSIX modes
  }

  const runtimeDeps = {
    ...(sharedPkg.dependencies ?? {}),
    ...(serverPkg.dependencies ?? {}),
  };
  delete runtimeDeps["@redlinify/shared"];

  const publishManifest = {
    name: "redlinify",
    version: rootPkg.version,
    description: rootPkg.description,
    homepage: rootPkg.homepage,
    repository: rootPkg.repository,
    bugs: rootPkg.bugs,
    license: rootPkg.license,
    author: rootPkg.author,
    keywords: rootPkg.keywords,
    type: "module",
    engines: rootPkg.engines,
    bin: {
      redlinify: "./dist/cli.js",
    },
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
    files: ["dist", "ui-dist", "skill", "README.md", "LICENSE"],
    dependencies: runtimeDeps,
  };

  await fs.writeFile(
    path.join(STAGE_DIR, "package.json"),
    `${JSON.stringify(publishManifest, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    `Staged npm package redlinify@${rootPkg.version} at ${STAGE_DIR}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
