import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesignError, withFileLock } from "../src/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-lock-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("withFileLock", () => {
  it("serializes concurrent callers against the same lock file", async () => {
    const dir = await makeTempDir();
    const lockPath = path.join(dir, ".lock");
    let inFlight = 0;
    let maxInFlight = 0;

    await Promise.all(
      Array.from({ length: 6 }, (_, idx) =>
        withFileLock(lockPath, async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 12 + (idx % 3) * 5));
          inFlight -= 1;
        }),
      ),
    );

    expect(maxInFlight).toBe(1);
  });

  it("recovers locks owned by dead PIDs and enforces lock timeout", async () => {
    const dir = await makeTempDir();
    const lockPath = path.join(dir, ".lock");

    // Stale lock owned by an unreachable dead PID
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 99999999, created_at: Date.now(), token: "dead" }),
      "utf8",
    );

    const recovered = await withFileLock(lockPath, async () => "acquired", {
      lockTimeoutMs: 500,
    });
    expect(recovered).toBe("acquired");

    // Live lock held by same PID triggers LOCK_TIMEOUT cleanly
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        created_at: Date.now(),
        token: "active",
      }),
      "utf8",
    );

    await expect(
      withFileLock(lockPath, async () => "never", {
        lockTimeoutMs: 120,
        staleLockMs: 60_000,
      }),
    ).rejects.toThrow(DesignError);
  });
});
