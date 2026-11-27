#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DesignStorage, findProjectRoot } from "@redlinify/shared";
import { createRedlinifyMcpServer } from "./mcp.js";
import {
  canonicalizeRootDir,
  ensureUiServer,
  getRunningUiUrl,
  openUrlInBrowser,
  removeUiMeta,
  stopUiServer,
  writeUiMeta,
} from "./uiDaemon.js";
import { resolveInstallRoot, runSelfUpdate } from "./updater.js";
import { createWebServer } from "./web.js";

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "../package.json");
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : "0.3.0";
  } catch {
    return "0.3.0";
  }
}

function parseArgs(argv: string[]): {
  command: string | undefined;
  flags: Record<string, string>;
} {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = rest[i + 1];
      if (val && !val.startsWith("--")) {
        flags[key] = val;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}

function parsePortFlag(raw: string | undefined, fallback = 4173): number {
  const port = raw ? Number(raw) : fallback;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

function isAddrInUseError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}

function resolveUiDistDir(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../ui/dist"),
    path.resolve(here, "../ui-dist"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return undefined;
}

function printHelp(): void {
  process.stderr.write(`Redlinify CLI v${readPackageVersion()}

Usage:
  redlinify mcp    [--dir <path>] [--port 4173] [--open] [--no-ui]
  redlinify ui     [--dir <path>] [--port 4173] [--host 127.0.0.1] [--open]
  redlinify stop   [--dir <path>] [--port 4173] [--host 127.0.0.1]
  redlinify init   [--dir <path>] [--name <project_name>]
  redlinify update [--check] [--rebuild] [--no-restart] [--dir <path>]
  redlinify --version | -v
  redlinify --help | -h
`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${readPackageVersion()}\n`);
    return;
  }
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    process.exit(command ? 0 : 1);
  }

  const startDir = flags.dir ? path.resolve(flags.dir) : process.cwd();

  if (command === "update") {
    const cliEntryPath = fileURLToPath(import.meta.url);
    const installRoot = resolveInstallRoot(cliEntryPath);
    const projectRoot = await findProjectRoot(startDir);
    const restartRoots = Array.from(
      new Set([
        ...(installRoot ? [installRoot] : []),
        ...(existsSync(path.join(projectRoot, ".design")) ? [projectRoot] : []),
      ]),
    );
    const checkOnly = flags.check === "true";
    const result = await runSelfUpdate({
      checkOnly,
      rebuild: flags.rebuild === "true",
      skipInstall: flags["skip-install"] === "true",
      noRestart: flags["no-restart"] === "true",
      remote: flags.remote,
      branch: flags.branch,
      restartRoots,
      cliEntryPath,
      onLog: (line) => process.stdout.write(`${line}\n`),
    });

    if (checkOnly) {
      if (result.up_to_date) {
        process.stdout.write(
          `Already up to date (v${result.current_version} @ ${result.current_sha.slice(0, 7)} on ${result.branch}${result.ahead > 0 ? `, ${result.ahead} local commit(s) ahead` : ""}).\n`,
        );
      } else {
        process.stdout.write(
          `Update available on ${result.upstream}: ${result.behind} commit(s) behind (${result.previous_sha.slice(0, 7)} → latest${result.latest_tag ? ` / ${result.latest_tag}` : ""}).\n`,
        );
        for (const commit of result.commits) {
          process.stdout.write(`  - ${commit}\n`);
        }
        process.stdout.write("Run 'redlinify update' to apply.\n");
      }
      return;
    }

    if (result.up_to_date && !result.updated) {
      process.stdout.write(
        `Redlinify is already up to date (v${result.current_version} @ ${result.current_sha.slice(0, 7)}). Pass --rebuild to force a rebuild.\n`,
      );
      return;
    }

    process.stdout.write(
      `Updated Redlinify: v${result.previous_version} (${result.previous_sha.slice(0, 7)}) → v${result.current_version} (${result.current_sha.slice(0, 7)})\n`,
    );
    if (result.restarted_ui_urls.length > 0) {
      process.stdout.write(
        `Restarted active UI server(s): ${result.restarted_ui_urls.join(", ")}\n`,
      );
    }
    process.stdout.write(
      "Note: reconnect/restart any running stdio MCP client session to load the updated server.\n",
    );
    return;
  }

  const rootDir =
    command === "init"
      ? startDir
      : await findProjectRoot(startDir);
  const storage = new DesignStorage(rootDir);

  if (command === "init") {
    const ws = await storage.initWorkspace(flags.name);
    process.stdout.write(
      `Initialized Redlinify in ${storage.designDir} (project: ${ws.project_name})\n`,
    );
    return;
  }

  if (command === "stop") {
    const host = flags.host ?? "127.0.0.1";
    const port = parsePortFlag(flags.port);
    const res = await stopUiServer(rootDir, port, host);
    if (res.stopped) {
      process.stdout.write(
        `Stopped Redlinify UI (${res.url ?? `pid ${res.pid}`})\n`,
      );
    } else {
      process.stdout.write(`No running Redlinify UI found for ${rootDir}\n`);
    }
    return;
  }

  if (command === "mcp") {
    const preferredPort = parsePortFlag(flags.port);
    const autoUi = flags["no-ui"] !== "true";
    const openOnAutoStart = flags.open === "true";
    const explicitDir = Boolean(flags.dir);
    const cliEntryPath = fileURLToPath(import.meta.url);

    const server = createRedlinifyMcpServer(
      storage,
      autoUi
        ? {
            explicitDir,
            ensureUi: (opts) =>
              ensureUiServer({
                rootDir: opts?.rootDir ?? rootDir,
                preferredPort,
                host: "127.0.0.1",
                openBrowser: opts?.openBrowser ?? openOnAutoStart,
                cliEntryPath,
              }),
            getRunningUiUrl: (targetRoot) =>
              getRunningUiUrl(
                targetRoot ?? rootDir,
                preferredPort,
                "127.0.0.1",
              ),
          }
        : { explicitDir },
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(
      `[redlinify mcp] connected via stdio (root: ${rootDir}, auto-ui: ${autoUi ? "on" : "off"})\n`,
    );
    return;
  }

  if (command === "ui") {
    const host = flags.host ?? "127.0.0.1";
    const explicitPort = Boolean(flags.port);
    const port = parsePortFlag(flags.port);
    const autoPort = flags["auto-port"] === "true" || !explicitPort;

    if (!explicitPort && flags["auto-port"] !== "true") {
      const existingUrl = await getRunningUiUrl(rootDir, port, host);
      if (existingUrl) {
        process.stdout.write(
          `Redlinify UI is already running at ${existingUrl} (project root: ${rootDir})\n`,
        );
        if (flags.open === "true") {
          openUrlInBrowser(existingUrl);
        }
        return;
      }
    }

    const uiDistDir = resolveUiDistDir();
    if (!uiDistDir) {
      process.stderr.write(
        "[redlinify ui] Warning: built UI bundle not found; serving API only.\n",
      );
    }

    const startWebServer = async () => {
      if (!autoPort) {
        return await createWebServer({ storage, host, port, uiDistDir });
      }
      const basePort = port > 0 ? port : 4173;
      const candidates: number[] = [];
      for (let offset = 0; offset <= 50; offset++) {
        const candidate = basePort + offset;
        if (candidate <= 65535) candidates.push(candidate);
      }
      candidates.push(0);
      let lastErr: unknown;
      for (const candidate of candidates) {
        try {
          return await createWebServer({
            storage,
            host,
            port: candidate,
            uiDistDir,
          });
        } catch (err) {
          if (isAddrInUseError(err)) {
            lastErr = err;
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    };

    let running;
    try {
      running = await startWebServer();
    } catch (err) {
      if (isAddrInUseError(err)) {
        process.stderr.write(
          `[redlinify ui] Port ${port} on ${host} is already in use. Choose another port with --port <number>.\n`,
        );
        process.exit(1);
      }
      throw err;
    }

    await writeUiMeta(rootDir, {
      pid: process.pid,
      port: running.port,
      host: running.host,
      url: running.url,
      root_dir: canonicalizeRootDir(rootDir),
      started_at: new Date().toISOString(),
    });

    process.stdout.write(
      `Redlinify UI listening at ${running.url} (project root: ${rootDir})\n`,
    );

    if (flags.open === "true") {
      openUrlInBrowser(running.url);
    }

    const shutdown = async () => {
      await removeUiMeta(rootDir, process.pid);
      await running.close().catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  printHelp();
  throw new Error(`Unknown subcommand: ${command}`);
}

main().catch((err) => {
  process.stderr.write(
    `[redlinify] fatal error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
