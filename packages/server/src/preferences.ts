import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  UserPreferencesSchema,
  withFileLock,
  writeJsonAtomic,
  type UserPreferences,
} from "@redlinify/shared";

export function resolvePreferencesPath(overridePath?: string): string {
  if (overridePath?.trim()) {
    return path.resolve(overridePath);
  }
  const envPath = process.env.REDLINIFY_PREFERENCES_PATH?.trim();
  if (envPath) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), ".redlinify", "preferences.json");
}

function normalizePreferences(raw: unknown): UserPreferences {
  const parsed = UserPreferencesSchema.safeParse(raw);
  if (!parsed.success) {
    return {};
  }
  const out: UserPreferences = {};
  if (parsed.data.theme !== undefined) out.theme = parsed.data.theme;
  if (parsed.data.bg_pattern !== undefined) out.bg_pattern = parsed.data.bg_pattern;
  if (parsed.data.scroll_mode !== undefined) {
    out.scroll_mode = parsed.data.scroll_mode;
  }
  return out;
}

export async function readUserPreferences(
  overridePath?: string,
): Promise<UserPreferences> {
  const filePath = resolvePreferencesPath(overridePath);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return {};
  }
  try {
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function updateUserPreferences(
  patch: UserPreferences,
  overridePath?: string,
): Promise<UserPreferences> {
  const filePath = resolvePreferencesPath(overridePath);
  const parsedPatch = normalizePreferences(UserPreferencesSchema.parse(patch));

  return withFileLock(`${filePath}.lock`, async () => {
    const current = await readUserPreferences(filePath);
    const merged: UserPreferences = { ...current, ...parsedPatch };
    await writeJsonAtomic(filePath, merged);
    return merged;
  });
}
