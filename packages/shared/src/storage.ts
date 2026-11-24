import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ZodError } from "zod";
import { computeSemanticDiff, type SemanticDiff } from "./diff.js";
import {
  ConcurrencyConflictError,
  DesignError,
  LockViolationError,
  NotFoundError,
  ValidationError,
} from "./errors.js";
import {
  applyViewPatch,
  checkLockViolations,
  mergePreservedCodeRefs,
} from "./guards.js";
import { computeViewHash } from "./hash.js";
import {
  CodeRefUpdateSchema,
  DesignThreadSchema,
  DesignViewSchema,
  ViewLayoutSchema,
  ViewRequestSchema,
  WorkspaceFileSchema,
  idSlugSchema,
  type ActorRole,
  type CodeRefUpdate,
  type DesignThread,
  type DesignView,
  type ThreadKind,
  type ThreadTargetType,
  type ViewLayout,
  type ViewPatch,
  type ViewRequest,
  type WorkspaceFile,
  type WorkspaceTab,
} from "./schemas.js";

const execFileAsync = promisify(execFile);

export const DESIGN_DIR_NAME = ".design";

const DESIGN_GITIGNORE_CONTENT = `.layout/
.checkpoint/
.lock
.tmp-*
`;

export interface StorageOptions {
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

export interface UpsertViewInput {
  view: DesignView;
  base_hash?: string;
  fulfill_request_id?: string;
  actor: ActorRole;
  force?: boolean;
}

export interface UpsertViewResult {
  view: DesignView;
  view_hash: string;
  created: boolean;
}

export interface PatchViewInput {
  view_id: string;
  base_hash: string;
  patch: ViewPatch;
  actor: ActorRole;
}

export interface PostThreadMessageInput {
  thread_id?: string;
  target_type?: ThreadTargetType;
  view_id?: string;
  target_id?: string;
  entity_ref?: string;
  kind?: ThreadKind;
  author: ActorRole;
  body: string;
  resolve?: boolean;
  reopen?: boolean;
  resolution_summary?: string;
}

export interface ThreadFilter {
  view_id?: string;
  target_type?: ThreadTargetType;
  target_id?: string;
  entity_ref?: string;
  status?: "open" | "resolved";
  query?: string;
}

export interface ViewDiffEntry {
  view_id: string;
  view_hash: string;
  diff: SemanticDiff;
}

export interface PendingFeedbackResult {
  view_hashes: Record<string, string>;
  view_diffs: ViewDiffEntry[];
  pending_threads: DesignThread[];
  view_requests: ViewRequest[];
}

export interface TabStatusSummary extends WorkspaceTab {
  view_hash: string | null;
  missing_view_file?: boolean;
  waiting_on_agent: number;
  waiting_on_human: number;
  drifted_count: number;
  has_human_edits: boolean;
  diff_counts: {
    nodes_added: number;
    nodes_removed: number;
    nodes_modified: number;
    edges_added: number;
    edges_removed: number;
    edges_modified: number;
  };
}

export interface WorkspaceStatusResult {
  initialized: boolean;
  project_name: string;
  tabs: TabStatusSummary[];
  workspace_threads_waiting_on_agent: number;
  workspace_threads_waiting_on_human: number;
  view_requests: ViewRequest[];
  entity_refs: Record<string, string[]>;
}

export function isThreadWaitingOnAgent(thread: DesignThread): boolean {
  if (thread.status !== "open") return false;
  const lastMsg = thread.messages[thread.messages.length - 1];
  return lastMsg?.author === "human";
}

export function isThreadWaitingOnHuman(thread: DesignThread): boolean {
  if (thread.status !== "open") return false;
  const lastMsg = thread.messages[thread.messages.length - 1];
  return lastMsg?.author === "agent";
}

export function isThreadPendingForAgent(thread: DesignThread): boolean {
  if (thread.status !== "open") return false;
  return isThreadWaitingOnAgent(thread) || thread.kind === "drift_alert";
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

/**
 * Walks upward from `startDir` looking for `.design/` first, then `.git/`,
 * falling back to `path.resolve(startDir)` if neither exists.
 */
export async function findProjectRoot(startDir: string): Promise<string> {
  const start = path.resolve(startDir);

  let current = start;
  while (true) {
    if (await pathExists(path.join(current, DESIGN_DIR_NAME))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  current = start;
  while (true) {
    if (await pathExists(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return start;
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
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

async function readJsonFile<T>(
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

export class DesignStorage {
  readonly rootDir: string;
  readonly designDir: string;
  readonly workspacePath: string;
  readonly viewsDir: string;
  readonly threadsDir: string;
  readonly layoutDir: string;
  readonly checkpointDir: string;
  readonly gitignorePath: string;
  readonly lockPath: string;

  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(rootDir: string, options?: StorageOptions) {
    this.rootDir = path.resolve(rootDir);
    this.designDir = path.join(this.rootDir, DESIGN_DIR_NAME);
    this.workspacePath = path.join(this.designDir, "workspace.json");
    this.viewsDir = path.join(this.designDir, "views");
    this.threadsDir = path.join(this.designDir, "threads");
    this.layoutDir = path.join(this.designDir, ".layout");
    this.checkpointDir = path.join(this.designDir, ".checkpoint");
    this.gitignorePath = path.join(this.designDir, ".gitignore");
    this.lockPath = path.join(this.designDir, ".lock");
    this.lockTimeoutMs = options?.lockTimeoutMs ?? 5000;
    this.staleLockMs = options?.staleLockMs ?? 15000;
  }

  private viewPath(viewId: string): string {
    const valid = idSlugSchema("view_id").parse(viewId);
    return path.join(this.viewsDir, `${valid}.json`);
  }

  private checkpointPath(viewId: string): string {
    const valid = idSlugSchema("view_id").parse(viewId);
    return path.join(this.checkpointDir, `${valid}.json`);
  }

  private layoutPath(viewId: string): string {
    const valid = idSlugSchema("view_id").parse(viewId);
    return path.join(this.layoutDir, `${valid}.json`);
  }

  private threadPath(threadId: string): string {
    const valid = idSlugSchema("thread_id").parse(threadId);
    return path.join(this.threadsDir, `${valid}.json`);
  }

  private async ensureDirsUnlocked(): Promise<void> {
    await fs.mkdir(this.designDir, { recursive: true });
    await fs.mkdir(this.viewsDir, { recursive: true });
    await fs.mkdir(this.threadsDir, { recursive: true });
    await fs.mkdir(this.layoutDir, { recursive: true });
    await fs.mkdir(this.checkpointDir, { recursive: true });
    if (!(await pathExists(this.gitignorePath))) {
      await fs.writeFile(this.gitignorePath, DESIGN_GITIGNORE_CONTENT, "utf8");
    }
  }

  /**
   * Acquires the cross-process `.design/.lock` mutex with retry backoff and
   * stale-lock recovery before running `fn`. Never nest `withLock` calls.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.designDir, { recursive: true });
    const token = randomUUID();
    const lockPayload = JSON.stringify({
      pid: process.pid,
      created_at: Date.now(),
      token,
    });
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      let handle: fs.FileHandle | undefined;
      try {
        handle = await fs.open(this.lockPath, "wx", 0o644);
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

        const clearedStale = await this.tryClearStaleLock();
        if (clearedStale) {
          continue;
        }

        if (Date.now() >= deadline) {
          throw new DesignError(
            "LOCK_TIMEOUT",
            `Timed out waiting for .design lock after ${this.lockTimeoutMs}ms`,
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
        const current = await fs.readFile(this.lockPath, "utf8");
        const parsed = JSON.parse(current) as { token?: string };
        if (parsed.token === token) {
          await fs.unlink(this.lockPath).catch(() => {});
        }
      } catch {
        // Lock was already removed or unreadable
      }
    }
  }

  private async tryClearStaleLock(): Promise<boolean> {
    try {
      const [stat, raw] = await Promise.all([
        fs.stat(this.lockPath),
        fs.readFile(this.lockPath, "utf8"),
      ]);
      const ageMs = Date.now() - stat.mtimeMs;
      let parsed: { pid?: number; created_at?: number } | undefined;
      try {
        parsed = JSON.parse(raw) as { pid?: number; created_at?: number };
      } catch {
        // Malformed lock payload counts as stale once slightly aged
        if (ageMs > 250) {
          await fs.unlink(this.lockPath).catch(() => {});
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

      if (deadOwner || ageMs > this.staleLockMs || createdAge > this.staleLockMs) {
        await fs.unlink(this.lockPath).catch(() => {});
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

  async initWorkspace(projectName?: string): Promise<WorkspaceFile> {
    return this.withLock(async () => {
      await this.ensureDirsUnlocked();
      if (!(await pathExists(this.gitignorePath))) {
        await fs.writeFile(this.gitignorePath, DESIGN_GITIGNORE_CONTENT, "utf8");
      }
      if (await pathExists(this.workspacePath)) {
        return this.readWorkspaceUnlocked();
      }
      const ws = WorkspaceFileSchema.parse({
        version: 1,
        project_name:
          projectName?.trim() || path.basename(this.rootDir) || "redlinify-project",
        tabs: [],
        view_requests: [],
      });
      await writeJsonAtomic(this.workspacePath, ws);
      return ws;
    });
  }

  private async readWorkspaceUnlocked(): Promise<WorkspaceFile> {
    return readJsonFile(this.workspacePath, WorkspaceFileSchema, "workspace.json");
  }

  private async ensureWorkspaceUnlocked(): Promise<WorkspaceFile> {
    await this.ensureDirsUnlocked();
    if (await pathExists(this.workspacePath)) {
      return this.readWorkspaceUnlocked();
    }
    const ws = WorkspaceFileSchema.parse({
      version: 1,
      project_name: path.basename(this.rootDir) || "redlinify-project",
      tabs: [],
      view_requests: [],
    });
    await writeJsonAtomic(this.workspacePath, ws);
    return ws;
  }

  async readWorkspace(): Promise<WorkspaceFile> {
    return this.readWorkspaceUnlocked();
  }

  async writeWorkspace(workspace: WorkspaceFile): Promise<WorkspaceFile> {
    const parsed = WorkspaceFileSchema.parse(workspace);
    return this.withLock(async () => {
      await this.ensureDirsUnlocked();
      await writeJsonAtomic(this.workspacePath, parsed);
      return parsed;
    });
  }

  async addViewRequest(input: {
    id?: string;
    title: string;
    prompt: string;
  }): Promise<ViewRequest> {
    return this.withLock(async () => {
      const ws = await this.ensureWorkspaceUnlocked();
      const id = input.id
        ? idSlugSchema("view_request.id").parse(input.id)
        : `req_${randomBytes(4).toString("hex")}`;
      if (ws.view_requests.some((r) => r.id === id)) {
        throw new ValidationError(`View request '${id}' already exists`);
      }
      const req: ViewRequest = ViewRequestSchemaOrThrow({
        id,
        title: input.title,
        prompt: input.prompt,
        created_at: new Date().toISOString(),
      });
      ws.view_requests.push(req);
      await writeJsonAtomic(this.workspacePath, ws);
      return req;
    });
  }

  async deleteViewRequest(requestId: string): Promise<void> {
    const validId = idSlugSchema("view_request.id").parse(requestId);
    await this.withLock(async () => {
      const ws = await this.readWorkspaceUnlocked();
      const next = ws.view_requests.filter((r) => r.id !== validId);
      if (next.length === ws.view_requests.length) {
        throw new NotFoundError(`View request '${validId}' not found`);
      }
      ws.view_requests = next;
      await writeJsonAtomic(this.workspacePath, ws);
    });
  }

  private async listViewIdsUnlocked(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.viewsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json") || entry.startsWith(".tmp-")) continue;
      const base = entry.slice(0, -5);
      const parsed = idSlugSchema("view_id").safeParse(base);
      if (parsed.success) {
        ids.push(parsed.data);
      }
    }
    return ids.sort((a, b) => a.localeCompare(b));
  }

  async listViewIds(): Promise<string[]> {
    return this.listViewIdsUnlocked();
  }

  private async readViewUnlocked(
    viewId: string,
  ): Promise<{ view: DesignView; view_hash: string }> {
    const filePath = this.viewPath(viewId);
    const view = await readJsonFile(filePath, DesignViewSchema, `view '${viewId}'`);
    return { view, view_hash: computeViewHash(view) };
  }

  async readView(viewId: string): Promise<{ view: DesignView; view_hash: string }> {
    return this.readViewUnlocked(viewId);
  }

  async readCheckpoint(viewId: string): Promise<DesignView | null> {
    const filePath = this.checkpointPath(viewId);
    if (!(await pathExists(filePath))) return null;
    return readJsonFile(filePath, DesignViewSchema, `checkpoint '${viewId}'`);
  }

  private async resolveCheckpointBaselineUnlocked(
    viewId: string,
    currentView: DesignView,
  ): Promise<DesignView | null> {
    const cpPath = this.checkpointPath(viewId);
    if (await pathExists(cpPath)) {
      return readJsonFile(cpPath, DesignViewSchema, `checkpoint '${viewId}'`);
    }

    if (currentView.created_by === "human") {
      return null;
    }

    // Missing checkpoint for an agent/repo-tracked view (e.g. fresh git clone):
    // try HEAD version from git before falling back to current view.
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["show", `HEAD:${DESIGN_DIR_NAME}/views/${viewId}.json`],
        { cwd: this.rootDir, timeout: 3000 },
      );
      const parsedHead = DesignViewSchema.safeParse(JSON.parse(stdout));
      if (parsedHead.success) {
        await writeJsonAtomic(cpPath, parsedHead.data);
        return parsedHead.data;
      }
    } catch {
      // Not in a git repo, no HEAD commit, or view is untracked
    }

    await writeJsonAtomic(cpPath, currentView);
    return currentView;
  }

  async resolveCheckpointBaseline(
    viewId: string,
    currentView: DesignView,
  ): Promise<DesignView | null> {
    return this.withLock(async () =>
      this.resolveCheckpointBaselineUnlocked(viewId, currentView),
    );
  }

  async upsertView(input: UpsertViewInput): Promise<UpsertViewResult> {
    let parsedView: DesignView;
    try {
      parsedView = DesignViewSchema.parse(input.view);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError(`Invalid view schema: ${err.message}`, err.issues);
      }
      throw err;
    }

    return this.withLock(async () => {
      await this.ensureDirsUnlocked();
      const filePath = this.viewPath(parsedView.id);
      const exists = await pathExists(filePath);
      const existingView = exists
        ? await readJsonFile(filePath, DesignViewSchema, `view '${parsedView.id}'`)
        : null;

      if (existingView) {
        const existingHash = computeViewHash(existingView);
        const requireHash =
          (input.actor === "agent" && !input.force) ||
          input.base_hash !== undefined;
        if (requireHash) {
          if (!input.base_hash) {
            throw new ConcurrencyConflictError(
              parsedView.id,
              null,
              existingHash,
              `base_hash is required when updating existing view '${parsedView.id}'`,
            );
          }
          if (input.base_hash !== existingHash) {
            throw new ConcurrencyConflictError(
              parsedView.id,
              input.base_hash,
              existingHash,
            );
          }
        }
      }

      let nextView: DesignView =
        input.actor === "agent"
          ? mergePreservedCodeRefs(existingView, parsedView)
          : structuredClone(parsedView);

      if (!existingView && nextView.created_by === undefined) {
        nextView = { ...nextView, created_by: input.actor };
      } else if (
        existingView &&
        nextView.created_by === undefined &&
        existingView.created_by !== undefined
      ) {
        nextView = { ...nextView, created_by: existingView.created_by };
      }

      if (existingView && input.actor === "agent") {
        const violations = checkLockViolations(existingView, nextView);
        if (violations.length > 0) {
          throw new LockViolationError(violations);
        }
      }

      await writeJsonAtomic(filePath, nextView);

      const ws = await this.ensureWorkspaceUnlocked();
      const existingTab = ws.tabs.find((t) => t.view_id === nextView.id);
      if (existingTab) {
        existingTab.title = nextView.title;
      } else {
        const maxOrder = ws.tabs.reduce(
          (max, t) => Math.max(max, t.order),
          -1,
        );
        ws.tabs.push({
          view_id: nextView.id,
          title: nextView.title,
          order: maxOrder + 1,
        });
      }

      if (input.fulfill_request_id) {
        ws.view_requests = ws.view_requests.filter(
          (r) => r.id !== input.fulfill_request_id,
        );
      }
      await writeJsonAtomic(this.workspacePath, ws);

      if (input.actor === "agent") {
        await writeJsonAtomic(this.checkpointPath(nextView.id), nextView);
      }

      return {
        view: nextView,
        view_hash: computeViewHash(nextView),
        created: !existingView,
      };
    });
  }

  async patchView(
    input: PatchViewInput,
  ): Promise<{ view: DesignView; view_hash: string }> {
    const validId = idSlugSchema("view_id").parse(input.view_id);

    return this.withLock(async () => {
      await this.ensureDirsUnlocked();
      const { view: existingView, view_hash: existingHash } =
        await this.readViewUnlocked(validId);

      if (input.base_hash !== existingHash) {
        throw new ConcurrencyConflictError(
          validId,
          input.base_hash,
          existingHash,
        );
      }

      const nextView = applyViewPatch(existingView, input.patch);

      if (input.actor === "agent") {
        const violations = checkLockViolations(existingView, nextView);
        if (violations.length > 0) {
          throw new LockViolationError(violations);
        }
      }

      await writeJsonAtomic(this.viewPath(validId), nextView);

      if (nextView.title !== existingView.title && (await pathExists(this.workspacePath))) {
        const ws = await this.readWorkspaceUnlocked();
        const tab = ws.tabs.find((t) => t.view_id === validId);
        if (tab) {
          tab.title = nextView.title;
          await writeJsonAtomic(this.workspacePath, ws);
        }
      }

      if (input.actor === "agent") {
        await writeJsonAtomic(this.checkpointPath(validId), nextView);
      }

      return {
        view: nextView,
        view_hash: computeViewHash(nextView),
      };
    });
  }

  async acknowledgeFeedback(
    entries: Array<{ view_id: string; base_hash: string }>,
  ): Promise<{ acknowledged: Array<{ view_id: string; view_hash: string }> }> {
    return this.withLock(async () => {
      await this.ensureDirsUnlocked();
      const verified: Array<{ view_id: string; view: DesignView; hash: string }> = [];

      for (const entry of entries) {
        const validId = idSlugSchema("view_id").parse(entry.view_id);
        const { view, view_hash } = await this.readViewUnlocked(validId);
        if (entry.base_hash !== view_hash) {
          throw new ConcurrencyConflictError(
            validId,
            entry.base_hash,
            view_hash,
          );
        }
        verified.push({ view_id: validId, view, hash: view_hash });
      }

      for (const item of verified) {
        await writeJsonAtomic(this.checkpointPath(item.view_id), item.view);
      }

      return {
        acknowledged: verified.map((v) => ({
          view_id: v.view_id,
          view_hash: v.hash,
        })),
      };
    });
  }

  async syncCodeRefs(input: {
    view_id: string;
    updates: CodeRefUpdate[];
  }): Promise<{ view: DesignView; view_hash: string; updated_node_ids: string[] }> {
    const validId = idSlugSchema("view_id").parse(input.view_id);
    const parsedUpdates = input.updates.map((u) => {
      try {
        return CodeRefUpdateSchema.parse(u);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new ValidationError(
            `Invalid code_ref update: ${err.message}`,
            err.issues,
          );
        }
        throw err;
      }
    });

    return this.withLock(async () => {
      await this.ensureDirsUnlocked();
      const { view: currentView } = await this.readViewUnlocked(validId);

      const nodeIds = new Set(currentView.nodes.map((n) => n.id));
      for (const upd of parsedUpdates) {
        if (!nodeIds.has(upd.node_id)) {
          throw new NotFoundError(
            `Node '${upd.node_id}' not found in view '${validId}'`,
          );
        }
      }

      // Resolve baseline before modifying disk view so missing-checkpoint fallback
      // captures the pre-sync state without inventing unrelated diffs.
      const baseline = await this.resolveCheckpointBaselineUnlocked(
        validId,
        currentView,
      );

      const updateMap = new Map(parsedUpdates.map((u) => [u.node_id, u]));
      const nextView: DesignView = {
        ...currentView,
        nodes: currentView.nodes.map((node) => {
          const upd = updateMap.get(node.id);
          if (!upd) return node;
          return {
            ...node,
            status: upd.status,
            code_refs: structuredClone(upd.code_refs),
          };
        }),
      };

      await writeJsonAtomic(this.viewPath(validId), nextView);

      if (baseline) {
        const nextCheckpoint: DesignView = {
          ...baseline,
          nodes: baseline.nodes.map((node) => {
            const upd = updateMap.get(node.id);
            if (!upd) return node;
            return {
              ...node,
              status: upd.status,
              code_refs: structuredClone(upd.code_refs),
            };
          }),
        };
        await writeJsonAtomic(this.checkpointPath(validId), nextCheckpoint);
      }

      return {
        view: nextView,
        view_hash: computeViewHash(nextView),
        updated_node_ids: parsedUpdates.map((u) => u.node_id),
      };
    });
  }

  private async listThreadsUnlocked(
    filter?: ThreadFilter,
  ): Promise<DesignThread[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.threadsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }

    const threads: DesignThread[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json") || entry.startsWith(".tmp-")) continue;
      const filePath = path.join(this.threadsDir, entry);
      const thread = await readJsonFile(
        filePath,
        DesignThreadSchema,
        `thread '${entry}'`,
      );
      threads.push(thread);
    }

    const queryLower = filter?.query?.trim().toLowerCase();
    const filtered = threads.filter((thread) => {
      if (filter?.view_id && thread.view_id !== filter.view_id) return false;
      if (filter?.target_type && thread.target_type !== filter.target_type)
        return false;
      if (filter?.target_id && thread.target_id !== filter.target_id) return false;
      if (filter?.entity_ref && thread.entity_ref !== filter.entity_ref)
        return false;
      if (filter?.status && thread.status !== filter.status) return false;
      if (queryLower) {
        const inSummary =
          thread.resolution_summary?.toLowerCase().includes(queryLower) ?? false;
        const inMessages = thread.messages.some((m) =>
          m.body.toLowerCase().includes(queryLower),
        );
        if (!inSummary && !inMessages) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const aTime = a.messages[0]?.created_at ?? "";
      const bTime = b.messages[0]?.created_at ?? "";
      if (aTime !== bTime) return aTime.localeCompare(bTime);
      return a.id.localeCompare(b.id);
    });

    return filtered;
  }

  async listThreads(filter?: ThreadFilter): Promise<DesignThread[]> {
    return this.listThreadsUnlocked(filter);
  }

  async readThread(threadId: string): Promise<DesignThread> {
    return readJsonFile(
      this.threadPath(threadId),
      DesignThreadSchema,
      `thread '${threadId}'`,
    );
  }

  async postThreadMessage(input: PostThreadMessageInput): Promise<DesignThread> {
    const body = input.body.trim();
    if (!body) {
      throw new ValidationError("Thread message body cannot be empty");
    }

    return this.withLock(async () => {
      await this.ensureDirsUnlocked();
      const now = new Date().toISOString();
      const msgId = `msg_${randomBytes(6).toString("hex")}`;

      if (input.thread_id) {
        const existing = await readJsonFile(
          this.threadPath(input.thread_id),
          DesignThreadSchema,
          `thread '${input.thread_id}'`,
        );
        const updated: DesignThread = {
          ...existing,
          messages: [
            ...existing.messages,
            { id: msgId, author: input.author, body, created_at: now },
          ],
        };

        if (input.resolve) {
          const summary = input.resolution_summary?.trim();
          if (!summary) {
            throw new ValidationError(
              "resolution_summary is required when resolving a thread",
            );
          }
          updated.status = "resolved";
          updated.resolution_summary = summary;
        } else if (input.reopen) {
          updated.status = "open";
          delete updated.resolution_summary;
        }

        const validated = DesignThreadSchema.parse(updated);
        await writeJsonAtomic(this.threadPath(validated.id), validated);
        return validated;
      }

      if (!input.target_type || !input.kind) {
        throw new ValidationError(
          "target_type and kind are required when creating a new thread",
        );
      }

      let entityRef = input.entity_ref;
      if (
        !entityRef &&
        input.target_type === "node" &&
        input.view_id &&
        input.target_id
      ) {
        const vPath = this.viewPath(input.view_id);
        if (await pathExists(vPath)) {
          const view = await readJsonFile(
            vPath,
            DesignViewSchema,
            `view '${input.view_id}'`,
          );
          const node = view.nodes.find((n) => n.id === input.target_id);
          if (node?.entity_ref) {
            entityRef = node.entity_ref;
          }
        }
      }

      let status: "open" | "resolved" = "open";
      let resolutionSummary: string | undefined;
      if (input.resolve) {
        const summary = input.resolution_summary?.trim();
        if (!summary) {
          throw new ValidationError(
            "resolution_summary is required when resolving a thread",
          );
        }
        status = "resolved";
        resolutionSummary = summary;
      }

      const threadId = `thr_${randomBytes(6).toString("hex")}`;
      let created: DesignThread;
      try {
        created = DesignThreadSchema.parse({
          id: threadId,
          target_type: input.target_type,
          ...(input.view_id ? { view_id: input.view_id } : {}),
          ...(input.target_id ? { target_id: input.target_id } : {}),
          ...(entityRef ? { entity_ref: entityRef } : {}),
          kind: input.kind,
          status,
          ...(resolutionSummary
            ? { resolution_summary: resolutionSummary }
            : {}),
          messages: [{ id: msgId, author: input.author, body, created_at: now }],
        });
      } catch (err) {
        if (err instanceof ZodError) {
          throw new ValidationError(
            `Invalid thread fields: ${err.message}`,
            err.issues,
          );
        }
        throw err;
      }

      await writeJsonAtomic(this.threadPath(created.id), created);
      return created;
    });
  }

  async readLayout(viewId: string): Promise<ViewLayout> {
    const filePath = this.layoutPath(viewId);
    if (!(await pathExists(filePath))) {
      return { positions: {} };
    }
    return readJsonFile(filePath, ViewLayoutSchema, `layout '${viewId}'`);
  }

  async writeLayout(viewId: string, layout: ViewLayout): Promise<ViewLayout> {
    const validId = idSlugSchema("view_id").parse(viewId);
    const parsed = ViewLayoutSchema.parse(layout);
    return this.withLock(async () => {
      await this.ensureDirsUnlocked();
      await writeJsonAtomic(this.layoutPath(validId), parsed);
      return parsed;
    });
  }

  async clearLayout(viewId: string): Promise<void> {
    const validId = idSlugSchema("view_id").parse(viewId);
    await this.withLock(async () => {
      await fs.unlink(this.layoutPath(validId)).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      });
    });
  }

  private async getEntityRefRegistryUnlocked(): Promise<
    Record<string, string[]>
  > {
    const viewIds = await this.listViewIdsUnlocked();
    const map = new Map<string, Set<string>>();

    for (const viewId of viewIds) {
      const { view } = await this.readViewUnlocked(viewId);
      for (const node of view.nodes) {
        if (!node.entity_ref) continue;
        let views = map.get(node.entity_ref);
        if (!views) {
          views = new Set<string>();
          map.set(node.entity_ref, views);
        }
        views.add(viewId);
      }
    }

    const registry: Record<string, string[]> = {};
    for (const ref of [...map.keys()].sort((a, b) => a.localeCompare(b))) {
      registry[ref] = [...map.get(ref)!].sort((a, b) => a.localeCompare(b));
    }
    return registry;
  }

  async getEntityRefRegistry(): Promise<Record<string, string[]>> {
    return this.getEntityRefRegistryUnlocked();
  }

  async getPendingFeedback(viewId?: string): Promise<PendingFeedbackResult> {
    const targetViewId = viewId
      ? idSlugSchema("view_id").parse(viewId)
      : undefined;

    return this.withLock(async () => {
      const viewIds = targetViewId
        ? [targetViewId]
        : await this.listViewIdsUnlocked();

      const view_hashes: Record<string, string> = {};
      const view_diffs: ViewDiffEntry[] = [];

      for (const id of viewIds) {
        const { view, view_hash } = await this.readViewUnlocked(id);
        view_hashes[id] = view_hash;
        const baseline = await this.resolveCheckpointBaselineUnlocked(id, view);
        const diff = computeSemanticDiff(baseline, view);
        if (diff.has_changes) {
          view_diffs.push({ view_id: id, view_hash, diff });
        }
      }

      const openThreads = await this.listThreadsUnlocked({
        status: "open",
        ...(targetViewId ? { view_id: targetViewId } : {}),
      });
      const pending_threads = openThreads.filter(isThreadPendingForAgent);

      let view_requests: ViewRequest[] = [];
      if (await pathExists(this.workspacePath)) {
        const ws = await this.readWorkspaceUnlocked();
        view_requests = ws.view_requests;
      }

      return {
        view_hashes,
        view_diffs,
        pending_threads,
        view_requests,
      };
    });
  }

  async getWorkspaceStatus(): Promise<WorkspaceStatusResult> {
    return this.withLock(async () => {
      if (!(await pathExists(this.workspacePath))) {
        return {
          initialized: false,
          project_name: path.basename(this.rootDir) || "redlinify-project",
          tabs: [],
          workspace_threads_waiting_on_agent: 0,
          workspace_threads_waiting_on_human: 0,
          view_requests: [],
          entity_refs: {},
        };
      }

      const ws = await this.readWorkspaceUnlocked();
      const threads = await this.listThreadsUnlocked({ status: "open" });
      const entity_refs = await this.getEntityRefRegistryUnlocked();

      const sortedTabs = [...ws.tabs].sort((a, b) => a.order - b.order);
      const tabSummaries: TabStatusSummary[] = [];

      for (const tab of sortedTabs) {
        const viewThreads = threads.filter((t) => t.view_id === tab.view_id);
        const waiting_on_agent = viewThreads.filter(isThreadWaitingOnAgent).length;
        const waiting_on_human = viewThreads.filter(isThreadWaitingOnHuman).length;

        const vPath = this.viewPath(tab.view_id);
        if (!(await pathExists(vPath))) {
          tabSummaries.push({
            ...tab,
            view_hash: null,
            missing_view_file: true,
            waiting_on_agent,
            waiting_on_human,
            drifted_count: 0,
            has_human_edits: false,
            diff_counts: {
              nodes_added: 0,
              nodes_removed: 0,
              nodes_modified: 0,
              edges_added: 0,
              edges_removed: 0,
              edges_modified: 0,
            },
          });
          continue;
        }

        const { view, view_hash } = await this.readViewUnlocked(tab.view_id);
        const baseline = await this.resolveCheckpointBaselineUnlocked(
          tab.view_id,
          view,
        );
        const diff = computeSemanticDiff(baseline, view);
        const drifted_count = view.nodes.filter(
          (n) => n.status === "drifted",
        ).length;

        tabSummaries.push({
          ...tab,
          view_hash,
          waiting_on_agent,
          waiting_on_human,
          drifted_count,
          has_human_edits: diff.has_changes,
          diff_counts: {
            nodes_added: diff.nodes_added.length,
            nodes_removed: diff.nodes_removed.length,
            nodes_modified: diff.nodes_modified.length,
            edges_added: diff.edges_added.length,
            edges_removed: diff.edges_removed.length,
            edges_modified: diff.edges_modified.length,
          },
        });
      }

      const workspaceThreads = threads.filter(
        (t) => t.target_type === "workspace",
      );

      return {
        initialized: true,
        project_name: ws.project_name,
        tabs: tabSummaries,
        workspace_threads_waiting_on_agent: workspaceThreads.filter(
          isThreadWaitingOnAgent,
        ).length,
        workspace_threads_waiting_on_human: workspaceThreads.filter(
          isThreadWaitingOnHuman,
        ).length,
        view_requests: ws.view_requests,
        entity_refs,
      };
    });
  }
}

function ViewRequestSchemaOrThrow(data: unknown): ViewRequest {
  const result = ViewRequestSchema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      `Invalid view_request: ${result.error.message}`,
      result.error.issues,
    );
  }
  return result.data;
}
