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

export interface RedlinifyMcpOptions {
  ensureUi?: (opts?: { openBrowser?: boolean }) => Promise<{
    url: string;
    started: boolean;
    browser_opened?: boolean;
  } | null>;
  getRunningUiUrl?: () => Promise<string | null>;
}

const MCP_WORKFLOW_INSTRUCTIONS = `Redlinify is a collaborative architecture & ER design workbench stored in .design/.
- Inspect first: call get_workspace_status() to check existing views, entity_ref slugs, and pending view_requests.
- Design cleanly: write concise multi-view diagrams via upsert_view / patch_view (diagram_type: "general" for architecture/flows, "er" for schemas). Creating or updating a diagram automatically ensures the local browser UI is running and returns ui_url—share that clickable link with the user (or call open_workbench).
- Ask in the diagram: when facing ambiguity or tradeoffs, commit your best draft, set node status="needs_input", and open a concise thread via post_thread_message anchored to that exact node/edge instead of long chat essays.
- Iterate safely: always start review turns with get_pending_feedback(), respect locked nodes/edges (never mutate, delete, or unlock them), resolve settled threads with a 1-line resolution_summary (stored under Decisions/ADRs), and link finished code via sync_code_refs.`;

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

function viewDeepLink(baseUrl: string, viewId: string): string {
  return `${baseUrl}/#view=${encodeURIComponent(viewId)}`;
}

export function createRedlinifyMcpServer(
  storage: DesignStorage,
  options?: RedlinifyMcpOptions,
): McpServer {
  const server = new McpServer(
    {
      name: "redlinify",
      version: "0.1.0",
    },
    {
      instructions: MCP_WORKFLOW_INSTRUCTIONS,
    },
  );

  const ensureViewUiUrl = async (viewId: string): Promise<string | undefined> => {
    if (!options?.ensureUi) return undefined;
    try {
      const ui = await options.ensureUi();
      return ui?.url ? viewDeepLink(ui.url, viewId) : undefined;
    } catch {
      return undefined;
    }
  };

  server.tool(
    "get_workspace_status",
    "Inspect all diagram tabs (with view_hash, triage counts, drifted counts, human edit flags), pending view_requests, and existing entity_ref slugs.",
    {},
    async () => {
      try {
        const status = await storage.getWorkspaceStatus();
        const ui_url = options?.getRunningUiUrl
          ? await options.getRunningUiUrl().catch(() => null)
          : null;
        return okResult({
          ...status,
          ...(ui_url ? { ui_url } : {}),
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.tool(
    "open_workbench",
    "Ensure the local Redlinify browser workbench UI is running for this repo (auto-starting a detached loopback server if needed) and optionally open it in the user's browser.",
    {
      view_id: idSlugSchema("view_id").optional(),
      open_browser: z.boolean().optional(),
    },
    async ({ view_id, open_browser }) => {
      try {
        if (!options?.ensureUi) {
          return okResult({
            available: false,
            message:
              "UI auto-start is disabled (--no-ui). Launch the workbench manually with `redlinify ui`.",
          });
        }
        const res = await options.ensureUi({
          openBrowser: open_browser ?? true,
        });
        if (!res) {
          return okResult({
            available: false,
            message: "UI workbench did not return a URL.",
          });
        }
        const url = view_id ? viewDeepLink(res.url, view_id) : res.url;
        return okResult({
          available: true,
          url,
          started: res.started,
          browser_opened: Boolean(res.browser_opened),
        });
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
    "Create or replace a semantic DesignView (auto-initializes .design/ and ensures the local workbench UI is running). Requires base_hash when updating an existing view (unless force=true), preserves existing code_refs when omitted, and rejects mutating/deleting/unlocking locked nodes or edges.",
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
        const ui_url = await ensureViewUiUrl(res.view.id);
        return okResult({
          ...res,
          ...(ui_url ? { ui_url } : {}),
        });
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
        const ui_url = await ensureViewUiUrl(res.view.id);
        return okResult({
          ...res,
          ...(ui_url ? { ui_url } : {}),
        });
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
    "Create an anchored thread (question, change_request, decision, drift_alert) or append an agent reply. When resolve=true, requires a concise 1-line resolution_summary saved under Decisions (ADRs).",
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
    "Retrieve full message transcripts of resolved Decision (ADR) threads matching target_id, entity_ref, view_id, or search query.",
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
