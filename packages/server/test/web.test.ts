import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DesignStorage, type DesignView } from "@redlinify/shared";
import { createWebServer, type RunningWebServer, type WsEvent } from "../src/web.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()!;
    await fn();
  }
});

async function setupServer(options?: { uiDistDir?: string }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-web-"));
  const storage = new DesignStorage(dir);
  await storage.initWorkspace("WebTest");
  const server: RunningWebServer = await createWebServer({
    storage,
    host: "127.0.0.1",
    port: 0,
    uiDistDir: options?.uiDistDir,
    watch: true,
  });

  cleanups.push(async () => {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  return { dir, storage, server };
}

function sampleView(id = "classes"): DesignView {
  return {
    id,
    title: "Classes",
    direction: "TB",
    nodes: [
      {
        id: "engine",
        entity_ref: "dedup_engine",
        kind: "Class",
        title: "DedupEngine",
        status: "draft",
        locked: false,
        sections: [{ id: "fields", heading: "Fields", items: ["ttl: number"] }],
      },
      {
        id: "store",
        kind: "Store",
        title: "EventStore",
        status: "approved",
        locked: true,
        sections: [],
      },
    ],
    edges: [{ id: "e1", source: "engine", target: "store", label: "writes" }],
  };
}

describe("Redlinify HTTP + WebSocket server", () => {
  it("serves health, workspace, view CRUD, 409 conflicts, threads, and cross-links", async () => {
    const { dir, storage, server } = await setupServer();
    await storage.upsertView({ view: sampleView("classes"), actor: "agent" });
    await storage.upsertView({
      view: {
        id: "algo",
        title: "Algorithm",
        direction: "LR",
        nodes: [
          {
            id: "dedup_stage",
            entity_ref: "dedup_engine",
            kind: "Stage",
            title: "DedupStage",
            status: "draft",
            locked: false,
            sections: [],
          },
        ],
        edges: [],
      },
      actor: "agent",
    });

    const health = await fetch(`${server.url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      project_name: "WebTest",
      initialized: true,
      root_dir: path.resolve(dir),
      pid: process.pid,
    });

    const viewRes = await fetch(`${server.url}/api/views/classes`);
    expect(viewRes.status).toBe(200);
    const viewJson = (await viewRes.json()) as {
      view: DesignView;
      view_hash: string;
    };
    expect(viewJson.view.id).toBe("classes");

    // Stale base_hash triggers 409
    const stalePut = await fetch(`${server.url}/api/views/classes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: { ...viewJson.view, title: "Conflict" },
        base_hash: "stalehash00000000",
      }),
    });
    expect(stalePut.status).toBe(409);
    await stalePut.text();

    // Valid PUT succeeds and records diff against checkpoint
    const validPut = await fetch(`${server.url}/api/views/classes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: { ...viewJson.view, title: "Updated Classes" },
        base_hash: viewJson.view_hash,
      }),
    });
    expect(validPut.status).toBe(200);
    const saved = (await validPut.json()) as {
      view: DesignView;
      diff: { has_changes: boolean };
    };
    expect(saved.view.title).toBe("Updated Classes");
    expect(saved.diff.has_changes).toBe(true);

    // Cross-links lookup across tabs
    const linksRes = await fetch(`${server.url}/api/cross-links/dedup_engine`);
    expect(linksRes.status).toBe(200);
    const linksJson = (await linksRes.json()) as {
      occurrences: Array<{ view_id: string; node_id: string }>;
    };
    expect(linksJson.occurrences.map((o) => o.view_id).sort()).toEqual([
      "algo",
      "classes",
    ]);

    // Human thread create + reply + resolve without summary
    const thrRes = await fetch(`${server.url}/api/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_type: "node",
        view_id: "classes",
        target_id: "engine",
        kind: "change_request",
        body: "Please add jitter to TTL",
      }),
    });
    expect(thrRes.status).toBe(201);
    const { thread } = (await thrRes.json()) as { thread: { id: string } };

    const replyRes = await fetch(
      `${server.url}/api/threads/${thread.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Resolved directly", resolve: true }),
      },
    );
    expect(replyRes.status).toBe(200);
    const resolved = (await replyRes.json()) as {
      thread: { status: string };
    };
    expect(resolved.thread.status).toBe("resolved");
  });

  it("distinguishes UI self-writes from external MCP disk updates over WebSocket", async () => {
    const { storage, server } = await setupServer();
    const initial = await storage.upsertView({
      view: sampleView("classes"),
      actor: "agent",
    });

    const events: WsEvent[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.on("message", (data) => {
      events.push(JSON.parse(String(data)) as WsEvent);
    });

    // Small settle delay for chokidar watcher readiness
    await new Promise((r) => setTimeout(r, 120));

    // 1. UI save -> origin: "ui"
    const uiUpdated = { ...initial.view, title: "UI Edit" };
    const putRes = await fetch(`${server.url}/api/views/classes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: uiUpdated, base_hash: initial.view_hash }),
    });
    expect(putRes.status).toBe(200);
    const putJson = (await putRes.json()) as { view_hash: string };

    await new Promise((r) => setTimeout(r, 250));
    expect(
      events.some(
        (e) =>
          e.type === "view_updated" &&
          e.view_id === "classes" &&
          e.origin === "ui",
      ),
    ).toBe(true);

    // 2. External thread write -> origin: "external"
    events.length = 0;
    await storage.postThreadMessage({
      target_type: "node",
      view_id: "classes",
      target_id: "engine",
      kind: "question",
      author: "agent",
      body: "External MCP agent question",
    });
    await storage.upsertView({
      view: { ...uiUpdated, title: "Agent Revision" },
      base_hash: putJson.view_hash,
      actor: "agent",
    });

    await new Promise((r) => setTimeout(r, 250));
    expect(
      events.some((e) => e.type === "threads_updated" && e.origin === "external"),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "view_updated" &&
          e.view_id === "classes" &&
          e.origin === "external",
      ),
    ).toBe(true);

    ws.close();
  });

  it("creates ER views and safely deletes views via DELETE /api/views/:id", async () => {
    const { storage, server } = await setupServer();

    const createRes = await fetch(`${server.url}/api/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Fleet ER",
        diagram_type: "er",
        direction: "LR",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      view: DesignView;
      view_hash: string;
    };
    expect(created.view.diagram_type).toBe("er");
    expect(created.view.id).toBe("fleet_er");

    const delRes = await fetch(`${server.url}/api/views/fleet_er`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ deleted: true, view_id: "fleet_er" });
    expect(await storage.listViewIds()).toEqual([]);
  });
});
