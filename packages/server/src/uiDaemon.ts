import { spawn } from "node:child_process";
import { existsSync, promises as fs, realpathSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESIGN_DIR_NAME } from "@redlinify/shared";

export const UI_SERVER_META_FILE = ".ui-server.json";

export interface UiServerMeta {
  pid: number;
  port: number;
  host: string;
  url: string;
  root_dir: string;
  started_at: string;
}

export interface EnsureUiServerOptions {
  rootDir: string;
  preferredPort?: number;
  host?: string;
  openBrowser?: boolean;
  cliEntryPath?: string;
}

export interface EnsureUiServerResult {
  url: string;
  port: number;
  pid?: number;
  started: boolean;
  browser_opened: boolean;
}

export interface StopUiServerResult {
  stopped: boolean;
  pid?: number;
  url?: string;
}

const inFlightEnsures = new Map<string, Promise<EnsureUiServerResult>>();

function uiMetaPath(rootDir: string): string {
  return path.join(path.resolve(rootDir), DESIGN_DIR_NAME, UI_SERVER_META_FILE);
}

export function canonicalizeRootDir(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  try {
    return typeof realpathSync.native === "function"
      ? realpathSync.native(resolved)
      : realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function sameRootDir(a: string, b: string): boolean {
  const ca = canonicalizeRootDir(a);
  const cb = canonicalizeRootDir(b);
  return process.platform === "win32"
    ? ca.toLowerCase() === cb.toLowerCase()
    : ca === cb;
}

/**
 * Best-effort detached browser launcher. Returns false without throwing in
 * headless Linux/SSH environments.
 */
export function openUrlInBrowser(url: string): boolean {
  try {
    if (process.platform === "darwin") {
      const child = spawn("open", [url], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return true;
    }
    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", () => {});
      child.unref();
      return true;
    }
    if (
      process.platform === "linux" &&
      (Boolean(process.env.DISPLAY) || Boolean(process.env.WAYLAND_DISPLAY))
    ) {
      const child = spawn("xdg-open", [url], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {});
      child.unref();
      return true;
    }
  } catch {
    // Ignore browser launch failures
  }
  return false;
}

export async function probeHealth(
  url: string,
  expectedRootDir: string,
  timeoutMs = 600,
): Promise<{ ok: true; pid?: number } | null> {
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: unknown;
      root_dir?: unknown;
      pid?: unknown;
    };
    if (
      data.ok === true &&
      typeof data.root_dir === "string" &&
      sameRootDir(data.root_dir, expectedRootDir)
    ) {
      return {
        ok: true,
        pid: typeof data.pid === "number" ? data.pid : undefined,
      };
    }
  } catch {
    // Server unreachable or timed out
  }
  return null;
}

function tryListenPort(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(null));
    srv.once("listening", () => {
      const addr = srv.address();
      const boundPort =
        addr && typeof addr === "object" ? addr.port : port;
      srv.close(() => resolve(boundPort));
    });
    srv.listen(port, host);
  });
}

export async function findAvailablePort(
  host: string,
  startPort: number,
  maxAttempts = 20,
): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = startPort + offset;
    if (candidate > 65535) break;
    const bound = await tryListenPort(host, candidate);
    if (bound !== null) return bound;
  }
  const ephemeral = await tryListenPort(host, 0);
  if (ephemeral === null) {
    throw new Error(`Unable to find free loopback port on ${host}`);
  }
  return ephemeral;
}

export async function readUiMeta(rootDir: string): Promise<UiServerMeta | null> {
  try {
    const raw = await fs.readFile(uiMetaPath(rootDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<UiServerMeta>;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.port === "number" &&
      typeof parsed.host === "string" &&
      typeof parsed.url === "string" &&
      typeof parsed.root_dir === "string"
    ) {
      return parsed as UiServerMeta;
    }
  } catch {
    // Missing or unreadable metadata
  }
  return null;
}

export async function writeUiMeta(
  rootDir: string,
  meta: UiServerMeta,
): Promise<void> {
  const designDir = path.join(path.resolve(rootDir), DESIGN_DIR_NAME);
  try {
    await fs.mkdir(designDir, { recursive: true });
    const target = uiMetaPath(rootDir);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    await fs.rename(tmp, target);
  } catch {
    // Best-effort runtime metadata write
  }
}

export async function removeUiMeta(
  rootDir: string,
  expectedPid?: number,
): Promise<void> {
  try {
    if (expectedPid !== undefined) {
      const current = await readUiMeta(rootDir);
      if (current && current.pid !== expectedPid) {
        return;
      }
    }
    await fs.unlink(uiMetaPath(rootDir));
  } catch {
    // Ignore missing metadata file
  }
}

export async function getRunningUiUrl(
  rootDir: string,
  preferredPort = 4173,
  host = "127.0.0.1",
): Promise<string | null> {
  const resolvedRoot = canonicalizeRootDir(rootDir);
  const meta = await readUiMeta(resolvedRoot);
  if (meta) {
    const alive = await probeHealth(meta.url, resolvedRoot);
    if (alive) return meta.url;
  }

  if (preferredPort > 0) {
    const defaultUrl = `http://${host}:${preferredPort}`;
    const defaultAlive = await probeHealth(defaultUrl, resolvedRoot);
    if (defaultAlive) {
      if (defaultAlive.pid !== undefined) {
        await writeUiMeta(resolvedRoot, {
          pid: defaultAlive.pid,
          port: preferredPort,
          host,
          url: defaultUrl,
          root_dir: resolvedRoot,
          started_at: new Date().toISOString(),
        });
      }
      return defaultUrl;
    }
  }
  return null;
}

async function ensureUiServerInternal(
  options: EnsureUiServerOptions,
): Promise<EnsureUiServerResult> {
  const resolvedRoot = canonicalizeRootDir(options.rootDir);
  const host = options.host ?? "127.0.0.1";
  const preferredPort = options.preferredPort ?? 4173;

  const existingMeta = await readUiMeta(resolvedRoot);
  if (existingMeta) {
    const alive = await probeHealth(existingMeta.url, resolvedRoot);
    if (alive) {
      const browser_opened = options.openBrowser
        ? openUrlInBrowser(existingMeta.url)
        : false;
      return {
        url: existingMeta.url,
        port: existingMeta.port,
        pid: alive.pid ?? existingMeta.pid,
        started: false,
        browser_opened,
      };
    }
  }

  if (preferredPort > 0) {
    const preferredUrl = `http://${host}:${preferredPort}`;
    const preferredAlive = await probeHealth(preferredUrl, resolvedRoot);
    if (preferredAlive) {
      if (preferredAlive.pid !== undefined) {
        await writeUiMeta(resolvedRoot, {
          pid: preferredAlive.pid,
          port: preferredPort,
          host,
          url: preferredUrl,
          root_dir: resolvedRoot,
          started_at: new Date().toISOString(),
        });
      }
      const browser_opened = options.openBrowser
        ? openUrlInBrowser(preferredUrl)
        : false;
      return {
        url: preferredUrl,
        port: preferredPort,
        pid: preferredAlive.pid,
        started: false,
        browser_opened,
      };
    }
  }

  const cliPath =
    options.cliEntryPath ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
  if (!existsSync(cliPath)) {
    throw new Error(`Redlinify CLI entrypoint not found at ${cliPath}`);
  }

  const spawnStartedAt = Date.now() - 1000;
  const child = spawn(
    process.execPath,
    [
      cliPath,
      "ui",
      "--dir",
      resolvedRoot,
      "--port",
      String(preferredPort),
      "--host",
      host,
      "--auto-port",
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );

  let spawnError: Error | null = null;
  let exitCode: number | null = null;
  child.once("error", (err) => {
    spawnError = err;
  });
  child.once("exit", (code) => {
    exitCode = code ?? 1;
  });
  child.unref();

  const deadline = Date.now() + 6000;
  let readyMeta: UiServerMeta | null = null;
  let readyPid = child.pid;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    const meta = await readUiMeta(resolvedRoot);
    const isFreshMeta =
      meta !== null &&
      ((child.pid !== undefined && meta.pid === child.pid) ||
        Date.parse(meta.started_at) >= spawnStartedAt);
    if (isFreshMeta) {
      const probe = await probeHealth(meta.url, resolvedRoot, 350);
      if (probe) {
        readyMeta = meta;
        readyPid = probe.pid ?? meta.pid;
        break;
      }
    }
    if (exitCode !== null && !isFreshMeta) break;
    await new Promise((r) => setTimeout(r, 90));
  }

  if (!readyMeta) {
    throw new Error(
      `Timed out waiting for Redlinify UI daemon to start for ${resolvedRoot}`,
    );
  }

  const browser_opened = options.openBrowser
    ? openUrlInBrowser(readyMeta.url)
    : false;
  return {
    url: readyMeta.url,
    port: readyMeta.port,
    pid: readyPid,
    started: true,
    browser_opened,
  };
}

export async function ensureUiServer(
  options: EnsureUiServerOptions,
): Promise<EnsureUiServerResult> {
  const key = canonicalizeRootDir(options.rootDir);
  const pending = inFlightEnsures.get(key);
  if (pending) {
    const res = await pending;
    if (options.openBrowser && !res.browser_opened) {
      return { ...res, browser_opened: openUrlInBrowser(res.url) };
    }
    return res;
  }

  const promise = ensureUiServerInternal(options).finally(() => {
    inFlightEnsures.delete(key);
  });
  inFlightEnsures.set(key, promise);
  return promise;
}

export async function stopUiServer(
  rootDir: string,
  preferredPort = 4173,
  host = "127.0.0.1",
): Promise<StopUiServerResult> {
  const resolvedRoot = canonicalizeRootDir(rootDir);
  const meta = await readUiMeta(resolvedRoot);
  let targetPid = meta?.pid;
  let targetUrl = meta?.url;

  if (targetUrl) {
    const alive = await probeHealth(targetUrl, resolvedRoot);
    if (!alive) {
      targetPid = undefined;
    } else if (alive.pid !== undefined) {
      targetPid = alive.pid;
    }
  } else if (preferredPort > 0) {
    const fallbackUrl = `http://${host}:${preferredPort}`;
    const alive = await probeHealth(fallbackUrl, resolvedRoot);
    if (alive?.pid !== undefined) {
      targetPid = alive.pid;
      targetUrl = fallbackUrl;
    }
  }

  await removeUiMeta(resolvedRoot, targetPid);
  if (targetPid === undefined) {
    return { stopped: false };
  }

  try {
    process.kill(targetPid, "SIGTERM");
    return { stopped: true, pid: targetPid, url: targetUrl };
  } catch {
    return { stopped: false, pid: targetPid, url: targetUrl };
  }
}
