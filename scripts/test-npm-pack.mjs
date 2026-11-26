#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile as execFileCb, spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const STAGE_DIR = path.join(REPO_ROOT, ".npm-stage");

async function runNpm(args, cwd) {
  const npmExec = process.env.npm_execpath;
  if (npmExec && /\.(c|m)?js$/i.test(npmExec)) {
    return await execFile(process.execPath, [npmExec, ...args], {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return await execFile(npmCmd, args, {
    cwd,
    shell: process.platform === "win32",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealth(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.ok === true) return;
      }
    } catch {
      // Server still starting
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Packaged UI server at ${baseUrl} did not become healthy`);
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore already-exited child
      }
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function testMcpStdio(cliJs, sandboxDir, prefsPath) {
  const child = spawn(
    process.execPath,
    [cliJs, "mcp", "--no-ui", "--dir", sandboxDir],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, REDLINIFY_PREFERENCES_PATH: prefsPath },
    },
  );

  let stderr = "";
  let buffer = "";
  const messages = [];
  const waiters = [];

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      messages.push(parsed);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(parsed)) {
          const w = waiters.splice(i, 1)[0];
          w.resolve(parsed);
        }
      }
    }
  });

  const waitForMessage = (pred, label, timeoutMs = 10000) => {
    const existing = messages.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for MCP ${label}. stderr:\n${stderr}`));
      }, timeoutMs);
      waiters.push({
        pred,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  };

  try {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "pack-test", version: "1.0.0" },
        },
      })}\n`,
    );
    const initResp = await waitForMessage((m) => m.id === 1, "initialize");
    assert.ok(initResp.result, `Expected initialize result: ${JSON.stringify(initResp)}`);

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      })}\n`,
    );
    const listResp = await waitForMessage((m) => m.id === 2, "tools/list");
    const toolNames = (listResp.result?.tools ?? []).map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      "get_decisions",
      "get_view",
      "get_workspace",
      "post_thread",
      "save_view",
      "sync_code_refs",
    ]);
  } finally {
    try {
      child.stdin.end();
    } catch {
      // Ignore closed stdin
    }
    await stopChildProcess(child);
  }
}

async function main() {
  const rootPkg = JSON.parse(
    await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
  );

  await execFile(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "build-npm-package.mjs")],
    { cwd: REPO_ROOT },
  );

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-pack-"));
  const packDir = path.join(tmpDir, "pack");
  const consumerDir = path.join(tmpDir, "consumer");
  const sandboxDir = path.join(tmpDir, "sandbox");
  const prefsPath = path.join(tmpDir, "preferences.json");

  let uiProc = null;
  try {
    await fs.mkdir(packDir, { recursive: true });
    await fs.mkdir(consumerDir, { recursive: true });
    await fs.mkdir(sandboxDir, { recursive: true });

    await runNpm(["pack", "--pack-destination", packDir], STAGE_DIR);
    const packedFiles = (await fs.readdir(packDir)).filter((f) =>
      f.endsWith(".tgz"),
    );
    assert.equal(
      packedFiles.length,
      1,
      `Expected 1 tarball in ${packDir}, found: ${packedFiles.join(", ")}`,
    );
    const tgzPath = path.join(packDir, packedFiles[0]);

    await fs.writeFile(
      path.join(consumerDir, "package.json"),
      JSON.stringify({ name: "redlinify-consumer", private: true }, null, 2),
      "utf8",
    );
    await runNpm(
      ["install", "--no-audit", "--no-fund", tgzPath],
      consumerDir,
    );

    const binName = process.platform === "win32" ? "redlinify.cmd" : "redlinify";
    const binPath = path.join(consumerDir, "node_modules", ".bin", binName);
    const cliJs = path.join(
      consumerDir,
      "node_modules",
      "redlinify",
      "dist",
      "cli.js",
    );
    assert.equal(existsSync(binPath), true, `Expected bin shim at ${binPath}`);
    assert.equal(existsSync(cliJs), true, `Expected CLI entrypoint at ${cliJs}`);

    const cliHead = await fs.readFile(cliJs, "utf8");
    assert.ok(
      cliHead.startsWith("#!/usr/bin/env node"),
      "Expected node shebang on packaged cli.js",
    );

    // 1. --version
    const verOut = await execFile(process.execPath, [cliJs, "--version"]);
    assert.equal(verOut.stdout.trim(), rootPkg.version);

    // 2. init --dir <sandbox>
    await execFile(process.execPath, [cliJs, "init", "--dir", sandboxDir, "--name", "Pack Test"]);
    assert.equal(
      existsSync(path.join(sandboxDir, ".design", "workspace.json")),
      true,
    );

    // 3. update --check must cleanly direct npm/npx users to npm install
    let updateErr = "";
    try {
      await execFile(process.execPath, [cliJs, "update", "--check"]);
      assert.fail("Expected update --check on packaged npm install to exit non-zero");
    } catch (err) {
      updateErr = String(err.stderr ?? err.message ?? "");
    }
    assert.match(updateErr, /npm install -g redlinify@latest/);

    // 4. ui server serves bundled ui-dist HTML and preferences API
    const port = await pickFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    uiProc = spawn(
      process.execPath,
      [cliJs, "ui", "--dir", sandboxDir, "--port", String(port), "--host", "127.0.0.1"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, REDLINIFY_PREFERENCES_PATH: prefsPath },
      },
    );
    await waitHealth(baseUrl);

    const htmlRes = await fetch(baseUrl);
    assert.equal(htmlRes.status, 200);
    const htmlBody = await htmlRes.text();
    assert.ok(htmlBody.includes('id="root"'), "Expected bundled React HTML root");

    const prefRes = await fetch(`${baseUrl}/api/preferences`);
    assert.equal(prefRes.status, 200);
    const prefJson = await prefRes.json();
    assert.ok(
      prefJson &&
        typeof prefJson.preferences === "object" &&
        prefJson.preferences !== null,
      "Expected { preferences } object from /api/preferences",
    );

    const wsRes = await fetch(`${baseUrl}/api/workspace`);
    assert.equal(wsRes.status, 200);
    const wsJson = await wsRes.json();
    assert.equal(wsJson.workspace?.project_name, "Pack Test");

    await stopChildProcess(uiProc);
    uiProc = null;

    // 5. mcp stdio exposes all 6 tools cleanly
    await testMcpStdio(cliJs, sandboxDir, prefsPath);

    process.stdout.write(
      `PASS: npm package smoke tests verified for redlinify@${rootPkg.version}\n`,
    );
  } finally {
    if (uiProc) {
      await stopChildProcess(uiProc);
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
