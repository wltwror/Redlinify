export interface LockViolation {
  target_type: "node" | "edge";
  id: string;
  title?: string;
  reason: "deleted" | "unlocked" | "modified";
  fields?: string[];
}

export class DesignError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class LockViolationError extends DesignError {
  readonly violations: LockViolation[];

  constructor(violations: LockViolation[], message?: string) {
    const summary = violations
      .map((v) =>
        v.fields?.length
          ? `${v.target_type} '${v.id}' (${v.reason}: ${v.fields.join(", ")})`
          : `${v.target_type} '${v.id}' (${v.reason})`,
      )
      .join("; ");
    super(
      "LOCK_VIOLATION",
      message ??
        `Cannot mutate locked design elements: ${summary}. Open a 'question' thread via post_thread_message instead.`,
      { violations },
    );
    this.violations = violations;
  }
}

export class ConcurrencyConflictError extends DesignError {
  readonly view_id: string;
  readonly expected_hash: string | null;
  readonly actual_hash: string;

  constructor(
    view_id: string,
    expected_hash: string | null,
    actual_hash: string,
    message?: string,
  ) {
    super(
      "CONCURRENCY_CONFLICT",
      message ??
        `View '${view_id}' changed on disk (expected base_hash=${expected_hash ?? "<missing>"}, actual=${actual_hash}). Call get_pending_feedback or get_view before retrying.`,
      { view_id, expected_hash, actual_hash },
    );
    this.view_id = view_id;
    this.expected_hash = expected_hash;
    this.actual_hash = actual_hash;
  }
}

export class NotFoundError extends DesignError {
  constructor(message: string, details?: unknown) {
    super("NOT_FOUND", message, details);
  }
}

export class ValidationError extends DesignError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, details);
  }
}
