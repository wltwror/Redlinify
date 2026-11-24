import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConcurrencyConflictError,
  DesignStorage,
  LockViolationError,
  NotFoundError,
  ValidationError,
  computeViewHash,
  findProjectRoot,
  type DesignView,
} from "../src/index.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix = "redlinify-test-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function sampleClassesView(overrides?: Partial<DesignView>): DesignView {
  return {
    id: "classes",
    title: "Classes",
    direction: "TB",
    nodes: [
      {
        id: "dedup_engine",
        entity_ref: "dedup_engine",
        kind: "Class",
        title: "DedupEngine",
        status: "draft",
        locked: false,
        sections: [
          {
            id: "fields",
            heading: "Fields",
            items: ["ttl: number"],
          },
        ],
      },
      {
        id: "event_store",
        entity_ref: "event_store",
        kind: "Store",
        title: "EventStore",
        status: "approved",
        locked: true,
        sections: [
          {
            id: "ops",
            heading: "Operations",
            items: ["put(key: string): boolean"],
          },
        ],
      },
    ],
    edges: [
      {
        id: "e1",
        source: "dedup_engine",
        target: "event_store",
        label: "writes",
        step: 1,
        style: "solid",
      },
    ],
    ...overrides,
  };
}

describe("DesignStorage", () => {
  it("initializes workspace with self-contained .design/.gitignore and resolves project root", async () => {
    const dir = await makeTempDir();
    const storage = new DesignStorage(dir);
    const ws = await storage.initWorkspace("DemoApp");

    expect(ws.version).toBe(1);
    expect(ws.project_name).toBe("DemoApp");

    const gitignore = await fs.readFile(storage.gitignorePath, "utf8");
    expect(gitignore).toContain(".layout/");
    expect(gitignore).toContain(".checkpoint/");
    expect(gitignore).toContain(".lock");
    expect(gitignore).toContain(".tmp-*");

    const nested = path.join(dir, "src", "nested");
    await fs.mkdir(nested, { recursive: true });
    expect(await findProjectRoot(nested)).toBe(dir);
  });

  it("upserts views, clears fulfilled view_requests, enforces base_hash concurrency, and guards locked nodes", async () => {
    const dir = await makeTempDir();
    const storage = new DesignStorage(dir);
    await storage.initWorkspace("Demo");

    const req = await storage.addViewRequest({
      title: "Classes",
      prompt: "Design class hierarchy",
    });
    expect((await storage.readWorkspace()).view_requests).toHaveLength(1);

    const created = await storage.upsertView({
      view: sampleClassesView(),
      fulfill_request_id: req.id,
      actor: "agent",
    });
    expect(created.created).toBe(true);
    expect((await storage.readWorkspace()).view_requests).toHaveLength(0);
    expect((await storage.readWorkspace()).tabs.map((t) => t.view_id)).toEqual([
      "classes",
    ]);

    // Missing or stale base_hash fails for agent update
    await expect(
      storage.upsertView({
        view: sampleClassesView({ title: "Classes v2" }),
        actor: "agent",
      }),
    ).rejects.toThrow(ConcurrencyConflictError);

    await expect(
      storage.upsertView({
        view: sampleClassesView({ title: "Classes v2" }),
        base_hash: "0000000000000000",
        actor: "agent",
      }),
    ).rejects.toThrow(ConcurrencyConflictError);

    // Locked node mutation via upsert_view is rejected even with valid base_hash
    const mutatedLocked = sampleClassesView();
    mutatedLocked.nodes[1]!.title = "RenamedStore";
    await expect(
      storage.upsertView({
        view: mutatedLocked,
        base_hash: created.view_hash,
        actor: "agent",
      }),
    ).rejects.toThrow(LockViolationError);

    // Valid update on unlocked node succeeds and preserves checkpoint
    const validUpdate = sampleClassesView();
    validUpdate.nodes[0]!.summary = "Updated summary";
    const updated = await storage.upsertView({
      view: validUpdate,
      base_hash: created.view_hash,
      actor: "agent",
    });
    expect(updated.created).toBe(false);
    expect(updated.view.nodes[0]!.summary).toBe("Updated summary");
    const cp = await storage.readCheckpoint("classes");
    expect(cp?.nodes[0]?.summary).toBe("Updated summary");
  });

  it("supports patchView and acknowledgeFeedback workflows", async () => {
    const dir = await makeTempDir();
    const storage = new DesignStorage(dir);
    await storage.initWorkspace("Demo");

    const initial = await storage.upsertView({
      view: sampleClassesView(),
      actor: "agent",
    });

    // Human edits unlocked node in UI (no checkpoint update)
    const humanView = structuredClone(initial.view);
    humanView.nodes[0]!.sections[0]!.items.push("maxSize: number");
    const humanSaved = await storage.upsertView({
      view: humanView,
      base_hash: initial.view_hash,
      actor: "human",
    });

    const pending = await storage.getPendingFeedback();
    expect(pending.view_diffs).toHaveLength(1);
    expect(pending.view_diffs[0]?.diff.nodes_modified[0]?.sections_modified).toEqual([
      {
        id: "fields",
        heading: "Fields",
        added_items: ["maxSize: number"],
        removed_items: [],
        reordered: false,
      },
    ]);

    // Agent accepts human edit via acknowledgeFeedback
    await storage.acknowledgeFeedback([
      { view_id: "classes", base_hash: humanSaved.view_hash },
    ]);
    const afterAck = await storage.getPendingFeedback();
    expect(afterAck.view_diffs).toEqual([]);

    // Agent patches view incrementally
    const patched = await storage.patchView({
      view_id: "classes",
      base_hash: humanSaved.view_hash,
      actor: "agent",
      patch: {
        update_nodes: [
          {
            id: "dedup_engine",
            status: "approved",
          },
        ],
      },
    });
    expect(patched.view.nodes[0]?.status).toBe("approved");
    expect((await storage.getPendingFeedback()).view_diffs).toEqual([]);
  });

  it("syncCodeRefs updates locked nodes and patches ONLY status/code_refs in checkpoint", async () => {
    const dir = await makeTempDir();
    const storage = new DesignStorage(dir);
    await storage.initWorkspace("Demo");

    const initial = await storage.upsertView({
      view: sampleClassesView(),
      actor: "agent",
    });

    // Human concurrently edits unlocked node BEFORE agent finishes implementing locked node
    const humanEdit = structuredClone(initial.view);
    humanEdit.nodes[0]!.sections[0]!.items.push("windowMs: number");
    await storage.upsertView({
      view: humanEdit,
      base_hash: initial.view_hash,
      actor: "human",
    });

    // Agent links code_refs to locked node `event_store`
    const synced = await storage.syncCodeRefs({
      view_id: "classes",
      updates: [
        {
          node_id: "event_store",
          status: "implemented",
          code_refs: [{ path: "src/store.ts", symbol: "EventStore" }],
        },
      ],
    });

    const syncedEventStore = synced.view.nodes.find(
      (n) => n.id === "event_store",
    );
    expect(syncedEventStore?.status).toBe("implemented");
    expect(syncedEventStore?.locked).toBe(true);
    expect(syncedEventStore?.code_refs).toEqual([
      { path: "src/store.ts", symbol: "EventStore" },
    ]);

    // Human's unrelated edit on `dedup_engine` MUST STILL appear in getPendingFeedback,
    // while `event_store` status/code_refs MUST NOT appear as a human diff.
    const feedback = await storage.getPendingFeedback();
    expect(feedback.view_diffs).toHaveLength(1);
    const modifiedIds = feedback.view_diffs[0]!.diff.nodes_modified.map(
      (m) => m.id,
    );
    expect(modifiedIds).toEqual(["dedup_engine"]);
  });

  it("stores per-thread files, auto-populates entity_ref, resolves ADRs, and filters threads", async () => {
    const dir = await makeTempDir();
    const storage = new DesignStorage(dir);
    await storage.initWorkspace("Demo");
    await storage.upsertView({
      view: sampleClassesView(),
      actor: "agent",
    });

    // Agent asks a question on `dedup_engine` without explicitly passing entity_ref
    const t1 = await storage.postThreadMessage({
      target_type: "node",
      view_id: "classes",
      target_id: "dedup_engine",
      kind: "question",
      author: "agent",
      body: "Should TTL reset on duplicate hits?",
    });
    expect(t1.entity_ref).toBe("dedup_engine");
    expect(t1.status).toBe("open");

    const threadFileExists = await fs
      .access(path.join(storage.threadsDir, `${t1.id}.json`))
      .then(() => true)
      .catch(() => false);
    expect(threadFileExists).toBe(true);

    // Status reflects 1 thread waiting on human
    let status = await storage.getWorkspaceStatus();
    expect(status.tabs[0]?.waiting_on_human).toBe(1);
    expect(status.tabs[0]?.waiting_on_agent).toBe(0);
    expect(status.entity_refs).toEqual({
      dedup_engine: ["classes"],
      event_store: ["classes"],
    });

    // Human replies -> now waiting on agent
    await storage.postThreadMessage({
      thread_id: t1.id,
      author: "human",
      body: "No, fixed sliding window.",
    });
    status = await storage.getWorkspaceStatus();
    expect(status.tabs[0]?.waiting_on_human).toBe(0);
    expect(status.tabs[0]?.waiting_on_agent).toBe(1);

    const pending = await storage.getPendingFeedback();
    expect(pending.pending_threads.map((t) => t.id)).toEqual([t1.id]);

    // Resolving requires resolution_summary
    await expect(
      storage.postThreadMessage({
        thread_id: t1.id,
        author: "agent",
        body: "Locked in.",
        resolve: true,
      }),
    ).rejects.toThrow(ValidationError);

    const resolved = await storage.postThreadMessage({
      thread_id: t1.id,
      author: "agent",
      body: "Acknowledged, keeping fixed window.",
      resolve: true,
      resolution_summary: "Fixed sliding window TTL without reset on duplicate hits.",
    });
    expect(resolved.status).toBe("resolved");

    const history = await storage.listThreads({
      entity_ref: "dedup_engine",
      status: "resolved",
      query: "sliding window",
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe(t1.id);
  });

  it("handles missing checkpoints via created_by=human vs git HEAD fallback", async () => {
    const dir = await makeTempDir();
    execFileSync("git", ["init", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: dir,
    });
    execFileSync("git", ["config", "user.name", "Tester"], { cwd: dir });

    const storage = new DesignStorage(dir);
    await storage.initWorkspace("GitRepo");
    await storage.upsertView({
      view: sampleClassesView(),
      actor: "agent",
    });

    // Commit .design/ (without .checkpoint/ since .design/.gitignore ignores it)
    execFileSync("git", ["add", ".design"], { cwd: dir });
    execFileSync("git", ["commit", "-m", "commit initial design"], {
      cwd: dir,
    });

    // Simulate fresh clone by wiping .checkpoint/
    await fs.rm(storage.checkpointDir, { recursive: true, force: true });

    // 1) Committed view should report ZERO diffs (seeded from git HEAD)
    let pending = await storage.getPendingFeedback();
    expect(pending.view_diffs).toEqual([]);

    // 2) Now wipe .checkpoint/ again, edit committed view on disk -> diffs against git HEAD!
    await fs.rm(storage.checkpointDir, { recursive: true, force: true });
    const modifiedView = sampleClassesView({ title: "Edited After Clone" });
    await fs.writeFile(
      path.join(storage.viewsDir, "classes.json"),
      JSON.stringify(modifiedView, null, 2),
      "utf8",
    );
    pending = await storage.getPendingFeedback();
    expect(pending.view_diffs).toHaveLength(1);
    expect(pending.view_diffs[0]?.diff.view_meta_changed).toEqual({
      title: { before: "Classes", after: "Edited After Clone" },
    });

    // 3) Human-created blank view without checkpoint reports all nodes added
    const humanSketch: DesignView = {
      id: "sketch",
      title: "Human Sketch",
      direction: "LR",
      created_by: "human",
      nodes: [
        {
          id: "n1",
          kind: "Stage",
          title: "Ingest",
          status: "draft",
          locked: false,
          sections: [],
        },
      ],
      edges: [],
    };
    await storage.upsertView({ view: humanSketch, actor: "human" });
    pending = await storage.getPendingFeedback("sketch");
    expect(pending.view_diffs).toHaveLength(1);
    expect(pending.view_diffs[0]?.diff.baseline_missing).toBe(true);
    expect(pending.view_diffs[0]?.diff.nodes_added.map((n) => n.id)).toEqual([
      "n1",
    ]);
  });

  it("recovers stale lockfiles and enforces mutual exclusion across concurrent calls", async () => {
    const dir = await makeTempDir();
    const storage = new DesignStorage(dir, {
      lockTimeoutMs: 2000,
      staleLockMs: 500,
    });
    await storage.initWorkspace("Concurrency");

    // Simulate dead process lockfile
    await fs.writeFile(
      storage.lockPath,
      JSON.stringify({ pid: 999999, created_at: Date.now(), token: "dead" }),
      "utf8",
    );

    const view = await storage.upsertView({
      view: sampleClassesView(),
      actor: "agent",
    });
    expect(view.view_hash).toBe(computeViewHash(view.view));

    // Concurrent thread appends via Promise.all must NOT lose messages
    await Promise.all([
      storage.postThreadMessage({
        target_type: "workspace",
        kind: "decision",
        author: "human",
        body: "Msg 1",
      }),
      storage.postThreadMessage({
        target_type: "workspace",
        kind: "decision",
        author: "human",
        body: "Msg 2",
      }),
      storage.postThreadMessage({
        target_type: "workspace",
        kind: "decision",
        author: "human",
        body: "Msg 3",
      }),
    ]);

    const threads = await storage.listThreads({ target_type: "workspace" });
    expect(threads).toHaveLength(3);
  });

  it("manages layouts and throws NotFoundError for missing resources", async () => {
    const dir = await makeTempDir();
    const storage = new DesignStorage(dir);
    await storage.initWorkspace("LayoutTest");

    expect(await storage.readLayout("classes")).toEqual({ positions: {} });
    await storage.writeLayout("classes", {
      positions: { dedup_engine: { x: 100, y: 200 } },
      viewport: { x: 10, y: 20, zoom: 1.5 },
    });
    expect((await storage.readLayout("classes")).positions.dedup_engine).toEqual({
      x: 100,
      y: 200,
    });
    await storage.clearLayout("classes");
    expect(await storage.readLayout("classes")).toEqual({ positions: {} });

    await expect(storage.readView("nonexistent")).rejects.toThrow(NotFoundError);
    await expect(storage.readThread("thr_missing")).rejects.toThrow(NotFoundError);
  });
});
