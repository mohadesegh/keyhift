import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { KeyShiftConfig } from "./types.js";

export const appDir = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), ".config"),
  "keyshift"
);

export const configPath = path.join(appDir, "config.json");
export const pidPath = path.join(appDir, "keyshift.pid");
export const logPath = path.join(appDir, "keyshift.log");

export const defaultConfig: KeyShiftConfig = {
  shortcut: "Control+Alt+K",

  layoutMode: "auto",

  sourceLayout: "00000409",
  targetLayout: "00000429",

  directionDetection: "hybrid",

  preserveClipboard: false,
  copyDelayMs: 150,
  pasteDelayMs: 120,

  selectAllText: true
};

export async function ensureAppDir(): Promise<void> {
  await mkdir(appDir, { recursive: true });
}

export async function loadConfig(): Promise<KeyShiftConfig> {
  await ensureAppDir();

  if (!existsSync(configPath)) {
    await saveConfig(defaultConfig);
    return { ...defaultConfig };
  }

  const raw = await readFile(configPath, "utf8");
  const jsonStart = raw.indexOf("{");

  if (jsonStart < 0) {
    await saveConfig(defaultConfig);
    return { ...defaultConfig };
  }

  try {
    const parsed = JSON.parse(
      raw.slice(jsonStart)
    ) as Partial<KeyShiftConfig>;

    return {
      ...defaultConfig,
      ...parsed
    };
  } catch {
    await saveConfig(defaultConfig);
    return { ...defaultConfig };
  }
}

export async function saveConfig(
  config: KeyShiftConfig
): Promise<void> {
  await ensureAppDir();

  await writeFile(
    configPath,
    JSON.stringify(config, null, 2),
    "utf8"
  );
}