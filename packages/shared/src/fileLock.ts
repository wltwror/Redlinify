import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DesignError } from "./errors.js";

export interface FileLockOptions {
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

async function tryClearStaleLock(
  lockPath: string,
  staleLockMs: number,
): Promise<boolean> {
  try {
    const [stat, raw] = await Promise.all([
      fs.stat(lockPath),
      fs.readFile(lockPath, "utf8"),
    ]);
    const ageMs = Date.now() - stat.mtimeMs;
    let parsed: { pid?: number; created_at?: number } | undefined;
    try {
      parsed = JSON.parse(raw) as { pid?: number; created_at?: number };
    } catch {
      // Malformed lock payload counts as stale once slightly aged
      if (ageMs > 250) {
        await fs.unlink(lockPath).catch(() => {});
        return true;
      }
      return false;
    }

    const createdAge =
      typeof parsed.created_at === "number"
        ? Date.now() - parsed.created_at
        : ageMs;
    const deadOwner =
      typeof parsed.pid === "number" &&
      parsed.pid !== process.pid &&
      !isProcessAlive(parsed.pid);

    if (deadOwner || ageMs > staleLockMs || createdAge > staleLockMs) {
      await fs.unlink(lockPath).catch(() => {});
      return true;
    }
    return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    return false;
  }
}

/**
 * Acquires a cross-process `wx` lock file with retry backoff and
 * stale-lock recovery before running `fn`. Never nest calls on the same lock.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options?: FileLockOptions,
): Promise<T> {
  const lockTimeoutMs = options?.lockTimeoutMs ?? 5000;
  const staleLockMs = options?.staleLockMs ?? 15000;

  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const lockPayload = JSON.stringify({
    pid: process.pid,
    created_at: Date.now(),
    token,
  });
  const deadline = Date.now() + lockTimeoutMs;

  while (true) {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(lockPath, "wx", 0o644);
      await handle.writeFile(lockPayload, "utf8");
      await handle.close();
      handle = undefined;
      break;
    } catch (err) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }

      const clearedStale = await tryClearStaleLock(lockPath, staleLockMs);
      if (clearedStale) {
        continue;
      }

      if (Date.now() >= deadline) {
        throw new DesignError(
          "LOCK_TIMEOUT",
          `Timed out waiting for lock at ${lockPath} after ${lockTimeoutMs}ms`,
        );
      }

      const waitMs = 15 + Math.floor(Math.random() * 20);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      const current = await fs.readFile(lockPath, "utf8");
      const parsed = JSON.parse(current) as { token?: string };
      if (parsed.token === token) {
        await fs.unlink(lockPath).catch(() => {});
      }
    } catch {
      // Lock was already removed or unreadable
    }
  }
}
