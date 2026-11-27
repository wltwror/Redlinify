import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesignStorage } from "@redlinify/shared";
import {
  canonicalizeRootDir,
  ensureUiServer,
  probeHealth,
  sameRootDir,
  stopUiServer,
} from "../src/uiDaemon.js";

const cliEntryPath = path.resolve(import.meta.dirname, "../dist/cli.js");
const cleanups: Array<() => Promise<void>> = [];

async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()!;
    await fn().catch(() => {});
  }
});

describe("uiDaemon multi-project isolation", () => {
  it("isolates concurrent ensureUiServer launches onto distinct ports cleanly", async () => {
    const baseTmp = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-daemon-"));
    const projA = path.join(baseTmp, "project-a");
    const projB = path.join(baseTmp, "project-b");
    await new DesignStorage(projA).initWorkspace("ProjectA");
    await new DesignStorage(projB).initWorkspace("ProjectB");

    const preferredPort = await pickFreePort();

    cleanups.push(async () => {
      await stopUiServer(projA, preferredPort, "127.0.0.1");
      await stopUiServer(projB, preferredPort, "127.0.0.1");
      await fs.rm(baseTmp, { recursive: true, force: true });
    });

    const [resA, resB] = await Promise.all([
      ensureUiServer({ rootDir: projA, preferredPort, cliEntryPath }),
      ensureUiServer({ rootDir: projB, preferredPort, cliEntryPath }),
    ]);

    expect(resA.started).toBe(true);
    expect(resB.started).toBe(true);
    expect(resA.port).not.toBe(resB.port);

    const healthA = await probeHealth(resA.url, projA, 1500);
    const healthB = await probeHealth(resB.url, projB, 1500);
    expect(healthA?.ok).toBe(true);
    expect(healthB?.ok).toBe(true);
    expect(await probeHealth(resA.url, projB, 600)).toBeNull();
    expect(await probeHealth(resB.url, projA, 600)).toBeNull();

    // Symlinked path to Project A reuses the same daemon instead of spawning a duplicate
    const linkA = path.join(baseTmp, "project-a-link");
    let symlinkCreated = false;
    try {
      await fs.symlink(projA, linkA, process.platform === "win32" ? "junction" : "dir");
      symlinkCreated = true;
    } catch {
      symlinkCreated = false;
    }

    if (symlinkCreated) {
      expect(sameRootDir(linkA, projA)).toBe(true);
      expect(canonicalizeRootDir(linkA)).toBe(canonicalizeRootDir(projA));
      const reused = await ensureUiServer({
        rootDir: linkA,
        preferredPort,
        cliEntryPath,
      });
      expect(reused.started).toBe(false);
      expect(reused.port).toBe(resA.port);
    }

    // Stopping Project A keeps Project B healthy
    const stoppedA = await stopUiServer(projA, preferredPort, "127.0.0.1");
    expect(stoppedA.stopped).toBe(true);
    expect(await probeHealth(resB.url, projB, 1500)).not.toBeNull();
  }, 15000);

  it("retries onto next port in CLI ui --auto-port when preferred port is occupied", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-autoport-"));
    await new DesignStorage(dir).initWorkspace("AutoPort");

    const blocker = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = blocker.address();
    const occupiedPort = addr && typeof addr === "object" ? addr.port : 0;

    let childPid: number | undefined;
    cleanups.push(async () => {
      await stopUiServer(dir, occupiedPort, "127.0.0.1");
      if (childPid) {
        try {
          process.kill(childPid, "SIGTERM");
        } catch {
          // already stopped
        }
      }
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      await fs.rm(dir, { recursive: true, force: true });
    });

    const child = spawn(
      process.execPath,
      [
        cliEntryPath,
        "ui",
        "--dir",
        dir,
        "--port",
        String(occupiedPort),
        "--host",
        "127.0.0.1",
        "--auto-port",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    childPid = child.pid;

    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });

    const deadline = Date.now() + 5000;
    let boundUrl = "";
    while (Date.now() < deadline) {
      const m = out.match(/Redlinify UI listening at (http:\/\/127\.0\.0\.1:\d+)/);
      if (m?.[1]) {
        boundUrl = m[1];
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }

    expect(boundUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const boundPort = Number(new URL(boundUrl).port);
    expect(boundPort).not.toBe(occupiedPort);
    expect(await probeHealth(boundUrl, dir, 1500)).not.toBeNull();
  }, 15000);
});
