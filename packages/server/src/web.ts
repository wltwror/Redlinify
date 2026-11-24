import { promises as fs } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { WebSocket, WebSocketServer } from "ws";
import { z, ZodError } from "zod";
import {
  ConcurrencyConflictError,
  DesignError,
  DesignStorage,
  DesignViewSchema,
  DiagramTypeSchema,
  EntityRefSchema,
  LockViolationError,
  NotFoundError,
  ThreadKindSchema,
  ThreadTargetTypeSchema,
  ValidationError,
  ViewDirectionSchema,
  ViewLayoutSchema,
  WorkspaceTabSchema,
  computeSemanticDiff,
  idSlugSchema,
} from "@redlinify/shared";

export interface WebServerOptions {
  storage: DesignStorage;
  host?: string;
  port?: number;
  uiDistDir?: string;
  watch?: boolean;
}

export type WsOrigin = "ui" | "external";

export type WsEvent =
  | { type: "workspace_updated"; origin: WsOrigin }
  | { type: "view_updated"; view_id: string; origin: WsOrigin }
  | { type: "threads_updated"; origin: WsOrigin };

export interface RunningWebServer {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const SELF_WRITE_TTL_MS = 1500;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

function sendBuffer(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: Buffer,
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const buf = Buffer.from(JSON.stringify(data), "utf8");
  sendBuffer(res, status, "application/json; charset=utf-8", buf);
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { "Content-Length": "0" });
  res.end();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new ValidationError("Request body exceeds 5MB limit");
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ValidationError(
      `Invalid JSON request body: ${(err as Error).message}`,
    );
  }
}

function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || `view_${Date.now().toString(36)}`;
}

function handleApiError(res: ServerResponse, err: unknown): void {
  if (err instanceof ZodError) {
    sendJson(res, 400, {
      error: "VALIDATION_ERROR",
      message: err.message,
      details: err.issues,
    });
    return;
  }
  if (err instanceof ValidationError) {
    sendJson(res, 400, {
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }
  if (err instanceof NotFoundError) {
    sendJson(res, 404, {
      error: err.code,
      message: err.message,
    });
    return;
  }
  if (
    err instanceof ConcurrencyConflictError ||
    err instanceof LockViolationError
  ) {
    sendJson(res, 409, {
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }
  if (err instanceof DesignError) {
    sendJson(res, 400, {
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }
  sendJson(res, 500, {
    error: "INTERNAL_ERROR",
    message: err instanceof Error ? err.message : String(err),
  });
}

async function serveStaticFile(
  res: ServerResponse,
  uiDistDir: string,
  reqPath: string,
): Promise<boolean> {
  const decoded = decodeURIComponent(reqPath);
  const relPath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const distRoot = path.resolve(uiDistDir);
  const candidate = path.resolve(distRoot, relPath);

  if (candidate !== distRoot && !candidate.startsWith(`${distRoot}${path.sep}`)) {
    return false;
  }

  let filePath = candidate;
  let stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    if (path.extname(relPath)) {
      return false;
    }
    filePath = path.join(distRoot, "index.html");
    stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return false;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  const content = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": String(content.length),
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });
  res.end(content);
  return true;
}

export async function createWebServer(
  options: WebServerOptions,
): Promise<RunningWebServer> {
  const { storage, uiDistDir } = options;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  const recentSelfWrites = new Map<string, number>();

  function markSelfWrite(...relPaths: string[]): void {
    const expiresAt = Date.now() + SELF_WRITE_TTL_MS;
    for (const rel of relPaths) {
      recentSelfWrites.set(rel.replace(/\\/g, "/"), expiresAt);
    }
  }

  function isSelfWrite(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, "/");
    const now = Date.now();
    for (const [key, exp] of recentSelfWrites.entries()) {
      if (exp < now) recentSelfWrites.delete(key);
    }
    const exp = recentSelfWrites.get(normalized);
    return exp !== undefined && exp >= now;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const parsedUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `${host}:${port}`}`,
      );
      const pathname = parsedUrl.pathname;

      if (pathname.startsWith("/api/")) {
        if (method === "GET" && pathname === "/api/health") {
          const status = await storage.getWorkspaceStatus();
          sendJson(res, 200, {
            ok: true,
            project_name: status.project_name,
            initialized: status.initialized,
          });
          return;
        }

        if (method === "GET" && pathname === "/api/workspace") {
          const status = await storage.getWorkspaceStatus();
          const workspace = status.initialized
            ? await storage.readWorkspace()
            : {
                version: 1 as const,
                project_name: status.project_name,
                tabs: [],
                view_requests: [],
              };
          const pending_feedback = status.initialized
            ? await storage.getPendingFeedback()
            : {
                view_hashes: {},
                view_diffs: [],
                pending_threads: [],
                view_requests: [],
              };
          sendJson(res, 200, { workspace, status, pending_feedback });
          return;
        }

        if (method === "PUT" && pathname === "/api/workspace/tabs") {
          const body = z
            .object({
              tabs: z.array(WorkspaceTabSchema),
            })
            .parse(await readJsonBody(req));
          const current = await storage.readWorkspace();
          const normalized = body.tabs.map((tab, idx) => ({
            ...tab,
            order: idx,
          }));
          markSelfWrite("workspace.json");
          const workspace = await storage.writeWorkspace({
            ...current,
            tabs: normalized,
          });
          sendJson(res, 200, { workspace });
          return;
        }

        if (method === "POST" && pathname === "/api/workspace/view-requests") {
          const body = z
            .object({
              id: idSlugSchema("view_request.id").optional(),
              title: z.string().trim().min(1),
              prompt: z.string().trim().min(1),
            })
            .parse(await readJsonBody(req));
          markSelfWrite("workspace.json");
          const request = await storage.addViewRequest(body);
          sendJson(res, 201, { request });
          return;
        }

        const viewReqMatch = pathname.match(
          /^\/api\/workspace\/view-requests\/([^/]+)$/,
        );
        if (method === "DELETE" && viewReqMatch) {
          const reqId = decodeURIComponent(viewReqMatch[1]!);
          markSelfWrite("workspace.json");
          await storage.deleteViewRequest(reqId);
          sendJson(res, 200, { deleted: true, id: reqId });
          return;
        }

        if (method === "POST" && pathname === "/api/views") {
          const body = z
            .object({
              id: idSlugSchema("view.id").optional(),
              title: z.string().trim().min(1),
              diagram_type: DiagramTypeSchema.default("general"),
              direction: ViewDirectionSchema.default("TB"),
            })
            .parse(await readJsonBody(req));
          const viewId = body.id ?? slugifyTitle(body.title);
          idSlugSchema("view.id").parse(viewId);

          const existingIds = await storage.listViewIds();
          if (existingIds.includes(viewId)) {
            throw new ConcurrencyConflictError(
              viewId,
              null,
              "",
              `View '${viewId}' already exists`,
            );
          }

          markSelfWrite("workspace.json", `views/${viewId}.json`);
          const created = await storage.upsertView({
            view: {
              id: viewId,
              title: body.title,
              diagram_type: body.diagram_type,
              direction: body.direction,
              created_by: "human",
              nodes: [],
              edges: [],
            },
            actor: "human",
          });
          sendJson(res, 201, created);
          return;
        }

        const viewMatch = pathname.match(/^\/api\/views\/([^/]+)$/);
        if (viewMatch) {
          const viewId = idSlugSchema("view_id").parse(
            decodeURIComponent(viewMatch[1]!),
          );
          if (method === "DELETE") {
            markSelfWrite("workspace.json", `views/${viewId}.json`);
            const deleted = await storage.deleteView(viewId);
            sendJson(res, 200, deleted);
            return;
          }
          if (method === "GET") {
            const [{ view, view_hash }, layout, threads] = await Promise.all([
              storage.readView(viewId),
              storage.readLayout(viewId),
              storage.listThreads({ view_id: viewId }),
            ]);
            const baseline = await storage.resolveCheckpointBaseline(
              viewId,
              view,
            );
            const diff = computeSemanticDiff(baseline, view);
            sendJson(res, 200, { view, view_hash, layout, diff, threads });
            return;
          }
          if (method === "PUT") {
            const rawBody = (await readJsonBody(req)) as Record<string, unknown>;
            const body = z
              .object({
                view: DesignViewSchema,
                base_hash: z.string().min(1).optional(),
              })
              .parse(rawBody);
            if (body.view.id !== viewId) {
              throw new ValidationError(
                `Path view_id '${viewId}' does not match body.view.id '${body.view.id}'`,
              );
            }
            const headerHash =
              typeof req.headers["if-match"] === "string"
                ? req.headers["if-match"]
                : undefined;
            const baseHash = body.base_hash ?? headerHash;

            markSelfWrite("workspace.json", `views/${viewId}.json`);
            const saved = await storage.upsertView({
              view: body.view,
              base_hash: baseHash,
              actor: "human",
            });
            const baseline = await storage.resolveCheckpointBaseline(
              viewId,
              saved.view,
            );
            const diff = computeSemanticDiff(baseline, saved.view);
            sendJson(res, 200, {
              view: saved.view,
              view_hash: saved.view_hash,
              diff,
            });
            return;
          }
        }

        const layoutMatch = pathname.match(/^\/api\/layout\/([^/]+)$/);
        if (layoutMatch) {
          const viewId = idSlugSchema("view_id").parse(
            decodeURIComponent(layoutMatch[1]!),
          );
          if (method === "GET") {
            sendJson(res, 200, { layout: await storage.readLayout(viewId) });
            return;
          }
          if (method === "PUT") {
            const layout = ViewLayoutSchema.parse(await readJsonBody(req));
            const saved = await storage.writeLayout(viewId, layout);
            sendJson(res, 200, { layout: saved });
            return;
          }
          if (method === "DELETE") {
            await storage.clearLayout(viewId);
            sendJson(res, 200, { cleared: true, view_id: viewId });
            return;
          }
        }

        if (method === "GET" && pathname === "/api/threads") {
          const statusParam = parsedUrl.searchParams.get("status");
          const targetTypeParam = parsedUrl.searchParams.get("target_type");
          const threads = await storage.listThreads({
            view_id: parsedUrl.searchParams.get("view_id") ?? undefined,
            target_type: targetTypeParam
              ? ThreadTargetTypeSchema.parse(targetTypeParam)
              : undefined,
            target_id: parsedUrl.searchParams.get("target_id") ?? undefined,
            entity_ref: parsedUrl.searchParams.get("entity_ref") ?? undefined,
            status:
              statusParam === "open" || statusParam === "resolved"
                ? statusParam
                : undefined,
            query: parsedUrl.searchParams.get("query") ?? undefined,
          });
          sendJson(res, 200, { threads });
          return;
        }

        if (method === "POST" && pathname === "/api/threads") {
          const body = z
            .object({
              target_type: ThreadTargetTypeSchema,
              view_id: idSlugSchema("view_id").optional(),
              target_id: idSlugSchema("target_id").optional(),
              entity_ref: EntityRefSchema.optional(),
              kind: ThreadKindSchema,
              body: z.string().trim().min(1),
            })
            .parse(await readJsonBody(req));
          const created = await storage.postThreadMessage({
            ...body,
            author: "human",
          });
          markSelfWrite(`threads/${created.id}.json`);
          sendJson(res, 201, { thread: created });
          return;
        }

        const threadMsgMatch = pathname.match(
          /^\/api\/threads\/([^/]+)\/messages$/,
        );
        if (method === "POST" && threadMsgMatch) {
          const threadId = idSlugSchema("thread_id").parse(
            decodeURIComponent(threadMsgMatch[1]!),
          );
          const body = z
            .object({
              body: z.string().trim().min(1),
              resolve: z.boolean().optional(),
              reopen: z.boolean().optional(),
              resolution_summary: z.string().optional(),
            })
            .parse(await readJsonBody(req));
          markSelfWrite(`threads/${threadId}.json`);
          const thread = await storage.postThreadMessage({
            thread_id: threadId,
            author: "human",
            ...body,
          });
          sendJson(res, 200, { thread });
          return;
        }

        if (method === "GET" && pathname === "/api/pending-feedback") {
          const viewId = parsedUrl.searchParams.get("view_id") ?? undefined;
          sendJson(res, 200, await storage.getPendingFeedback(viewId));
          return;
        }

        const crossLinkMatch = pathname.match(/^\/api\/cross-links\/([^/]+)$/);
        if (method === "GET" && crossLinkMatch) {
          const entityRef = EntityRefSchema.parse(
            decodeURIComponent(crossLinkMatch[1]!),
          );
          const viewIds = await storage.listViewIds();
          const occurrences: Array<{
            view_id: string;
            view_title: string;
            node_id: string;
            node_title: string;
            kind: string;
            status: string;
          }> = [];

          for (const viewId of viewIds) {
            const { view } = await storage.readView(viewId);
            for (const node of view.nodes) {
              if (node.entity_ref === entityRef) {
                occurrences.push({
                  view_id: view.id,
                  view_title: view.title,
                  node_id: node.id,
                  node_title: node.title,
                  kind: node.kind,
                  status: node.status,
                });
              }
            }
          }
          sendJson(res, 200, { entity_ref: entityRef, occurrences });
          return;
        }

        sendJson(res, 404, {
          error: "NOT_FOUND",
          message: `Unknown API route ${method} ${pathname}`,
        });
        return;
      }

      if (uiDistDir && (method === "GET" || method === "HEAD")) {
        const served = await serveStaticFile(res, uiDistDir, pathname);
        if (served) return;
      }

      if (pathname === "/favicon.ico") {
        sendEmpty(res, 204);
        return;
      }

      sendJson(res, 404, {
        error: "NOT_FOUND",
        message: `Resource not found: ${pathname}`,
      });
    } catch (err) {
      handleApiError(res, err);
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  function broadcast(event: WsEvent): void {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  let watcher: FSWatcher | undefined;
  let flushTimer: NodeJS.Timeout | undefined;
  const pendingPaths = new Set<string>();

  function flushWatcherEvents(): void {
    flushTimer = undefined;
    if (pendingPaths.size === 0) return;

    const batch = [...pendingPaths];
    pendingPaths.clear();

    let workspaceDirty = false;
    let threadsDirty = false;
    const viewIds = new Set<string>();
    const origins: WsOrigin[] = [];

    for (const rel of batch) {
      const origin: WsOrigin = isSelfWrite(rel) ? "ui" : "external";
      if (rel === "workspace.json") {
        workspaceDirty = true;
        origins.push(origin);
      } else if (rel.startsWith("views/") && rel.endsWith(".json")) {
        const viewId = rel.slice("views/".length, -".json".length);
        if (idSlugSchema("view_id").safeParse(viewId).success) {
          viewIds.add(viewId);
          origins.push(origin);
        }
      } else if (rel.startsWith("threads/") && rel.endsWith(".json")) {
        threadsDirty = true;
        origins.push(origin);
      }
    }

    const batchOrigin: WsOrigin = origins.includes("external") ? "external" : "ui";
    if (workspaceDirty) {
      broadcast({ type: "workspace_updated", origin: batchOrigin });
    }
    for (const view_id of viewIds) {
      broadcast({ type: "view_updated", view_id, origin: batchOrigin });
    }
    if (threadsDirty) {
      broadcast({ type: "threads_updated", origin: batchOrigin });
    }
  }

  if (options.watch !== false) {
    await fs.mkdir(storage.designDir, { recursive: true });
    watcher = chokidar.watch(storage.designDir, {
      ignoreInitial: true,
      ignored: (watchedPath) => {
        const rel = path
          .relative(storage.designDir, watchedPath)
          .replace(/\\/g, "/");
        if (!rel || rel === ".") return false;
        const base = path.basename(rel);
        if (
          base.startsWith(".tmp-") ||
          base === ".lock" ||
          base === ".gitignore" ||
          rel === ".layout" ||
          rel.startsWith(".layout/") ||
          rel === ".checkpoint" ||
          rel.startsWith(".checkpoint/")
        ) {
          return true;
        }
        return false;
      },
    });

    const onFsChange = (changedPath: string) => {
      const rel = path
        .relative(storage.designDir, changedPath)
        .replace(/\\/g, "/");
      if (!rel.endsWith(".json")) return;
      pendingPaths.add(rel);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flushWatcherEvents, 60);
    };

    watcher.on("add", onFsChange);
    watcher.on("change", onFsChange);
    watcher.on("unlink", onFsChange);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort =
    addr && typeof addr === "object" ? addr.port : port;

  return {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: async () => {
      if (flushTimer) clearTimeout(flushTimer);
      if (watcher) {
        await watcher.close();
      }
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close(() => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
    },
  };
}
