#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";

import { existsSync } from "node:fs";

import { copyFile, readFile, rm, writeFile } from "node:fs/promises";

import path from "node:path";

import {
	appDir,
	configPath,
	defaultConfig,
	ensureAppDir,
	loadConfig,
	logPath,
	pidPath,
	saveConfig,
} from "./config.js";

import type {
	DirectionDetection,
	KeyShiftConfig,
	LayoutMode,
} from "./types.js";

const packageRoot = path.resolve(__dirname, "..");

const packagedHostExePath = path.join(
	packageRoot,
	"native",
	"keyshift-host.exe",
);

const hostSourcePath = path.join(packageRoot, "native", "KeyShiftHost.cs");

const installedHostExePath = path.join(appDir, "keyshift-host.exe");

function printHelp(): void {
	console.log(`
KeyShift CLI

Usage:
  keyshift <command>

Commands:
  keyshift init
  keyshift start
  keyshift stop
  keyshift restart
  keyshift status
  keyshift layouts
  keyshift logs
  keyshift update-host
  keyshift config show
  keyshift config reset
  keyshift config set <key> <value>

Configuration keys:
  shortcut
  layoutMode
  sourceLayout
  targetLayout
  directionDetection
  preserveClipboard
  copyDelayMs
  pasteDelayMs
  selectAllText

Examples:
  keyshift init

  keyshift layouts

  keyshift config set shortcut Control+Alt+K
  keyshift config set layoutMode auto
  keyshift config set sourceLayout 00000409
  keyshift config set targetLayout 00000429
  keyshift config set directionDetection hybrid

  keyshift start
  keyshift status
  keyshift stop
`);
}

async function initialize(): Promise<void> {
	await saveConfig({ ...defaultConfig });

	console.log("KeyShift configured successfully.");
	console.log(`Config: ${configPath}`);
	console.log(`Shortcut: ${defaultConfig.shortcut}`);
	console.log(
		`Layouts: ${defaultConfig.sourceLayout} <-> ${defaultConfig.targetLayout}`,
	);
	console.log(`Mode: ${defaultConfig.layoutMode}`);
	console.log("");
	console.log("Run KeyShift with:");
	console.log("  keyshift start");
}

function parseBoolean(key: string, value: string): boolean {
	const normalized = value.trim().toLowerCase();

	if (normalized === "true") {
		return true;
	}

	if (normalized === "false") {
		return false;
	}

	throw new Error(`${key} must be true or false.`);
}

function parseNumber(key: string, value: string): number {
	const parsed = Number(value);

	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`${key} must be a non-negative number.`);
	}

	return parsed;
}
async function installNativeHost(force = false): Promise<void> {
	await ensureAppDir();

	if (existsSync(installedHostExePath) && !force) {
		return;
	}

	if (force && (await isRunning())) {
		throw new Error(
			"KeyShift is running. Run `keyshift stop` before updating the native host.",
		);
	}

	if (existsSync(packagedHostExePath)) {
		if (force) {
			await rm(installedHostExePath, {
				force: true,
			});
		}

		await copyFile(packagedHostExePath, installedHostExePath);

		return;
	}

	await compileNativeHost();
}

function normalizeLayoutId(value: string): string {
	const normalized = value.trim().replace(/^0x/i, "").toUpperCase();

	if (!/^[0-9A-F]{4,8}$/.test(normalized)) {
		throw new Error(
			"Layout ID must contain 4 to 8 hexadecimal characters, for example 00000409.",
		);
	}

	return normalized.padStart(8, "0");
}

function parseLayoutMode(value: string): LayoutMode {
	const normalized = value.trim().toLowerCase();

	if (normalized === "auto" || normalized === "pair") {
		return normalized;
	}

	throw new Error("layoutMode must be auto or pair.");
}

function parseDirectionDetection(value: string): DirectionDetection {
	const normalized = value.trim().toLowerCase();

	if (
		normalized === "hybrid" ||
		normalized === "content" ||
		normalized === "active-layout"
	) {
		return normalized;
	}

	throw new Error(
		"directionDetection must be hybrid, content or active-layout.",
	);
}

async function setConfig(keyInput: string, rawValue: string): Promise<void> {
	const allowedKeys: Array<keyof KeyShiftConfig> = [
		"shortcut",
		"layoutMode",
		"sourceLayout",
		"targetLayout",
		"directionDetection",
		"preserveClipboard",
		"copyDelayMs",
		"pasteDelayMs",
		"selectAllText",
	];

	if (!allowedKeys.includes(keyInput as keyof KeyShiftConfig)) {
		throw new Error(`Unknown config key: ${keyInput}`);
	}

	const key = keyInput as keyof KeyShiftConfig;
	const config = await loadConfig();

	let value: KeyShiftConfig[keyof KeyShiftConfig];

	switch (key) {
		case "layoutMode":
			value = parseLayoutMode(rawValue);
			break;

		case "directionDetection":
			value = parseDirectionDetection(rawValue);
			break;

		case "sourceLayout":
		case "targetLayout":
			value = normalizeLayoutId(rawValue);
			break;

		case "preserveClipboard":
		case "selectAllText":
			value = parseBoolean(key, rawValue);
			break;

		case "copyDelayMs":
		case "pasteDelayMs":
			value = parseNumber(key, rawValue);
			break;

		case "shortcut":
			if (!rawValue.trim()) {
				throw new Error("shortcut cannot be empty.");
			}

			value = rawValue.trim();
			break;

		default:
			throw new Error(`Unsupported configuration key: ${key}`);
	}

	const nextConfig = {
		...config,
		[key]: value,
	} as KeyShiftConfig;

	await saveConfig(nextConfig);

	console.log(`${key} = ${String(nextConfig[key])}`);

	if (await isRunning()) {
		console.log("Restart KeyShift to apply this configuration:");
		console.log("  keyshift restart");
	}
}

async function compileNativeHost(): Promise<void> {
	if (process.platform !== "win32") {
		throw new Error("KeyShift currently supports Windows only.");
	}

	await ensureAppDir();

	const windowsDirectory = process.env.WINDIR ?? "C:\\Windows";

	const compilerCandidates = [
		path.join(
			windowsDirectory,
			"Microsoft.NET",
			"Framework64",
			"v4.0.30319",
			"csc.exe",
		),
		path.join(
			windowsDirectory,
			"Microsoft.NET",
			"Framework",
			"v4.0.30319",
			"csc.exe",
		),
	];

	const compilerPath = compilerCandidates.find((candidate) =>
		existsSync(candidate),
	);

	if (!compilerPath) {
		throw new Error(
			[
				"The .NET Framework C# compiler was not found.",
				"Enable .NET Framework 4.x in Windows Features",
				"or install .NET Framework 4.8 Developer Pack.",
			].join("\n"),
		);
	}

	if (!existsSync(hostSourcePath)) {
		throw new Error(`Native host source not found: ${hostSourcePath}`);
	}

	const result = spawnSync(
		compilerPath,
		[
			"/nologo",
			"/target:winexe",
			"/optimize+",
			"/platform:anycpu",
			`/out:${installedHostExePath}`,
			"/reference:System.dll",
			"/reference:System.Core.dll",
			"/reference:System.Drawing.dll",
			"/reference:System.Windows.Forms.dll",
			"/reference:System.Web.Extensions.dll",
			hostSourcePath,
		],
		{
			encoding: "utf8",
			windowsHide: true,
		},
	);

	if (result.error) {
		throw new Error(`Unable to compile native host: ${result.error.message}`);
	}

	if (result.status !== 0 || !existsSync(installedHostExePath)) {
		const output = [result.stdout, result.stderr]
			.filter(Boolean)
			.join("\n")
			.trim();

		throw new Error(`Native host compilation failed.\n${output}`);
	}
}

async function ensureNativeHost(): Promise<void> {
	await ensureAppDir();

	if (existsSync(packagedHostExePath)) {
		await copyFile(packagedHostExePath, installedHostExePath);

		return;
	}

	await compileNativeHost();
}

async function isRunning(): Promise<boolean> {
	if (!existsSync(pidPath)) {
		return false;
	}

	const rawPid = await readFile(pidPath, "utf8");
	const pid = Number(rawPid.trim());

	if (!Number.isInteger(pid) || pid <= 0) {
		await rm(pidPath, { force: true });
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		await rm(pidPath, { force: true });
		return false;
	}
}

async function start(): Promise<void> {
	if (process.platform !== "win32") {
		throw new Error("KeyShift currently supports Windows only.");
	}

	await ensureAppDir();

	if (await isRunning()) {
		console.log("KeyShift is already running.");
		return;
	}

	if (!existsSync(configPath)) {
		await saveConfig({ ...defaultConfig });
	}

	await rm(logPath, { force: true });
	await ensureNativeHost();

	const child = spawn(installedHostExePath, ["--run", configPath, logPath], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});

	if (!child.pid) {
		throw new Error("Unable to start the KeyShift native host.");
	}

	await writeFile(pidPath, String(child.pid), "utf8");

	await new Promise<void>((resolve) => {
		setTimeout(resolve, 1200);
	});

	let alive = true;

	try {
		process.kill(child.pid, 0);
	} catch {
		alive = false;
	}

	if (!alive) {
		await rm(pidPath, { force: true });

		let details = "The native host exited without creating a log.";

		try {
			details = await readFile(logPath, "utf8");
		} catch {
			// Keep fallback message.
		}

		throw new Error(`KeyShift host exited during startup.\n${details}`);
	}

	child.unref();

	const config = await loadConfig();

	console.log(`KeyShift running. Shortcut: ${config.shortcut}`);

	console.log(`Conversion: ${config.sourceLayout} <-> ${config.targetLayout}`);

	console.log(`Mode: ${config.layoutMode}`);
}

async function stop(): Promise<void> {
	if (!existsSync(pidPath)) {
		console.log("KeyShift is not running.");
		return;
	}

	const rawPid = await readFile(pidPath, "utf8");
	const pid = Number(rawPid.trim());

	if (Number.isInteger(pid) && pid > 0 && process.platform === "win32") {
		await new Promise<void>((resolve) => {
			const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});

			child.on("exit", () => resolve());
			child.on("error", () => resolve());
		});
	} else if (Number.isInteger(pid) && pid > 0) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// Process may already be stopped.
		}
	}

	await rm(pidPath, { force: true });

	console.log("KeyShift stopped.");
}

async function restart(): Promise<void> {
	await stop();
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 300);
	});
	await start();
}

async function showLayouts(): Promise<void> {
	if (process.platform !== "win32") {
		throw new Error("Keyboard layout discovery is supported on Windows only.");
	}

	await ensureNativeHost();

	const result = spawnSync(installedHostExePath, ["--layouts"], {
		encoding: "utf8",
		windowsHide: true,
	});

	if (result.error) {
		throw new Error(`Unable to list keyboard layouts: ${result.error.message}`);
	}

	if (result.status !== 0) {
		throw new Error(
			result.stderr?.trim() || "Unable to list installed keyboard layouts.",
		);
	}

	const output = result.stdout.trim();

	if (!output) {
		console.log("No Windows keyboard layouts were found.");
		return;
	}

	console.log("Installed Windows keyboard layouts:\n");
	console.log(output);
}

async function showLogs(): Promise<void> {
	if (!existsSync(logPath)) {
		console.log("No KeyShift log file exists.");
		return;
	}

	console.log(await readFile(logPath, "utf8"));
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);

	switch (command) {
		case "init":
			await initialize();
			break;

		case "start":
			await start();
			break;

		case "stop":
			await stop();
			break;

		case "restart":
			await restart();
			break;

		case "status":
			console.log((await isRunning()) ? "running" : "stopped");
			break;

		case "layouts":
			await showLayouts();
			break;
      
		case "update-host":
			await installNativeHost(true);
			console.log("KeyShift native host updated.");
			break;

		case "logs":
			await showLogs();
			break;

		case "config": {
			const [action, key, ...rest] = args;

			if (action === "show") {
				console.log(JSON.stringify(await loadConfig(), null, 2));

				break;
			}

			if (action === "reset") {
				await saveConfig({
					...defaultConfig,
				});

				console.log("KeyShift configuration was reset.");

				break;
			}

			if (action === "set" && key && rest.length > 0) {
				await setConfig(key, rest.join(" "));

				break;
			}

			throw new Error(
				"Use: keyshift config show, keyshift config reset, or keyshift config set <key> <value>",
			);
		}

		case undefined:
		case "help":
		case "--help":
		case "-h":
			printHelp();
			break;

		default:
			throw new Error(`Unknown command: ${command}`);
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);

	console.error(`Error: ${message}`);
	process.exitCode = 1;
});
