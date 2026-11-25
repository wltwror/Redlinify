import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveInstallRoot, runSelfUpdate } from "../src/updater.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()!;
    await fn();
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function configureTestGit(cwd: string): void {
  git(cwd, ["config", "user.email", "tester@example.com"]);
  git(cwd, ["config", "user.name", "Redlinify Tester"]);
  git(cwd, ["config", "commit.gpgsign", "false"]);
  git(cwd, ["config", "tag.gpgsign", "false"]);
}

async function setupUpstreamAndClones() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-updater-"));
  const upstreamDir = path.join(root, "upstream.git");
  const maintainerDir = path.join(root, "maintainer");
  const installDir = path.join(root, "install");

  cleanups.push(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  execFileSync("git", ["init", "--bare", "-b", "main", upstreamDir]);
  execFileSync("git", ["clone", upstreamDir, maintainerDir]);
  configureTestGit(maintainerDir);

  await fs.mkdir(path.join(maintainerDir, "packages", "server"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(maintainerDir, "package.json"),
    `${JSON.stringify({ name: "redlinify", version: "0.1.0" }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(maintainerDir, "packages", "server", "package.json"),
    `${JSON.stringify({ name: "@redlinify/server", version: "0.1.0" }, null, 2)}\n`,
    "utf8",
  );

  git(maintainerDir, ["add", "."]);
  git(maintainerDir, ["commit", "--no-gpg-sign", "-m", "initial release"]);
  git(maintainerDir, ["tag", "v0.1.0"]);
  git(maintainerDir, ["push", "-u", "origin", "main", "--tags"]);

  execFileSync("git", ["clone", upstreamDir, installDir]);
  configureTestGit(installDir);

  return { root, upstreamDir, maintainerDir, installDir };
}

describe("Redlinify self-updater", () => {
  it("resolves symlinked or source CLI paths to the repo root cleanly", () => {
    const expectedRoot = path.resolve(process.cwd());
    expect(
      resolveInstallRoot(path.join(expectedRoot, "packages/server/src/cli.ts")),
    ).toBe(expectedRoot);
    expect(resolveInstallRoot("/tmp/nonexistent/redlinify/cli.js")).toBeNull();
  });

  it("checks remote updates without mutating HEAD, then fast-forwards cleanly", async () => {
    const { maintainerDir, installDir } = await setupUpstreamAndClones();

    const upToDate = await runSelfUpdate({
      installRoot: installDir,
      checkOnly: true,
    });
    expect(upToDate.up_to_date).toBe(true);
    expect(upToDate.behind).toBe(0);
    expect(upToDate.latest_tag).toBe("v0.1.0");
    expect(upToDate.previous_version).toBe("0.1.0");

    // Maintainer pushes v0.2.0 upstream
    await fs.writeFile(
      path.join(maintainerDir, "packages", "server", "package.json"),
      `${JSON.stringify({ name: "@redlinify/server", version: "0.2.0" }, null, 2)}\n`,
      "utf8",
    );
    git(maintainerDir, ["add", "."]);
    git(maintainerDir, ["commit", "--no-gpg-sign", "-m", "chore: bump to 0.2.0"]);
    git(maintainerDir, ["tag", "v0.2.0"]);
    git(maintainerDir, ["push", "origin", "main", "--tags"]);

    const beforeHead = git(installDir, ["rev-parse", "HEAD"]);
    const checkResult = await runSelfUpdate({
      installRoot: installDir,
      checkOnly: true,
    });
    expect(checkResult.up_to_date).toBe(false);
    expect(checkResult.behind).toBe(1);
    expect(checkResult.latest_tag).toBe("v0.2.0");
    expect(checkResult.commits).toHaveLength(1);
    expect(checkResult.commits[0]).toContain("chore: bump to 0.2.0");
    expect(git(installDir, ["rev-parse", "HEAD"])).toBe(beforeHead);

    const applied = await runSelfUpdate({
      installRoot: installDir,
      skipInstall: true,
      skipBuild: true,
      noRestart: true,
    });
    expect(applied.updated).toBe(true);
    expect(applied.up_to_date).toBe(false);
    expect(applied.previous_version).toBe("0.1.0");
    expect(applied.current_version).toBe("0.2.0");
    expect(applied.previous_sha).toBe(beforeHead);
    expect(applied.current_sha).not.toBe(beforeHead);
    expect(applied.changed_files).toContain("packages/server/package.json");
  });

  it("refuses diverged clones, detached HEAD, and non-Git directories cleanly", async () => {
    const { root, maintainerDir, installDir } = await setupUpstreamAndClones();

    // Advance upstream and also commit locally on installDir -> diverged
    await fs.writeFile(path.join(maintainerDir, "UPSTREAM.txt"), "remote\n", "utf8");
    git(maintainerDir, ["add", "."]);
    git(maintainerDir, ["commit", "--no-gpg-sign", "-m", "upstream commit"]);
    git(maintainerDir, ["push", "origin", "main"]);

    await fs.writeFile(path.join(installDir, "LOCAL.txt"), "local\n", "utf8");
    git(installDir, ["add", "."]);
    git(installDir, ["commit", "--no-gpg-sign", "-m", "local commit"]);

    await expect(
      runSelfUpdate({
        installRoot: installDir,
        skipInstall: true,
        skipBuild: true,
        noRestart: true,
      }),
    ).rejects.toThrow(/diverged/i);

    // Detached HEAD error
    const sha = git(installDir, ["rev-parse", "HEAD"]);
    git(installDir, ["checkout", "--detach", sha]);
    await expect(
      runSelfUpdate({ installRoot: installDir, checkOnly: true }),
    ).rejects.toThrow(/detached HEAD/i);

    // Non-git directory error
    const plainDir = path.join(root, "plain");
    await fs.mkdir(plainDir, { recursive: true });
    await expect(
      runSelfUpdate({ installRoot: plainDir, checkOnly: true }),
    ).rejects.toThrow(/not a Git clone/i);
  });
});
