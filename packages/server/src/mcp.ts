import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CodeRefUpdateSchema,
  DesignError,
  DesignStorage,
  DesignViewSchema,
  EntityRefSchema,
  ThreadKindSchema,
  ThreadTargetTypeSchema,
  ViewPatchSchema,
  idSlugSchema,
} from "@redlinify/shared";

function okResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errResult(err: unknown) {
  if (err instanceof DesignError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: err.code,
              message: err.message,
              ...(err.details !== undefined ? { details: err.details } : {}),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function createRedlinifyMcpServer(storage: DesignStorage): McpServer {
  const server = new McpServer({
    name: "redlinify",
    version: "0.1.0",
  });

  server.tool(
    "get_workspace_status",
    "Inspect all diagram tabs (with view_hash, triage counts, drifted counts, human edit flags), pending view_requests, and existing entity_ref slugs.",
    {},
    async () => {
      try {
        return okResult(await storage.getWorkspaceStatus());
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "get_view",
    "Read a semantic DesignView (no pixel coordinates), its view_hash, and open threads. Optionally include 1-line ADR resolution summaries.",
    {
      view_id: idSlugSchema("view_id"),
      include_resolved_summaries: z.boolean().optional(),
    },
    async ({ view_id, include_resolved_summaries }) => {
      try {
        const [{ view, view_hash }, open_threads] = await Promise.all([
          storage.readView(view_id),
          storage.listThreads({ view_id, status: "open" }),
        ]);

        if (!include_resolved_summaries) {
          return okResult({ view, view_hash, open_threads });
        }

        const resolvedThreads = await storage.listThreads({
          view_id,
          status: "resolved",
        });
        const resolved_summaries = resolvedThreads.map((t) => ({
          id: t.id,
          target_type: t.target_type,
          target_id: t.target_id,
          entity_ref: t.entity_ref,
          kind: t.kind,
          resolution_summary: t.resolution_summary ?? "",
        }));

        return okResult({
          view,
          view_hash,
          open_threads,
          resolved_summaries,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "get_pending_feedback",
    "Core iteration tool: returns semantic diffs (current views vs. agent checkpoints), view_hashes, pending view_requests, and open threads awaiting the agent.",
    {
      view_id: idSlugSchema("view_id").optional(),
    },
    async ({ view_id }) => {
      try {
        return okResult(await storage.getPendingFeedback(view_id));
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "upsert_view",
    "Create or replace a semantic DesignView. Requires base_hash when updating an existing view (unless force=true), preserves existing code_refs when omitted, and rejects mutating/deleting/unlocking locked nodes or edges.",
    {
      view: DesignViewSchema,
      base_hash: z.string().min(1).optional(),
      fulfill_request_id: idSlugSchema("fulfill_request_id").optional(),
      force: z.boolean().optional(),
    },
    async ({ view, base_hash, fulfill_request_id, force }) => {
      try {
        const res = await storage.upsertView({
          view,
          base_hash,
          fulfill_request_id,
          actor: "agent",
          force,
        });
        return okResult(res);
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "patch_view",
    "Apply targeted incremental edits (meta, add/update/remove nodes or edges, section_ops) to an existing DesignView with optimistic concurrency (base_hash) and lock protection.",
    {
      view_id: idSlugSchema("view_id"),
      base_hash: z.string().min(1),
      patch: ViewPatchSchema,
    },
    async ({ view_id, base_hash, patch }) => {
      try {
        const res = await storage.patchView({
          view_id,
          base_hash,
          patch,
          actor: "agent",
        });
        return okResult(res);
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "acknowledge_feedback",
    "Advance agent checkpoints for views where human edits are accepted as-is without rewriting the diagram.",
    {
      views: z
        .array(
          z.object({
            view_id: idSlugSchema("view_id"),
            base_hash: z.string().min(1),
          }),
        )
        .min(1),
    },
    async ({ views }) => {
      try {
        return okResult(await storage.acknowledgeFeedback(views));
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "post_thread_message",
    "Create an anchored thread (question, change_request, decision, drift_alert) or append an agent reply. When resolve=true, requires a concise 1-line resolution_summary saved as an ADR.",
    {
      thread_id: idSlugSchema("thread_id").optional(),
      target_type: ThreadTargetTypeSchema.optional(),
      view_id: idSlugSchema("view_id").optional(),
      target_id: idSlugSchema("target_id").optional(),
      entity_ref: EntityRefSchema.optional(),
      kind: ThreadKindSchema.optional(),
      body: z.string().trim().min(1),
      resolve: z.boolean().optional(),
      reopen: z.boolean().optional(),
      resolution_summary: z.string().optional(),
    },
    async (args) => {
      try {
        const thread = await storage.postThreadMessage({
          ...args,
          author: "agent",
        });
        return okResult({ thread });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "get_node_history",
    "Retrieve full message transcripts of resolved ADR threads matching target_id, entity_ref, view_id, or search query.",
    {
      target_id: idSlugSchema("target_id").optional(),
      entity_ref: EntityRefSchema.optional(),
      view_id: idSlugSchema("view_id").optional(),
      query: z.string().optional(),
    },
    async ({ target_id, entity_ref, view_id, query }) => {
      try {
        const threads = await storage.listThreads({
          status: "resolved",
          target_id,
          entity_ref,
          view_id,
          query,
        });
        return okResult({ threads });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "sync_code_refs",
    "Update implementation links (code_refs) and status ('implemented' | 'drifted') on nodes (including locked nodes) without clobbering unrelated pending human edits.",
    {
      view_id: idSlugSchema("view_id"),
      updates: z.array(CodeRefUpdateSchema).min(1),
    },
    async ({ view_id, updates }) => {
      try {
        const res = await storage.syncCodeRefs({ view_id, updates });
        return okResult(res);
      } catch (err) {
        return errResult(err);
      }
    },
  );

  return server;
}
