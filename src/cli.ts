#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";

import { existsSync, readFileSync } from "node:fs";

import { copyFile, readFile, rm, writeFile } from "node:fs/promises";

import os from "node:os";

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
import {
	formatPortableLayouts,
	normalizePortableLayoutId,
} from "./portable-layouts.js";

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
const portableHostPath = path.join(packageRoot, "dist", "portable-host.js");
const waylandDesktopEntryName = "io.github.mohadesegh.KeyShift.desktop";

function requireWindows(command: string): void {
	if (process.platform === "win32") {
		return;
	}

	throw new Error(
		`${command} requires Windows 10 or Windows 11.`,
	);
}

function printHelp(): void {
	console.log(`
KeyShift CLI

Usage:
  keyshift <command>

Commands:
  keyshift init
  keyshift start
  keyshift stop
  keyshift uninstall [--keep-package]
  keyshift restart
  keyshift status
  keyshift layouts
  keyshift convert-clipboard
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
  switchInputLanguage
  languageSwitchShortcut

Examples:
  keyshift init

  keyshift layouts

  keyshift config set shortcut ${defaultConfig.shortcut}
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

	if (process.platform !== "win32") {
		if (!existsSync(portableHostPath)) {
			throw new Error(`Portable host not found: ${portableHostPath}`);
		}

		return;
	}

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
	if (process.platform !== "win32") {
		return normalizePortableLayoutId(value);
	}

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
		"switchInputLanguage",
		"languageSwitchShortcut",
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
		case "switchInputLanguage":
			value = parseBoolean(key, rawValue);
			break;

		case "copyDelayMs":
		case "pasteDelayMs":
			value = parseNumber(key, rawValue);
			break;

		case "shortcut":
		case "languageSwitchShortcut":
			if (!rawValue.trim()) {
				throw new Error(`${key} cannot be empty.`);
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
	requireWindows("Compiling the native host");

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
		if (
			existsSync(installedHostExePath) &&
			(await readFile(packagedHostExePath)).equals(
				await readFile(installedHostExePath),
			)
		) {
			return;
		}

		try {
			await copyFile(packagedHostExePath, installedHostExePath);
		} catch (error: unknown) {
			const code = (error as NodeJS.ErrnoException).code;

			if (code === "EBUSY" || code === "EPERM") {
				throw new Error(
					`${installedHostExePath} is in use by a running KeyShift host. ` +
						"Run `keyshift stop` and try again.",
				);
			}

			throw error;
		}

		return;
	}

	await compileNativeHost();
}

async function readPid(): Promise<number | undefined> {
	if (!existsSync(pidPath)) {
		return undefined;
	}

	const pid = Number((await readFile(pidPath, "utf8")).trim());

	return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function readProcessCommand(pid: number): string | undefined {
	if (process.platform === "win32") {
		const result = spawnSync(
			"tasklist",
			["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
			{ encoding: "utf8", windowsHide: true },
		);

		return result.status === 0 ? result.stdout : undefined;
	}

	if (process.platform === "linux") {
		try {
			return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/gu, " ");
		} catch {
			// Fall back to ps below.
		}
	}

	const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
		encoding: "utf8",
	});

	return result.status === 0 ? result.stdout : undefined;
}

// The PID file survives reboots and crashes, and the operating system reuses
// process IDs. Confirm that the process really is a KeyShift host before
// reporting it as running or terminating it.
function isKeyShiftHost(pid: number): boolean {
	try {
		process.kill(pid, 0);
	} catch {
		return false;
	}

	const command = readProcessCommand(pid);

	if (command === undefined) {
		return true;
	}

	return process.platform === "win32"
		? /keyshift-host\.exe/iu.test(command)
		: command.includes("portable-host.js");
}

async function isRunning(): Promise<boolean> {
	const pid = await readPid();

	if (pid !== undefined && isKeyShiftHost(pid)) {
		return true;
	}

	await rm(pidPath, { force: true });
	return false;
}

// Terminates hosts started from the installed executable that are no longer
// tracked by the PID file, so they cannot lock the executable or convert twice.
function stopUntrackedWindowsHosts(): boolean {
	const listed = spawnSync(
		"tasklist",
		["/FI", "IMAGENAME eq keyshift-host.exe", "/FO", "CSV", "/NH"],
		{ encoding: "utf8", windowsHide: true },
	);

	if (!/keyshift-host\.exe/iu.test(listed.stdout ?? "")) {
		return false;
	}

	const hostPath = installedHostExePath.replace(/'/gu, "''");
	const result = spawnSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-Command",
			"$hosts = @(Get-Process -Name keyshift-host -ErrorAction SilentlyContinue | " +
				`Where-Object { $_.Path -eq '${hostPath}' }); ` +
				"$hosts | Stop-Process -Force; $hosts.Count",
		],
		{ encoding: "utf8", windowsHide: true },
	);

	return Number((result.stdout ?? "").trim()) > 0;
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// Wayland portals show permission dialogs, so the host is only usable after
// the user approves them. Wait for the host to report that instead of
// announcing success while the dialogs are still open.
async function waitForWaylandHost(
	pid: number,
): Promise<"ready" | "exited" | "pending"> {
	const deadline = Date.now() + 120_000;
	let announced = false;

	while (Date.now() < deadline) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 250);
		});

		let hostLog = "";

		try {
			hostLog = await readFile(logPath, "utf8");
		} catch {
			// The host has not written its log yet.
		}

		if (hostLog.includes("Wayland portals ready.")) {
			return "ready";
		}

		if (!processIsAlive(pid)) {
			return "exited";
		}

		if (!announced && hostLog.includes("Waiting for portal permissions.")) {
			announced = true;
			console.log(
				"Waiting for the desktop permission dialogs (global shortcut and keyboard control)...",
			);
		}
	}

	console.log(
		"KeyShift is still waiting for the desktop permission dialogs. " +
			"Approve them, then check `keyshift logs`.",
	);
	return "pending";
}

async function start(): Promise<void> {
	await ensureAppDir();

	if (await isRunning()) {
		console.log("KeyShift is already running.");
		return;
	}

	if (!existsSync(configPath)) {
		await saveConfig({ ...defaultConfig });
	}

	await rm(logPath, { force: true });
	let executablePath: string;
	let hostArguments: string[];

	if (process.platform === "win32") {
		stopUntrackedWindowsHosts();
		await ensureNativeHost();
		executablePath = installedHostExePath;
		hostArguments = ["--run", configPath, logPath];
	} else {
		if (!existsSync(portableHostPath)) {
			throw new Error(`Portable host not found: ${portableHostPath}`);
		}

		executablePath = process.execPath;
		hostArguments = [
			portableHostPath,
			"--run",
			configPath,
			logPath,
		];
	}

	const child = spawn(executablePath, hostArguments, {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});

	if (!child.pid) {
		throw new Error("Unable to start the KeyShift native host.");
	}

	await writeFile(pidPath, String(child.pid), "utf8");

	let alive: boolean;

	if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
		const state = await waitForWaylandHost(child.pid);

		if (state === "pending") {
			child.unref();
			return;
		}

		alive = state === "ready";
	} else {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 1200);
		});

		alive = processIsAlive(child.pid);
	}

	if (!alive) {
		await rm(pidPath, { force: true });

		let details = "The native host exited without creating a log.";

		try {
			details = await readFile(logPath, "utf8");
		} catch {
			// Keep fallback message.
		}

		if (
			process.platform === "darwin" &&
			/UIOHOOK_ERROR_AXAPI_DISABLED|assistive devices|Accessibility/u.test(details)
		) {
			details += [
				"",
				"KeyShift needs Accessibility access on macOS.",
				"Open System Settings > Privacy & Security > Accessibility,",
				"enable the terminal application and Node.js, then run `keyshift start` again.",
			].join("\n");
		}

		if (
			process.platform === "linux" &&
			/UIOHOOK_ERROR_X_OPEN_DISPLAY|Failed to open X11 display/u.test(details)
		) {
			details += [
				"",
				"KeyShift global shortcuts require an X11 or compatible XWayland session.",
				"On native Wayland, copy the text and run `keyshift convert-clipboard`.",
			].join("\n");
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
	const pid = await readPid();
	let stopped = false;

	if (pid !== undefined && isKeyShiftHost(pid)) {
		if (process.platform === "win32") {
			await new Promise<void>((resolve) => {
				const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
					stdio: "ignore",
					windowsHide: true,
				});

				child.on("exit", () => resolve());
				child.on("error", () => resolve());
			});
		} else {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// Process may already be stopped.
			}
		}

		stopped = true;
	}

	if (process.platform === "win32") {
		stopped = stopUntrackedWindowsHosts() || stopped;
	}

	await rm(pidPath, { force: true });

	console.log(stopped ? "KeyShift stopped." : "KeyShift is not running.");
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
		console.log("Supported portable keyboard layouts:\n");
		console.log(formatPortableLayouts());
		return;
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

async function convertClipboard(): Promise<void> {
	if (process.platform === "win32") {
		throw new Error(
			"convert-clipboard is available on macOS and Linux. On Windows, use the global shortcut.",
		);
	}

	await ensureAppDir();

	if (!existsSync(configPath)) {
		await saveConfig({ ...defaultConfig });
	}

	if (!existsSync(portableHostPath)) {
		throw new Error(`Portable host not found: ${portableHostPath}`);
	}

	const result = spawnSync(
		process.execPath,
		[portableHostPath, "--convert-clipboard", configPath, logPath],
		{
			encoding: "utf8",
			windowsHide: true,
		},
	);

	if (result.error) {
		throw new Error(`Unable to convert the clipboard: ${result.error.message}`);
	}

	if (result.status !== 0) {
		throw new Error(
			result.stderr?.trim() || "Unable to convert the clipboard.",
		);
	}

	console.log("Clipboard converted.");
}

async function showLogs(): Promise<void> {
	if (!existsSync(logPath)) {
		console.log("No KeyShift log file exists.");
		return;
	}

	console.log(await readFile(logPath, "utf8"));
}

// Global installs made with another package manager live in that manager's
// own directory, and only it can remove them cleanly.
function globalRemoveCommand(): { command: string; args: string[] } {
	const location = packageRoot.replace(/\\/gu, "/").toLowerCase();

	if (/\/\.?pnpm\//u.test(location)) {
		return { command: "pnpm", args: ["remove", "--global", "keyshift"] };
	}

	if (location.includes("/.bun/")) {
		return { command: "bun", args: ["remove", "--global", "keyshift"] };
	}

	if (/\/yarn\/(data\/)?global\//u.test(location)) {
		return { command: "yarn", args: ["global", "remove", "keyshift"] };
	}

	return { command: "npm", args: ["uninstall", "--global", "keyshift"] };
}

async function uninstall(arguments_: string[]): Promise<void> {
	const supportedArguments = new Set(["--keep-package"]);
	const unknownArgument = arguments_.find(
		(argument) => !supportedArguments.has(argument),
	);

	if (unknownArgument) {
		throw new Error(
			`Unknown uninstall option: ${unknownArgument}. Use: keyshift uninstall [--keep-package]`,
		);
	}

	await stop();
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 500);
	});

	if (process.platform === "linux") {
		const dataRoot = process.env.XDG_DATA_HOME ??
			path.join(os.homedir(), ".local", "share");
		await rm(
			path.join(dataRoot, "applications", waylandDesktopEntryName),
			{ force: true },
		);
	}

	await rm(appDir, { force: true, recursive: true });
	console.log("KeyShift configuration, logs and runtime files removed.");

	if (arguments_.includes("--keep-package")) {
		console.log("The npm package was kept.");
		return;
	}

	const remove = globalRemoveCommand();
	const result = spawnSync(remove.command, remove.args, {
		stdio: "inherit",
		windowsHide: true,
		shell: process.platform === "win32",
	});

	if (result.error || result.status !== 0) {
		const manualCommand = [remove.command, ...remove.args].join(" ");

		throw new Error(
			`KeyShift data was removed, but ${remove.command} could not remove the global package. ` +
				`Run \`${manualCommand}\` manually` +
				(process.platform === "win32"
					? "."
					: " (with sudo if the global directory belongs to root)."),
		);
	}

	console.log("KeyShift uninstalled successfully.");
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

		case "uninstall":
			await uninstall(args);
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

		case "convert-clipboard":
			await convertClipboard();
			break;
      
		case "update-host":
			await installNativeHost(true);
			console.log(
				process.platform === "win32"
					? "KeyShift native host updated."
					: "KeyShift portable host is included with the installed package.",
			);
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
