import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DesignStorage, type DesignView } from "@redlinify/shared";
import {
  MCP_WORKFLOW_INSTRUCTIONS,
  createRedlinifyMcpServer,
  type RedlinifyMcpOptions,
} from "../src/mcp.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()!;
    await fn();
  }
});

async function setupMcp(options?: RedlinifyMcpOptions) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-mcp-"));
  const storage = new DesignStorage(dir);
  await storage.initWorkspace("McpRepo");

  const server = createRedlinifyMcpServer(storage, options);
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  cleanups.push(async () => {
    await client.close();
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  return { dir, storage, client };
}

function parseToolJson<T>(res: Awaited<ReturnType<Client["callTool"]>>): T {
  const first = (res.content as Array<{ type: string; text: string }>)[0];
  return JSON.parse(first!.text) as T;
}

describe("Redlinify MCP Server (6 lean orthogonal tools)", () => {
  it("exposes 6 annotated tools with compact schema footprint and executes full workflow end-to-end", async () => {
    const { storage, client } = await setupMcp();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_decisions",
      "get_view",
      "get_workspace",
      "post_thread",
      "save_view",
      "sync_code_refs",
    ]);

    // Verify read-only hints & >50% smaller wire footprint vs previous 15.4KB payload
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("get_workspace")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("get_view")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("get_decisions")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("save_view")?.annotations?.readOnlyHint).toBe(false);
    expect(JSON.stringify(tools).length).toBeLessThan(7500);
    expect(MCP_WORKFLOW_INSTRUCTIONS.length).toBeLessThan(900);

    const req = await storage.addViewRequest({
      title: "Classes",
      prompt: "Model core entities",
    });

    const initialView: DesignView = {
      id: "classes",
      title: "Classes",
      diagram_type: "general",
      direction: "TB",
      nodes: [
        {
          id: "engine",
          entity_ref: "dedup_engine",
          kind: "Class",
          title: "DedupEngine",
          status: "draft",
          locked: false,
          sections: [
            { id: "fields", heading: "Fields", items: ["ttl: number"] },
          ],
        },
        {
          id: "store",
          entity_ref: "event_store",
          kind: "Store",
          title: "EventStore",
          status: "approved",
          locked: true,
          sections: [
            { id: "ops", heading: "Ops", items: ["put(id: string)"] },
          ],
        },
      ],
      edges: [{ id: "e1", source: "engine", target: "store", label: "writes" }],
    };

    const upserted = parseToolJson<{
      mode: string;
      view_id: string;
      view_hash: string;
      created: boolean;
      node_count: number;
      edge_count: number;
    }>(
      await client.callTool({
        name: "save_view",
        arguments: {
          view_id: initialView.id,
          title: initialView.title,
          direction: initialView.direction,
          nodes: initialView.nodes,
          edges: initialView.edges,
          fulfill_request_id: req.id,
        },
      }),
    );
    expect(upserted.mode).toBe("replace");
    expect(upserted.created).toBe(true);
    expect(upserted.node_count).toBe(2);
    expect(upserted.edge_count).toBe(1);

    // Handler still enforces strict slug validation cleanly despite lean wire schema
    const badSlugRes = await client.callTool({
      name: "get_view",
      arguments: { view_id: "../escape" },
    });
    expect(badSlugRes.isError).toBe(true);
    expect(parseToolJson<{ error: string }>(badSlugRes).error).toBe("VALIDATION_ERROR");

    // Request cleared + entity_refs populated
    const workspace = parseToolJson<{
      view_requests: unknown[];
      entity_refs: Record<string, string[]>;
      view_diffs: unknown[];
    }>(await client.callTool({ name: "get_workspace", arguments: {} }));
    expect(workspace.view_requests).toEqual([]);
    expect(workspace.view_diffs).toEqual([]);
    expect(workspace.entity_refs).toEqual({
      dedup_engine: ["classes"],
      event_store: ["classes"],
    });

    // Lock guard rejects mutating locked node via save_view replace & patch
    const lockedReplace = await client.callTool({
      name: "save_view",
      arguments: {
        view_id: "classes",
        title: "Classes",
        base_hash: upserted.view_hash,
        nodes: [
          initialView.nodes[0]!,
          { ...initialView.nodes[1]!, title: "TamperedStore" },
        ],
        edges: initialView.edges,
      },
    });
    expect(lockedReplace.isError).toBe(true);
    expect(parseToolJson<{ error: string }>(lockedReplace).error).toBe(
      "LOCK_VIOLATION",
    );

    const lockedPatch = await client.callTool({
      name: "save_view",
      arguments: {
        view_id: "classes",
        mode: "patch",
        base_hash: upserted.view_hash,
        nodes: [{ id: "store", title: "TamperedStore" }],
      },
    });
    expect(lockedPatch.isError).toBe(true);
    expect(parseToolJson<{ error: string }>(lockedPatch).error).toBe(
      "LOCK_VIOLATION",
    );

    // Human edits unlocked node + posts question
    const humanView = structuredClone(initialView);
    humanView.nodes[0]!.sections[0]!.items.push("maxEntries: number");
    const humanSaved = await storage.upsertView({
      view: humanView,
      base_hash: upserted.view_hash,
      actor: "human",
    });
    const thr = await storage.postThreadMessage({
      target_type: "node",
      view_id: "classes",
      target_id: "engine",
      kind: "question",
      author: "human",
      body: "Use LRU eviction?",
    });

    // Agent calls get_workspace (combined status + pending feedback)
    const pending = parseToolJson<{
      view_diffs: Array<{ view_id: string; view_hash: string }>;
      pending_threads: Array<{ id: string }>;
    }>(await client.callTool({ name: "get_workspace", arguments: {} }));
    expect(pending.view_diffs.map((d) => d.view_id)).toEqual(["classes"]);
    expect(pending.pending_threads.map((t) => t.id)).toEqual([thr.id]);

    // Agent accepts diff via save_view(mode="acknowledge") & resolves thread with ADR summary
    const acked = parseToolJson<{
      mode: string;
      acknowledged: Array<{ view_id: string }>;
    }>(
      await client.callTool({
        name: "save_view",
        arguments: {
          mode: "acknowledge",
          view_id: "classes",
          base_hash: humanSaved.view_hash,
        },
      }),
    );
    expect(acked.mode).toBe("acknowledge");
    expect(acked.acknowledged.map((a) => a.view_id)).toEqual(["classes"]);

    await client.callTool({
      name: "post_thread",
      arguments: {
        thread_id: thr.id,
        body: "Yes, bounded LRU eviction keeps memory flat.",
        resolve: true,
        resolution_summary: "Use bounded LRU eviction in DedupEngine.",
      },
    });

    // save_view(mode="patch") adds a new node, updates existing node section_ops, and clears label with null
    const patched = parseToolJson<{
      mode: string;
      view_id: string;
      view_hash: string;
      node_count: number;
      edge_count: number;
    }>(
      await client.callTool({
        name: "save_view",
        arguments: {
          view_id: "classes",
          mode: "patch",
          base_hash: humanSaved.view_hash,
          nodes: [
            {
              id: "engine",
              status: "approved",
              section_ops: [
                { op: "update", id: "fields", add_items: ["eviction: 'lru'"] },
              ],
            },
            {
              id: "cache",
              kind: "Cache",
              title: "HotCache",
              status: "draft",
              sections: [],
            },
          ],
          edges: [
            { id: "e1", label: null },
            { id: "e2", source: "engine", target: "cache", label: "warms" },
          ],
        },
      }),
    );
    expect(patched.mode).toBe("patch");
    expect(patched.node_count).toBe(3);
    expect(patched.edge_count).toBe(2);

    // get_view & get_decisions
    const viewDetails = parseToolJson<{
      view: DesignView;
      resolved_summaries: Array<{ resolution_summary: string }>;
    }>(
      await client.callTool({
        name: "get_view",
        arguments: { view_id: "classes", include_resolved_summaries: true },
      }),
    );
    expect(viewDetails.view.nodes.find((n) => n.id === "engine")?.status).toBe(
      "approved",
    );
    expect(
      viewDetails.view.nodes.find((n) => n.id === "engine")?.sections[0]?.items,
    ).toContain("eviction: 'lru'");
    expect(viewDetails.view.edges.find((e) => e.id === "e1")?.label).toBeUndefined();
    expect(viewDetails.resolved_summaries[0]?.resolution_summary).toContain(
      "LRU eviction",
    );

    const history = parseToolJson<{ threads: Array<{ id: string }> }>(
      await client.callTool({
        name: "get_decisions",
        arguments: { entity_ref: "dedup_engine" },
      }),
    );
    expect(history.threads.map((t) => t.id)).toEqual([thr.id]);

    // sync_code_refs updates locked node cleanly without creating human diffs
    const synced = parseToolJson<{
      view_id: string;
      updated_node_ids: string[];
    }>(
      await client.callTool({
        name: "sync_code_refs",
        arguments: {
          view_id: "classes",
          updates: [
            {
              node_id: "store",
              status: "implemented",
              code_refs: [{ path: "src/store.ts", symbol: "EventStore" }],
            },
          ],
        },
      }),
    );
    expect(synced.updated_node_ids).toEqual(["store"]);
    const postSyncFeedback = parseToolJson<{ view_diffs: unknown[] }>(
      await client.callTool({ name: "get_workspace", arguments: {} }),
    );
    expect(postSyncFeedback.view_diffs).toEqual([]);
  });

  it("auto-ensures UI url on diagram writes and supports get_workspace({ open_browser: true })", async () => {
    const ensureCalls: Array<{ openBrowser?: boolean } | undefined> = [];
    const { client } = await setupMcp({
      ensureUi: async (opts) => {
        ensureCalls.push(opts);
        return {
          url: "http://127.0.0.1:4173",
          started: ensureCalls.length === 1,
          browser_opened: Boolean(opts?.openBrowser),
        };
      },
      getRunningUiUrl: async () => "http://127.0.0.1:4173",
    });

    const created = parseToolJson<{ view_hash: string; ui_url?: string }>(
      await client.callTool({
        name: "save_view",
        arguments: {
          view_id: "arch",
          title: "Architecture",
          nodes: [
            {
              id: "api",
              kind: "Service",
              title: "API",
              status: "draft",
              locked: false,
              sections: [],
            },
          ],
          edges: [],
        },
      }),
    );
    expect(created.ui_url).toBe("http://127.0.0.1:4173/#view=arch");

    const patched = parseToolJson<{ ui_url?: string }>(
      await client.callTool({
        name: "save_view",
        arguments: {
          view_id: "arch",
          mode: "patch",
          base_hash: created.view_hash,
          nodes: [{ id: "api", status: "approved" }],
        },
      }),
    );
    expect(patched.ui_url).toBe("http://127.0.0.1:4173/#view=arch");

    const opened = parseToolJson<{
      ui_available: boolean;
      ui_url: string;
      ui_started: boolean;
      browser_opened: boolean;
    }>(
      await client.callTool({
        name: "get_workspace",
        arguments: {
          view_id: "arch",
          include_diff: false,
          open_browser: true,
        },
      }),
    );
    expect(opened).toMatchObject({
      project_name: "McpRepo",
      initialized: true,
      tabs: [
        {
          view_id: "arch",
          title: "Architecture",
          diagram_type: "general",
          order: 0,
          has_human_edits: false,
        },
      ],
      view_requests: [],
      entity_refs: {},
      ui_available: true,
      ui_url: "http://127.0.0.1:4173/#view=arch",
      ui_started: false,
      browser_opened: true,
    });
    expect(ensureCalls).toHaveLength(3);
  });
});
