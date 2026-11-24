import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DesignStorage, type DesignView } from "@redlinify/shared";
import { createRedlinifyMcpServer } from "../src/mcp.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()!;
    await fn();
  }
});

async function setupMcp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "redlinify-mcp-"));
  const storage = new DesignStorage(dir);
  await storage.initWorkspace("McpRepo");

  const server = createRedlinifyMcpServer(storage);
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

describe("Redlinify MCP Server (9 semantic tools)", () => {
  it("lists all 9 tools and executes full workflow end-to-end", async () => {
    const { storage, client } = await setupMcp();

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "acknowledge_feedback",
      "get_node_history",
      "get_pending_feedback",
      "get_view",
      "get_workspace_status",
      "patch_view",
      "post_thread_message",
      "sync_code_refs",
      "upsert_view",
    ]);

    const req = await storage.addViewRequest({
      title: "Classes",
      prompt: "Model core entities",
    });

    const initialView: DesignView = {
      id: "classes",
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

    const upserted = parseToolJson<{ view_hash: string; created: boolean }>(
      await client.callTool({
        name: "upsert_view",
        arguments: { view: initialView, fulfill_request_id: req.id },
      }),
    );
    expect(upserted.created).toBe(true);

    // Request cleared
    const status = parseToolJson<{
      view_requests: unknown[];
      entity_refs: Record<string, string[]>;
    }>(await client.callTool({ name: "get_workspace_status", arguments: {} }));
    expect(status.view_requests).toEqual([]);
    expect(status.entity_refs).toEqual({
      dedup_engine: ["classes"],
      event_store: ["classes"],
    });

    // Lock guard rejects mutating locked node via upsert_view
    const lockedAttempt = await client.callTool({
      name: "upsert_view",
      arguments: {
        base_hash: upserted.view_hash,
        view: {
          ...initialView,
          nodes: [
            initialView.nodes[0]!,
            { ...initialView.nodes[1]!, title: "TamperedStore" },
          ],
        },
      },
    });
    expect(lockedAttempt.isError).toBe(true);
    expect(parseToolJson<{ error: string }>(lockedAttempt).error).toBe(
      "LOCK_VIOLATION",
    );

    // Human edits unlocked node + posts reply
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

    // Agent calls get_pending_feedback
    const pending = parseToolJson<{
      view_diffs: Array<{ view_id: string; view_hash: string }>;
      pending_threads: Array<{ id: string }>;
    }>(await client.callTool({ name: "get_pending_feedback", arguments: {} }));
    expect(pending.view_diffs.map((d) => d.view_id)).toEqual(["classes"]);
    expect(pending.pending_threads.map((t) => t.id)).toEqual([thr.id]);

    // Agent accepts diff via acknowledge_feedback & resolves thread with ADR summary
    await client.callTool({
      name: "acknowledge_feedback",
      arguments: {
        views: [{ view_id: "classes", base_hash: humanSaved.view_hash }],
      },
    });
    await client.callTool({
      name: "post_thread_message",
      arguments: {
        thread_id: thr.id,
        body: "Yes, bounded LRU eviction keeps memory flat.",
        resolve: true,
        resolution_summary: "Use bounded LRU eviction in DedupEngine.",
      },
    });

    // patch_view works with latest base_hash
    const patched = parseToolJson<{ view: DesignView; view_hash: string }>(
      await client.callTool({
        name: "patch_view",
        arguments: {
          view_id: "classes",
          base_hash: humanSaved.view_hash,
          patch: {
            update_nodes: [{ id: "engine", status: "approved" }],
          },
        },
      }),
    );
    expect(patched.view.nodes[0]?.status).toBe("approved");

    // get_view & get_node_history
    const viewDetails = parseToolJson<{
      resolved_summaries: Array<{ resolution_summary: string }>;
    }>(
      await client.callTool({
        name: "get_view",
        arguments: { view_id: "classes", include_resolved_summaries: true },
      }),
    );
    expect(viewDetails.resolved_summaries[0]?.resolution_summary).toContain(
      "LRU eviction",
    );

    const history = parseToolJson<{ threads: Array<{ id: string }> }>(
      await client.callTool({
        name: "get_node_history",
        arguments: { entity_ref: "dedup_engine" },
      }),
    );
    expect(history.threads.map((t) => t.id)).toEqual([thr.id]);

    // sync_code_refs updates locked node cleanly without creating human diffs
    const synced = parseToolJson<{ updated_node_ids: string[] }>(
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
      await client.callTool({ name: "get_pending_feedback", arguments: {} }),
    );
    expect(postSyncFeedback.view_diffs).toEqual([]);
  });
});
