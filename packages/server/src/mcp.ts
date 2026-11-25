import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod";
import {
  CardinalitySchema,
  CodeRefUpdateSchema,
  DesignEdgeSchema,
  DesignError,
  DesignNodeSchema,
  DesignStorage,
  DesignViewSchema,
  DiagramTypeSchema,
  EdgeStyleSchema,
  EntityRefSchema,
  NodeStatusSchema,
  RelationKindSchema,
  ThreadKindSchema,
  ThreadTargetTypeSchema,
  ValidationError,
  ViewDirectionSchema,
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

export const MCP_WORKFLOW_INSTRUCTIONS = `Redlinify is a Git-native architecture & ER workbench in .design/ (IDs: lowercase slugs a-z0-9_-; entity_ref: snake_case).
- Start every turn with get_workspace() to inspect tabs, entity_ref slugs, pending semantic diffs, view_requests, and open threads.
- Author/edit views with save_view(): mode="replace" to create or rewrite (diagram_type: "general" or "er"), mode="patch" for incremental updates, mode="acknowledge" to accept human edits as-is. Saving auto-starts the local UI and returns ui_url—share that link.
- Ask in the diagram: set node status="needs_input" and anchor a question via post_thread() instead of long chat essays.
- Respect violet locks: never mutate, delete, or unlock locked nodes/edges; resolve settled threads with a 1-line resolution_summary (Decisions), query history via get_decisions(), and link built code via sync_code_refs().`;

const WireCodeRefSchema = z.object({
  path: z.string(),
  symbol: z.string().optional(),
});

const WireSectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  items: z.array(z.string()),
});

const WireSectionOpSchema = z.object({
  op: z.enum(["add", "update", "remove"]),
  id: z.string(),
  index: z.number().int().nonnegative().optional(),
  heading: z.string().optional(),
  items: z.array(z.string()).optional(),
  add_items: z.array(z.string()).optional(),
  remove_items: z.array(z.string()).optional(),
});

const WireFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  pk: z.boolean().optional(),
  fk: z.boolean().optional(),
  unique: z.boolean().optional(),
  nullable: z.boolean().optional(),
  indexed: z.boolean().optional(),
  default_value: z.string().optional(),
  note: z.string().optional(),
});

const WireNodeSchema = z.object({
  id: z.string(),
  entity_ref: z.string().nullable().optional(),
  kind: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().nullable().optional(),
  status: NodeStatusSchema.optional(),
  locked: z.boolean().optional(),
  sections: z.array(WireSectionSchema).optional(),
  section_ops: z.array(WireSectionOpSchema).optional(),
  fields: z.array(WireFieldSchema).optional(),
  code_refs: z.array(WireCodeRefSchema).nullable().optional(),
});

const WireEdgeSchema = z.object({
  id: z.string(),
  source: z.string().optional(),
  target: z.string().optional(),
  label: z.string().nullable().optional(),
  step: z.number().int().positive().nullable().optional(),
  style: EdgeStyleSchema.nullable().optional(),
  locked: z.boolean().nullable().optional(),
  source_cardinality: CardinalitySchema.nullable().optional(),
  target_cardinality: CardinalitySchema.nullable().optional(),
  relation_kind: RelationKindSchema.nullable().optional(),
});

function okResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data),
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
          text: JSON.stringify({
            error: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          }),
        },
      ],
    };
  }
  if (err instanceof ZodError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "VALIDATION_ERROR",
            message: err.message,
            details: err.issues,
          }),
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        }),
      },
    ],
  };
}

function viewDeepLink(baseUrl: string, viewId: string): string {
  return `${baseUrl}/#view=${encodeURIComponent(viewId)}`;
}

function normalizeNodePatch(rawNode: z.infer<typeof WireNodeSchema>) {
  if (!rawNode.section_ops?.length) {
    return rawNode;
  }
  return {
    ...rawNode,
    section_ops: rawNode.section_ops.map((op) => {
      if (op.op === "add") {
        return {
          op: "add" as const,
          section: {
            id: op.id,
            heading: op.heading ?? "",
            items: op.items ?? [],
          },
          ...(op.index !== undefined ? { index: op.index } : {}),
        };
      }
      if (op.op === "update") {
        return {
          op: "update" as const,
          id: op.id,
          ...(op.heading !== undefined ? { heading: op.heading } : {}),
          ...(op.items !== undefined ? { items: op.items } : {}),
          ...(op.add_items !== undefined ? { add_items: op.add_items } : {}),
          ...(op.remove_items !== undefined ? { remove_items: op.remove_items } : {}),
        };
      }
      return {
        op: "remove" as const,
        id: op.id,
      };
    }),
  };
}

function omitNullFields<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function createRedlinifyMcpServer(
  storage: DesignStorage,
  options?: RedlinifyMcpOptions,
): McpServer {
  const server = new McpServer(
    {
      name: "redlinify",
      version: "0.2.0",
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

  server.registerTool(
    "get_workspace",
    {
      description:
        "Inspect workspace tabs (view_hash, triage/drifted counts), entity_ref slugs, pending semantic diffs, view_requests, and open threads awaiting agent response. Set include_diff=false for status only, or open_browser=true to launch the UI.",
      inputSchema: {
        view_id: z.string().optional(),
        include_diff: z.boolean().optional(),
        open_browser: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ view_id, include_diff, open_browser }) => {
      try {
        const validViewId = view_id ? idSlugSchema("view_id").parse(view_id) : undefined;
        const status = await storage.getWorkspaceStatus();
        const feedback =
          include_diff === false ? null : await storage.getPendingFeedback(validViewId);

        let uiFields: Record<string, unknown> = {};
        if (open_browser) {
          if (!options?.ensureUi) {
            uiFields = { ui_available: false };
          } else {
            const ui = await options.ensureUi({ openBrowser: true });
            if (ui?.url) {
              uiFields = {
                ui_available: true,
                ui_url: validViewId ? viewDeepLink(ui.url, validViewId) : ui.url,
                ui_started: ui.started,
                browser_opened: Boolean(ui.browser_opened),
              };
            } else {
              uiFields = { ui_available: false };
            }
          }
        } else if (options?.getRunningUiUrl) {
          const runningUrl = await options.getRunningUiUrl().catch(() => null);
          if (runningUrl) {
            uiFields = {
              ui_url: validViewId ? viewDeepLink(runningUrl, validViewId) : runningUrl,
            };
          }
        }

        return okResult({
          ...status,
          ...(feedback
            ? {
                view_diffs: feedback.view_diffs,
                view_hashes: feedback.view_hashes,
                pending_threads: feedback.pending_threads,
              }
            : {}),
          ...uiFields,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "get_view",
    {
      description:
        "Read a semantic DesignView (zero coordinates), view_hash, open threads, and optional 1-line ADR resolution summaries.",
      inputSchema: {
        view_id: z.string(),
        include_resolved_summaries: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ view_id, include_resolved_summaries }) => {
      try {
        const validViewId = idSlugSchema("view_id").parse(view_id);
        const [{ view, view_hash }, open_threads] = await Promise.all([
          storage.readView(validViewId),
          storage.listThreads({ view_id: validViewId, status: "open" }),
        ]);

        if (!include_resolved_summaries) {
          return okResult({ view, view_hash, open_threads });
        }

        const resolvedThreads = await storage.listThreads({
          view_id: validViewId,
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

  server.registerTool(
    "get_decisions",
    {
      description:
        "Query resolved Decision (ADR) transcripts—or open/all threads via status—filtered by view_id, target_id, entity_ref, or query.",
      inputSchema: {
        view_id: z.string().optional(),
        target_id: z.string().optional(),
        entity_ref: z.string().optional(),
        query: z.string().optional(),
        status: z.enum(["resolved", "open", "all"]).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ view_id, target_id, entity_ref, query, status }) => {
      try {
        const threads = await storage.listThreads({
          status: status === "all" ? undefined : (status ?? "resolved"),
          view_id: view_id ? idSlugSchema("view_id").parse(view_id) : undefined,
          target_id: target_id ? idSlugSchema("target_id").parse(target_id) : undefined,
          entity_ref: entity_ref ? EntityRefSchema.parse(entity_ref) : undefined,
          query,
        });
        return okResult({ threads });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "save_view",
    {
      description:
        'Create, patch, or acknowledge a DesignView (auto-initializes .design/ & starts the local UI). mode="replace" writes full nodes/edges; mode="patch" upserts nodes/edges by id (supports section_ops & null clears) and applies remove_nodes/remove_edges; mode="acknowledge" advances checkpoints.',
      inputSchema: {
        view_id: z.string().optional(),
        mode: z.enum(["replace", "patch", "acknowledge"]).optional(),
        base_hash: z.string().optional(),
        title: z.string().optional(),
        diagram_type: DiagramTypeSchema.optional(),
        direction: ViewDirectionSchema.optional(),
        nodes: z.array(WireNodeSchema).optional(),
        edges: z.array(WireEdgeSchema).optional(),
        remove_nodes: z.array(z.string()).optional(),
        remove_edges: z.array(z.string()).optional(),
        fulfill_request_id: z.string().optional(),
        force: z.boolean().optional(),
        acknowledge_views: z
          .array(z.object({ view_id: z.string(), base_hash: z.string() }))
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({
      view_id,
      mode,
      base_hash,
      title,
      diagram_type,
      direction,
      nodes,
      edges,
      remove_nodes,
      remove_edges,
      fulfill_request_id,
      force,
      acknowledge_views,
    }) => {
      try {
        const resolvedMode =
          mode ?? (acknowledge_views?.length ? "acknowledge" : "replace");

        if (resolvedMode === "acknowledge") {
          const entries =
            acknowledge_views && acknowledge_views.length > 0
              ? acknowledge_views
              : view_id && base_hash
                ? [{ view_id, base_hash }]
                : null;
          if (!entries) {
            throw new ValidationError(
              "Provide acknowledge_views or view_id + base_hash for save_view mode='acknowledge'",
            );
          }
          const validatedEntries = entries.map((e) => ({
            view_id: idSlugSchema("view_id").parse(e.view_id),
            base_hash: z.string().min(1, "base_hash is required").parse(e.base_hash),
          }));
          const res = await storage.acknowledgeFeedback(validatedEntries);
          return okResult({ mode: "acknowledge", ...res });
        }

        if (!view_id) {
          throw new ValidationError("view_id is required for save_view");
        }
        const validViewId = idSlugSchema("view_id").parse(view_id);

        if (resolvedMode === "patch") {
          if (!base_hash) {
            throw new ValidationError(
              "base_hash is required for save_view mode='patch'",
            );
          }
          const { view: currentView } = await storage.readView(validViewId);
          const existingNodeIds = new Set(currentView.nodes.map((n) => n.id));
          const existingEdgeIds = new Set(currentView.edges.map((e) => e.id));

          const add_nodes = [];
          const update_nodes = [];
          for (const rawNode of nodes ?? []) {
            const validNodeId = idSlugSchema("node.id").parse(rawNode.id);
            if (existingNodeIds.has(validNodeId)) {
              update_nodes.push(normalizeNodePatch(rawNode));
            } else {
              add_nodes.push(DesignNodeSchema.parse(omitNullFields(rawNode)));
            }
          }

          const add_edges = [];
          const update_edges = [];
          for (const rawEdge of edges ?? []) {
            const validEdgeId = idSlugSchema("edge.id").parse(rawEdge.id);
            if (existingEdgeIds.has(validEdgeId)) {
              update_edges.push(rawEdge);
            } else {
              add_edges.push(DesignEdgeSchema.parse(omitNullFields(rawEdge)));
            }
          }

          const meta =
            title !== undefined || direction !== undefined || diagram_type !== undefined
              ? {
                  ...(title !== undefined ? { title } : {}),
                  ...(direction !== undefined ? { direction } : {}),
                  ...(diagram_type !== undefined ? { diagram_type } : {}),
                }
              : undefined;

          const parsedPatch = ViewPatchSchema.parse({
            ...(meta ? { meta } : {}),
            ...(add_nodes.length > 0 ? { add_nodes } : {}),
            ...(update_nodes.length > 0 ? { update_nodes } : {}),
            ...(remove_nodes?.length ? { remove_nodes } : {}),
            ...(add_edges.length > 0 ? { add_edges } : {}),
            ...(update_edges.length > 0 ? { update_edges } : {}),
            ...(remove_edges?.length ? { remove_edges } : {}),
          });

          const res = await storage.patchView({
            view_id: validViewId,
            base_hash,
            patch: parsedPatch,
            actor: "agent",
          });
          const ui_url = await ensureViewUiUrl(res.view.id);
          return okResult({
            mode: "patch",
            view_id: res.view.id,
            view_hash: res.view_hash,
            node_count: res.view.nodes.length,
            edge_count: res.view.edges.length,
            ...(ui_url ? { ui_url } : {}),
          });
        }

        if (!title || !title.trim()) {
          throw new ValidationError(
            "title is required when calling save_view in mode='replace'",
          );
        }

        const sanitizedView = DesignViewSchema.parse({
          id: validViewId,
          title,
          diagram_type: diagram_type ?? "general",
          direction: direction ?? "TB",
          nodes: (nodes ?? []).map((n) => omitNullFields(n)),
          edges: (edges ?? []).map((e) => omitNullFields(e)),
        });

        const res = await storage.upsertView({
          view: sanitizedView,
          base_hash,
          fulfill_request_id: fulfill_request_id
            ? idSlugSchema("fulfill_request_id").parse(fulfill_request_id)
            : undefined,
          actor: "agent",
          force,
        });
        const ui_url = await ensureViewUiUrl(res.view.id);
        return okResult({
          mode: "replace",
          view_id: res.view.id,
          view_hash: res.view_hash,
          created: res.created,
          node_count: res.view.nodes.length,
          edge_count: res.view.edges.length,
          ...(ui_url ? { ui_url } : {}),
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "post_thread",
    {
      description:
        "Create an anchored thread (question, change_request, decision, drift_alert) or reply; resolve=true requires a 1-line resolution_summary (Decisions).",
      inputSchema: {
        thread_id: z.string().optional(),
        target_type: ThreadTargetTypeSchema.optional(),
        view_id: z.string().optional(),
        target_id: z.string().optional(),
        entity_ref: z.string().optional(),
        kind: ThreadKindSchema.optional(),
        body: z.string(),
        resolve: z.boolean().optional(),
        reopen: z.boolean().optional(),
        resolution_summary: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      try {
        const thread = await storage.postThreadMessage({
          thread_id: args.thread_id
            ? idSlugSchema("thread_id").parse(args.thread_id)
            : undefined,
          target_type: args.target_type,
          view_id: args.view_id ? idSlugSchema("view_id").parse(args.view_id) : undefined,
          target_id: args.target_id
            ? idSlugSchema("target_id").parse(args.target_id)
            : undefined,
          entity_ref: args.entity_ref
            ? EntityRefSchema.parse(args.entity_ref)
            : undefined,
          kind: args.kind,
          body: z.string().trim().min(1, "body is required").parse(args.body),
          resolve: args.resolve,
          reopen: args.reopen,
          resolution_summary: args.resolution_summary,
          author: "agent",
        });
        return okResult({ thread });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  server.registerTool(
    "sync_code_refs",
    {
      description:
        "Link source code_refs and status ('implemented' | 'drifted') onto nodes (including locked nodes) without clobbering unrelated pending human edits.",
      inputSchema: {
        view_id: z.string(),
        updates: z.array(
          z.object({
            node_id: z.string(),
            status: z.enum(["implemented", "drifted"]),
            code_refs: z.array(WireCodeRefSchema),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ view_id, updates }) => {
      try {
        if (updates.length === 0) {
          throw new ValidationError("updates must contain at least one entry");
        }
        const parsedUpdates = updates.map((u) => CodeRefUpdateSchema.parse(u));
        const res = await storage.syncCodeRefs({ view_id, updates: parsedUpdates });
        return okResult({
          view_id: res.view.id,
          view_hash: res.view_hash,
          updated_node_ids: res.updated_node_ids,
        });
      } catch (err) {
        return errResult(err);
      }
    },
  );

  return server;
}
