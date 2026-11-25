import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ensureUiServer,
  getRunningUiUrl,
  probeHealth,
  readUiMeta,
  stopUiServer,
} from "./uiDaemon.js";

const execFileAsync = promisify(execFile);

export interface SelfUpdateOptions {
  installRoot?: string;
  checkOnly?: boolean;
  rebuild?: boolean;
  skipInstall?: boolean;
  skipBuild?: boolean;
  noRestart?: boolean;
  remote?: string;
  branch?: string;
  restartRoots?: string[];
  cliEntryPath?: string;
  onLog?: (line: string) => void;
}

export interface SelfUpdateResult {
  install_root: string;
  branch: string;
  upstream: string;
  previous_version: string;
  current_version: string;
  previous_sha: string;
  current_sha: string;
  behind: number;
  ahead: number;
  latest_tag: string | null;
  commits: string[];
  changed_files: string[];
  up_to_date: boolean;
  updated: boolean;
  installed_deps: boolean;
  rebuilt: boolean;
  restarted_ui_urls: string[];
}

export function resolveInstallRoot(entryFilePath?: string): string | null {
  try {
    const rawEntry = entryFilePath ?? fileURLToPath(import.meta.url);
    const realEntry = existsSync(rawEntry) ? realpathSync(rawEntry) : rawEntry;
    const candidate = path.resolve(path.dirname(realEntry), "../../..");
    const rootPkgPath = path.join(candidate, "package.json");
    if (!existsSync(rootPkgPath)) return null;
    const pkg = JSON.parse(readFileSync(rootPkgPath, "utf8")) as {
      name?: unknown;
    };
    return pkg.name === "redlinify" ? candidate : null;
  } catch {
    return null;
  }
}

function readServerVersion(installRoot: string): string {
  try {
    const pkgPath = path.join(installRoot, "packages", "server", "package.json");
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : "0.2.1";
  } catch {
    return "0.2.1";
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const detail =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    const msg = detail || (err instanceof Error ? err.message : String(err));
    throw new Error(`git ${args.join(" ")} failed: ${msg}`);
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  onLog?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const tail: string[] = [];
    const pushLines = (chunk: Buffer, emit: boolean) => {
      const text = chunk.toString("utf8");
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        if (emit) onLog?.(line);
      }
    };

    child.stdout?.on("data", (buf: Buffer) => pushLines(buf, true));
    child.stderr?.on("data", (buf: Buffer) => pushLines(buf, Boolean(onLog)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const suffix = tail.length > 0 ? `\n${tail.slice(-10).join("\n")}` : "";
        reject(
          new Error(
            `${command} ${args.join(" ")} exited with code ${code ?? "null"}${suffix}`,
          ),
        );
      }
    });
  });
}

async function restartRunningUi(
  rootDir: string,
  cliEntryPath: string | undefined,
  onLog?: (line: string) => void,
): Promise<string | null> {
  const resolvedRoot = path.resolve(rootDir);
  const runningUrl = await getRunningUiUrl(resolvedRoot);
  if (!runningUrl) return null;

  const meta = await readUiMeta(resolvedRoot);
  const parsedUrl = new URL(runningUrl);
  const port = Number(parsedUrl.port) || meta?.port || 4173;
  const host = meta?.host || parsedUrl.hostname || "127.0.0.1";

  onLog?.(`Restarting active Redlinify UI (${runningUrl})...`);
  await stopUiServer(resolvedRoot, port, host);

  // Wait briefly for the previous listener to exit so we reclaim the same port cleanly
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const alive = await probeHealth(runningUrl, resolvedRoot, 200);
    if (!alive) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const restarted = await ensureUiServer({
    rootDir: resolvedRoot,
    preferredPort: port,
    host,
    cliEntryPath,
  });
  return restarted.url;
}

export async function runSelfUpdate(
  options: SelfUpdateOptions = {},
): Promise<SelfUpdateResult> {
  const installRoot = options.installRoot
    ? path.resolve(options.installRoot)
    : resolveInstallRoot(options.cliEntryPath);

  if (!installRoot) {
    throw new Error(
      "Could not locate the Redlinify repository root. Update via your package manager or pull manually in your clone.",
    );
  }

  if (!existsSync(path.join(installRoot, ".git"))) {
    throw new Error(
      `Redlinify at ${installRoot} is not a Git clone; cannot self-update via git.`,
    );
  }

  const branch = await runGit(installRoot, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (branch === "HEAD") {
    throw new Error(
      `Cannot auto-update detached HEAD at ${installRoot}. Run: git -C "${installRoot}" checkout main`,
    );
  }

  let remote = options.remote;
  let remoteBranch = options.branch;
  if (!remote || !remoteBranch) {
    try {
      const tracked = await runGit(installRoot, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ]);
      const slash = tracked.indexOf("/");
      if (slash > 0) {
        remote = remote ?? tracked.slice(0, slash);
        remoteBranch = remoteBranch ?? tracked.slice(slash + 1);
      }
    } catch {
      // No upstream tracking branch configured; fall back to origin/<current>
    }
  }
  remote = remote ?? "origin";
  remoteBranch = remoteBranch ?? branch;
  const upstream = `${remote}/${remoteBranch}`;

  options.onLog?.(`Fetching updates from ${upstream}...`);
  try {
    await runGit(installRoot, ["fetch", "--tags", "--prune", remote]);
  } catch {
    await runGit(installRoot, ["fetch", "--tags", remote]);
  }

  // Ensure the target remote branch ref itself exists even on single-branch clones
  try {
    await runGit(installRoot, ["rev-parse", "--verify", upstream]);
  } catch {
    await runGit(installRoot, [
      "fetch",
      "--tags",
      remote,
      `+refs/heads/${remoteBranch}:refs/remotes/${remote}/${remoteBranch}`,
    ]);
  }

  const previousSha = await runGit(installRoot, ["rev-parse", "HEAD"]);
  await runGit(installRoot, ["rev-parse", "--verify", upstream]);

  const behindRaw = await runGit(installRoot, [
    "rev-list",
    "--count",
    `HEAD..${upstream}`,
  ]);
  const aheadRaw = await runGit(installRoot, [
    "rev-list",
    "--count",
    `${upstream}..HEAD`,
  ]);
  const behind = Number.parseInt(behindRaw, 10) || 0;
  const ahead = Number.parseInt(aheadRaw, 10) || 0;

  let commits: string[] = [];
  if (behind > 0) {
    const logOut = await runGit(installRoot, [
      "log",
      "--oneline",
      "-n",
      "10",
      `HEAD..${upstream}`,
    ]);
    commits = logOut ? logOut.split(/\r?\n/).filter(Boolean) : [];
  }

  let latestTag: string | null = null;
  try {
    latestTag =
      (await runGit(installRoot, [
        "describe",
        "--tags",
        "--abbrev=0",
        upstream,
      ])) || null;
  } catch {
    latestTag = null;
  }

  const previousVersion = readServerVersion(installRoot);

  if (options.checkOnly) {
    return {
      install_root: installRoot,
      branch,
      upstream,
      previous_version: previousVersion,
      current_version: previousVersion,
      previous_sha: previousSha,
      current_sha: previousSha,
      behind,
      ahead,
      latest_tag: latestTag,
      commits,
      changed_files: [],
      up_to_date: behind === 0,
      updated: false,
      installed_deps: false,
      rebuilt: false,
      restarted_ui_urls: [],
    };
  }

  if (behind === 0 && !options.rebuild) {
    return {
      install_root: installRoot,
      branch,
      upstream,
      previous_version: previousVersion,
      current_version: previousVersion,
      previous_sha: previousSha,
      current_sha: previousSha,
      behind: 0,
      ahead,
      latest_tag: latestTag,
      commits: [],
      changed_files: [],
      up_to_date: true,
      updated: false,
      installed_deps: false,
      rebuilt: false,
      restarted_ui_urls: [],
    };
  }

  if (behind > 0) {
    if (ahead > 0) {
      throw new Error(
        `Local branch '${branch}' has diverged from ${upstream} (${ahead} ahead, ${behind} behind). Resolve with git rebase/merge inside "${installRoot}".`,
      );
    }
    options.onLog?.(
      `Applying ${behind} commit(s) from ${upstream} (fast-forward)...`,
    );
    try {
      await runGit(installRoot, ["merge", "--ff-only", upstream]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Fast-forward update failed (${msg}). If you have local uncommitted edits in "${installRoot}", stash or commit them first (e.g. git -C "${installRoot}" stash).`,
      );
    }
  }

  const currentSha = await runGit(installRoot, ["rev-parse", "HEAD"]);
  const changedFiles =
    previousSha !== currentSha
      ? (
          await runGit(installRoot, [
            "diff",
            "--name-only",
            `${previousSha}..${currentSha}`,
          ])
        )
          .split(/\r?\n/)
          .filter(Boolean)
      : [];

  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const depsChanged = changedFiles.some(
    (f) =>
      f === "package.json" ||
      f === "package-lock.json" ||
      f.endsWith("/package.json"),
  );
  const needsInstall =
    !options.skipInstall &&
    (Boolean(options.rebuild) ||
      !existsSync(path.join(installRoot, "node_modules")) ||
      depsChanged);

  let installedDeps = false;
  if (needsInstall) {
    options.onLog?.("Installing workspace dependencies...");
    await runCommand(npmBin, ["install"], installRoot, options.onLog);
    installedDeps = true;
  }

  let rebuilt = false;
  if (!options.skipBuild) {
    options.onLog?.("Building workspace packages (@redlinify/shared, server, ui)...");
    await runCommand(npmBin, ["run", "build"], installRoot, options.onLog);
    rebuilt = true;
  }

  const currentVersion = readServerVersion(installRoot);
  const restartedUrls: string[] = [];

  if (!options.noRestart && !options.skipBuild) {
    const candidates = Array.from(
      new Set((options.restartRoots ?? [installRoot]).map((r) => path.resolve(r))),
    );
    for (const rootDir of candidates) {
      try {
        const restartedUrl = await restartRunningUi(
          rootDir,
          options.cliEntryPath,
          options.onLog,
        );
        if (restartedUrl) {
          restartedUrls.push(restartedUrl);
        }
      } catch (err) {
        options.onLog?.(
          `Warning: could not restart UI for ${rootDir}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  return {
    install_root: installRoot,
    branch,
    upstream,
    previous_version: previousVersion,
    current_version: currentVersion,
    previous_sha: previousSha,
    current_sha: currentSha,
    behind,
    ahead,
    latest_tag: latestTag,
    commits,
    changed_files: changedFiles,
    up_to_date: behind === 0 && !options.rebuild,
    updated: currentSha !== previousSha || rebuilt,
    installed_deps: installedDeps,
    rebuilt,
    restarted_ui_urls: restartedUrls,
  };
}
