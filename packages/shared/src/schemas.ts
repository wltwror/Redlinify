import { z } from "zod";

export const ID_SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
export const ENTITY_REF_REGEX = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function idSlugSchema(label = "id") {
  return z
    .string()
    .min(1, `${label} is required`)
    .max(128, `${label} must be at most 128 characters`)
    .regex(
      ID_SLUG_REGEX,
      `${label} must match ${ID_SLUG_REGEX.source} (lowercase alphanumeric, '-', '_')`,
    );
}

export const EntityRefSchema = z
  .string()
  .min(1, "entity_ref must not be empty")
  .max(128, "entity_ref must be at most 128 characters")
  .regex(
    ENTITY_REF_REGEX,
    "entity_ref must be canonical snake_case (lowercase letters, digits, '_')",
  );

export const NodeStatusSchema = z.enum([
  "draft",
  "needs_input",
  "approved",
  "implemented",
  "drifted",
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const CodeRefSchema = z.object({
  path: z.string().trim().min(1, "code_ref.path is required"),
  symbol: z.string().trim().min(1, "code_ref.symbol must not be empty").optional(),
});
export type CodeRef = z.infer<typeof CodeRefSchema>;

export const BoxSectionSchema = z.object({
  id: idSlugSchema("section.id"),
  heading: z.string().trim().min(1, "section.heading is required"),
  items: z.array(z.string()),
});
export type BoxSection = z.infer<typeof BoxSectionSchema>;

export const DesignNodeSchema = z.object({
  id: idSlugSchema("node.id"),
  entity_ref: EntityRefSchema.optional(),
  kind: z.string().trim().min(1, "node.kind is required"),
  title: z.string().trim().min(1, "node.title is required"),
  summary: z.string().optional(),
  status: NodeStatusSchema.default("draft"),
  locked: z.boolean().default(false),
  sections: z.array(BoxSectionSchema).default([]),
  code_refs: z.array(CodeRefSchema).optional(),
});
export type DesignNode = z.infer<typeof DesignNodeSchema>;

export const EdgeStyleSchema = z.enum(["solid", "dashed"]);
export type EdgeStyle = z.infer<typeof EdgeStyleSchema>;

export const DesignEdgeSchema = z.object({
  id: idSlugSchema("edge.id"),
  source: idSlugSchema("edge.source"),
  target: idSlugSchema("edge.target"),
  label: z.string().optional(),
  step: z.number().int().positive("edge.step must be a positive integer").optional(),
  style: EdgeStyleSchema.optional(),
  locked: z.boolean().optional(),
});
export type DesignEdge = z.infer<typeof DesignEdgeSchema>;

export const ViewDirectionSchema = z.enum(["TB", "LR"]);
export type ViewDirection = z.infer<typeof ViewDirectionSchema>;

export const ActorRoleSchema = z.enum(["agent", "human"]);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

export const DesignViewSchema = z
  .object({
    id: idSlugSchema("view.id"),
    title: z.string().trim().min(1, "view.title is required"),
    direction: ViewDirectionSchema.default("TB"),
    created_by: ActorRoleSchema.optional(),
    nodes: z.array(DesignNodeSchema).default([]),
    edges: z.array(DesignEdgeSchema).default([]),
  })
  .superRefine((view, ctx) => {
    const nodeIds = new Set<string>();
    view.nodes.forEach((node, nodeIdx) => {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", nodeIdx, "id"],
          message: `Duplicate node id '${node.id}' in view '${view.id}'`,
        });
      }
      nodeIds.add(node.id);

      const sectionIds = new Set<string>();
      node.sections.forEach((section, secIdx) => {
        if (sectionIds.has(section.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", nodeIdx, "sections", secIdx, "id"],
            message: `Duplicate section id '${section.id}' in node '${node.id}'`,
          });
        }
        sectionIds.add(section.id);
      });
    });

    const edgeIds = new Set<string>();
    view.edges.forEach((edge, edgeIdx) => {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", edgeIdx, "id"],
          message: `Duplicate edge id '${edge.id}' in view '${view.id}'`,
        });
      }
      edgeIds.add(edge.id);

      if (!nodeIds.has(edge.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", edgeIdx, "source"],
          message: `Edge '${edge.id}' references missing source node '${edge.source}'`,
        });
      }
      if (!nodeIds.has(edge.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", edgeIdx, "target"],
          message: `Edge '${edge.id}' references missing target node '${edge.target}'`,
        });
      }
    });
  });
export type DesignView = z.infer<typeof DesignViewSchema>;

export const WorkspaceTabSchema = z.object({
  view_id: idSlugSchema("tab.view_id"),
  title: z.string().trim().min(1, "tab.title is required"),
  description: z.string().optional(),
  order: z.number().int().nonnegative(),
});
export type WorkspaceTab = z.infer<typeof WorkspaceTabSchema>;

export const ViewRequestSchema = z.object({
  id: idSlugSchema("view_request.id"),
  title: z.string().trim().min(1, "view_request.title is required"),
  prompt: z.string().trim().min(1, "view_request.prompt is required"),
  created_at: z.string().min(1),
});
export type ViewRequest = z.infer<typeof ViewRequestSchema>;

export const WorkspaceFileSchema = z
  .object({
    version: z.literal(1),
    project_name: z.string().trim().min(1, "project_name is required"),
    tabs: z.array(WorkspaceTabSchema).default([]),
    view_requests: z.array(ViewRequestSchema).default([]),
  })
  .superRefine((ws, ctx) => {
    const tabIds = new Set<string>();
    ws.tabs.forEach((tab, idx) => {
      if (tabIds.has(tab.view_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tabs", idx, "view_id"],
          message: `Duplicate workspace tab view_id '${tab.view_id}'`,
        });
      }
      tabIds.add(tab.view_id);
    });

    const reqIds = new Set<string>();
    ws.view_requests.forEach((req, idx) => {
      if (reqIds.has(req.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["view_requests", idx, "id"],
          message: `Duplicate view_request id '${req.id}'`,
        });
      }
      reqIds.add(req.id);
    });
  });
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

export const ThreadMessageSchema = z.object({
  id: idSlugSchema("message.id"),
  author: ActorRoleSchema,
  body: z.string().trim().min(1, "message.body is required"),
  created_at: z.string().min(1),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export const ThreadTargetTypeSchema = z.enum([
  "workspace",
  "view",
  "node",
  "edge",
]);
export type ThreadTargetType = z.infer<typeof ThreadTargetTypeSchema>;

export const ThreadKindSchema = z.enum([
  "question",
  "change_request",
  "decision",
  "drift_alert",
]);
export type ThreadKind = z.infer<typeof ThreadKindSchema>;

export const ThreadStatusSchema = z.enum(["open", "resolved"]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const DesignThreadSchema = z
  .object({
    id: idSlugSchema("thread.id"),
    target_type: ThreadTargetTypeSchema,
    view_id: idSlugSchema("thread.view_id").optional(),
    target_id: idSlugSchema("thread.target_id").optional(),
    entity_ref: EntityRefSchema.optional(),
    kind: ThreadKindSchema,
    status: ThreadStatusSchema.default("open"),
    resolution_summary: z.string().optional(),
    messages: z
      .array(ThreadMessageSchema)
      .min(1, "thread must contain at least one message"),
  })
  .superRefine((thread, ctx) => {
    if (
      (thread.target_type === "view" ||
        thread.target_type === "node" ||
        thread.target_type === "edge") &&
      !thread.view_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["view_id"],
        message: `view_id is required when target_type is '${thread.target_type}'`,
      });
    }
    if (
      (thread.target_type === "node" || thread.target_type === "edge") &&
      !thread.target_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target_id"],
        message: `target_id is required when target_type is '${thread.target_type}'`,
      });
    }
  });
export type DesignThread = z.infer<typeof DesignThreadSchema>;

export const ViewLayoutSchema = z.object({
  positions: z
    .record(
      z.string(),
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
      }),
    )
    .default({}),
  viewport: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      zoom: z.number().positive().finite(),
    })
    .optional(),
});
export type ViewLayout = z.infer<typeof ViewLayoutSchema>;

export const SectionPatchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    section: BoxSectionSchema,
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({
    op: z.literal("update"),
    id: idSlugSchema("section.id"),
    heading: z.string().trim().min(1).optional(),
    items: z.array(z.string()).optional(),
    add_items: z.array(z.string()).optional(),
    remove_items: z.array(z.string()).optional(),
  }),
  z.object({
    op: z.literal("remove"),
    id: idSlugSchema("section.id"),
  }),
]);
export type SectionPatchOp = z.infer<typeof SectionPatchOpSchema>;

export const NodeUpdatePatchSchema = z.object({
  id: idSlugSchema("node.id"),
  entity_ref: EntityRefSchema.nullable().optional(),
  kind: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  summary: z.string().nullable().optional(),
  status: NodeStatusSchema.optional(),
  locked: z.boolean().optional(),
  sections: z.array(BoxSectionSchema).optional(),
  section_ops: z.array(SectionPatchOpSchema).optional(),
  code_refs: z.array(CodeRefSchema).nullable().optional(),
});
export type NodeUpdatePatch = z.infer<typeof NodeUpdatePatchSchema>;

export const EdgeUpdatePatchSchema = z.object({
  id: idSlugSchema("edge.id"),
  source: idSlugSchema("edge.source").optional(),
  target: idSlugSchema("edge.target").optional(),
  label: z.string().nullable().optional(),
  step: z.number().int().positive().nullable().optional(),
  style: EdgeStyleSchema.nullable().optional(),
  locked: z.boolean().nullable().optional(),
});
export type EdgeUpdatePatch = z.infer<typeof EdgeUpdatePatchSchema>;

export const ViewPatchSchema = z.object({
  meta: z
    .object({
      title: z.string().trim().min(1).optional(),
      direction: ViewDirectionSchema.optional(),
    })
    .optional(),
  add_nodes: z.array(DesignNodeSchema).optional(),
  update_nodes: z.array(NodeUpdatePatchSchema).optional(),
  remove_nodes: z.array(idSlugSchema("node.id")).optional(),
  add_edges: z.array(DesignEdgeSchema).optional(),
  update_edges: z.array(EdgeUpdatePatchSchema).optional(),
  remove_edges: z.array(idSlugSchema("edge.id")).optional(),
});
export type ViewPatch = z.infer<typeof ViewPatchSchema>;

export const CodeRefUpdateSchema = z.object({
  node_id: idSlugSchema("node_id"),
  status: z.enum(["implemented", "drifted"]),
  code_refs: z.array(CodeRefSchema),
});
export type CodeRefUpdate = z.infer<typeof CodeRefUpdateSchema>;
