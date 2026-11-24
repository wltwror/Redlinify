import { describe, expect, it } from "vitest";
import {
  LockViolationError,
  ValidationError,
  applyViewPatch,
  checkLockViolations,
  mergePreservedCodeRefs,
  type DesignView,
} from "../src/index.js";

function makeLockedView(): DesignView {
  return {
    id: "classes",
    title: "Classes",
    direction: "TB",
    nodes: [
      {
        id: "auth_service",
        entity_ref: "auth_service",
        kind: "Class",
        title: "AuthService",
        summary: "Handles tokens",
        status: "approved",
        locked: true,
        sections: [
          {
            id: "methods",
            heading: "Methods",
            items: ["verify(jwt: string): Claims"],
          },
        ],
        code_refs: [{ path: "src/auth.ts", symbol: "AuthService" }],
      },
      {
        id: "token_store",
        kind: "Store",
        title: "TokenStore",
        status: "draft",
        locked: false,
        sections: [{ id: "fields", heading: "Fields", items: ["ttl: number"] }],
      },
    ],
    edges: [
      {
        id: "e_auth_store",
        source: "auth_service",
        target: "token_store",
        label: "checks revocation",
        step: 1,
        style: "solid",
        locked: true,
      },
    ],
  };
}

describe("lock guards & view patching", () => {
  it("detects locked node deletion, unlocking, and spec modifications", () => {
    const existing = makeLockedView();

    const deleted = structuredClone(existing);
    deleted.nodes = [deleted.nodes[1]!];
    deleted.edges = [];
    expect(checkLockViolations(existing, deleted)).toEqual([
      {
        target_type: "node",
        id: "auth_service",
        title: "AuthService",
        reason: "deleted",
      },
      {
        target_type: "edge",
        id: "e_auth_store",
        reason: "deleted",
      },
    ]);

    const unlocked = structuredClone(existing);
    unlocked.nodes[0]!.locked = false;
    unlocked.edges[0]!.locked = false;
    expect(checkLockViolations(existing, unlocked)).toEqual([
      {
        target_type: "node",
        id: "auth_service",
        title: "AuthService",
        reason: "unlocked",
      },
      {
        target_type: "edge",
        id: "e_auth_store",
        reason: "unlocked",
      },
    ]);

    const modified = structuredClone(existing);
    modified.nodes[0]!.title = "AuthManager";
    modified.nodes[0]!.sections[0]!.items.push("revoke(id: string): void");
    modified.edges[0]!.label = "mutates";
    expect(checkLockViolations(existing, modified)).toEqual([
      {
        target_type: "node",
        id: "auth_service",
        title: "AuthService",
        reason: "modified",
        fields: ["title", "sections"],
      },
      {
        target_type: "edge",
        id: "e_auth_store",
        reason: "modified",
        fields: ["label"],
      },
    ]);
  });

  it("permits status and code_refs changes only when allowCodeRefSync is enabled", () => {
    const existing = makeLockedView();
    const synced = structuredClone(existing);
    synced.nodes[0]!.status = "implemented";
    synced.nodes[0]!.code_refs = [
      { path: "src/auth/service.ts", symbol: "AuthService" },
    ];

    expect(checkLockViolations(existing, synced)).toHaveLength(1);
    expect(
      checkLockViolations(existing, synced, { allowCodeRefSync: true }),
    ).toEqual([]);

    // Still catches spec changes even with allowCodeRefSync
    synced.nodes[0]!.summary = "Changed summary";
    expect(
      checkLockViolations(existing, synced, { allowCodeRefSync: true }),
    ).toEqual([
      {
        target_type: "node",
        id: "auth_service",
        title: "AuthService",
        reason: "modified",
        fields: ["summary"],
      },
    ]);
  });

  it("preserves existing code_refs when omitted in incoming view", () => {
    const existing = makeLockedView();
    const incoming = structuredClone(existing);
    delete incoming.nodes[0]!.code_refs;

    const merged = mergePreservedCodeRefs(existing, incoming);
    expect(merged.nodes[0]!.code_refs).toEqual([
      { path: "src/auth.ts", symbol: "AuthService" },
    ]);
  });

  it("applies incremental ViewPatch operations cleanly", () => {
    const existing = makeLockedView();
    const patched = applyViewPatch(existing, {
      meta: { direction: "LR" },
      add_nodes: [
        {
          id: "audit_log",
          kind: "Store",
          title: "AuditLog",
          status: "draft",
          locked: false,
          sections: [],
        },
      ],
      update_nodes: [
        {
          id: "token_store",
          status: "approved",
          section_ops: [
            {
              op: "update",
              id: "fields",
              add_items: ["driver: redis"],
            },
            {
              op: "add",
              section: {
                id: "methods",
                heading: "Methods",
                items: ["isRevoked(jti: string): boolean"],
              },
            },
          ],
        },
      ],
      add_edges: [
        {
          id: "e_auth_audit",
          source: "auth_service",
          target: "audit_log",
          label: "logs",
          style: "dashed",
        },
      ],
    });

    expect(patched.direction).toBe("LR");
    expect(patched.nodes.map((n) => n.id)).toEqual([
      "auth_service",
      "token_store",
      "audit_log",
    ]);
    expect(patched.nodes[1]?.sections).toHaveLength(2);
    expect(patched.nodes[1]?.sections[0]?.items).toEqual([
      "ttl: number",
      "driver: redis",
    ]);
    expect(patched.edges).toHaveLength(2);
  });

  it("cascades unlocked incident edges on remove_nodes but rejects locked incident edges", () => {
    const viewWithLockedEdge = makeLockedView();
    expect(() =>
      applyViewPatch(viewWithLockedEdge, {
        remove_nodes: ["token_store"],
      }),
    ).toThrow(LockViolationError);

    const viewWithUnlockedEdge = makeLockedView();
    viewWithUnlockedEdge.edges[0]!.locked = false;
    const afterRemove = applyViewPatch(viewWithUnlockedEdge, {
      remove_nodes: ["token_store"],
    });
    expect(afterRemove.nodes.map((n) => n.id)).toEqual(["auth_service"]);
    expect(afterRemove.edges).toEqual([]);
  });

  it("rejects patches that introduce dangling edges or conflicting section options", () => {
    const existing = makeLockedView();
    expect(() =>
      applyViewPatch(existing, {
        add_edges: [{ id: "bad", source: "auth_service", target: "ghost" }],
      }),
    ).toThrow(ValidationError);

    expect(() =>
      applyViewPatch(existing, {
        update_nodes: [
          {
            id: "token_store",
            sections: [],
            section_ops: [{ op: "remove", id: "fields" }],
          },
        ],
      }),
    ).toThrow(ValidationError);
  });
});
