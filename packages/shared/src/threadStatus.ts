import type { DesignThread } from "./schemas.js";

export function isThreadWaitingOnAgent(thread: DesignThread): boolean {
  if (thread.status !== "open") return false;
  const lastMsg = thread.messages[thread.messages.length - 1];
  return lastMsg?.author === "human";
}

export function isThreadWaitingOnHuman(thread: DesignThread): boolean {
  if (thread.status !== "open") return false;
  const lastMsg = thread.messages[thread.messages.length - 1];
  return lastMsg?.author === "agent";
}

export function isThreadPendingForAgent(thread: DesignThread): boolean {
  if (thread.status !== "open") return false;
  return isThreadWaitingOnAgent(thread) || thread.kind === "drift_alert";
}
