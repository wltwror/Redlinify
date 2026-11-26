import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { NotFoundError, ValidationError } from "./errors.js";

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function renameWithRetry(src: string, dst: string): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(src, dst);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= maxAttempts || !code || !RETRYABLE_RENAME_CODES.has(code)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

/**
 * Atomically writes formatted JSON via a temporary file in the same directory,
 * `fsync`, close, and `rename`.
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.tmp-${process.pid}-${Date.now()}-${randomUUID()}.json`,
  );
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmpPath, "w", 0o644);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(tmpPath, filePath);
  } catch (err) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export async function readJsonFile<T>(
  filePath: string,
  schema: { parse: (v: unknown) => T },
  label: string,
): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`${label} not found at ${filePath}`);
    }
    throw err;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new ValidationError(
      `Invalid JSON in ${label} (${filePath}): ${(err as Error).message}`,
    );
  }

  try {
    return schema.parse(parsedJson);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(
        `Invalid schema in ${label} (${filePath}): ${err.message}`,
        err.issues,
      );
    }
    throw err;
  }
}
