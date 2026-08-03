import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { KeyShiftConfig } from "./types.js";

function getConfigRoot(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ??
      path.join(os.homedir(), "AppData", "Roaming");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }

  return process.env.XDG_CONFIG_HOME ??
    path.join(os.homedir(), ".config");
}

export const appDir = path.join(getConfigRoot(), "keyshift");

export const configPath = path.join(appDir, "config.json");
export const pidPath = path.join(appDir, "keyshift.pid");
export const logPath = path.join(appDir, "keyshift.log");

export function getDefaultShortcut(
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "darwin") {
    return "Command+Shift+K";
  }

  if (platform === "linux") {
    return "Control+Shift+K";
  }

  return "Control+Alt+K";
}

export function getDefaultLanguageSwitchShortcut(
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "darwin") {
    return "Control+Space";
  }

  if (platform === "linux") {
    return "Meta+Space";
  }

  return "";
}

export const defaultConfig: KeyShiftConfig = {
  shortcut: getDefaultShortcut(),

  layoutMode: "auto",

  sourceLayout: process.platform === "win32" ? "00000409" : "en-US",
  targetLayout: process.platform === "win32" ? "00000429" : "fa-IR",

  directionDetection: "hybrid",

  preserveClipboard: false,
  copyDelayMs: 150,
  pasteDelayMs: 120,

  selectAllText: true,

  switchInputLanguage: process.platform !== "win32",
  languageSwitchShortcut: getDefaultLanguageSwitchShortcut()
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
