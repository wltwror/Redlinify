#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DesignStorage, findProjectRoot } from "@redlinify/shared";
import { createRedlinifyMcpServer } from "./mcp.js";
import { createWebServer } from "./web.js";

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "../package.json");
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : "0.1.0";
  } catch {
    return "0.1.0";
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
  redlinify init [--dir <path>] [--name <project_name>]
  redlinify mcp  [--dir <path>]
  redlinify ui   [--dir <path>] [--port 4173] [--host 127.0.0.1]
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

  if (command === "mcp") {
    const server = createRedlinifyMcpServer(storage);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(
      `[redlinify mcp] connected via stdio (root: ${rootDir})\n`,
    );
    return;
  }

  if (command === "ui") {
    const host = flags.host ?? "127.0.0.1";
    const port = flags.port ? Number(flags.port) : 4173;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid port: ${flags.port}`);
    }
    const uiDistDir = resolveUiDistDir();
    if (!uiDistDir) {
      process.stderr.write(
        "[redlinify ui] Warning: built UI bundle not found; serving API only.\n",
      );
    }

    let running;
    try {
      running = await createWebServer({
        storage,
        host,
        port,
        uiDistDir,
      });
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "EADDRINUSE"
      ) {
        process.stderr.write(
          `[redlinify ui] Port ${port} on ${host} is already in use. Choose another port with --port <number>.\n`,
        );
        process.exit(1);
      }
      throw err;
    }
    process.stdout.write(
      `Redlinify UI listening at ${running.url} (project root: ${rootDir})\n`,
    );

    const shutdown = async () => {
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
