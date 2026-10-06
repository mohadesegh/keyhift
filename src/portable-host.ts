#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { UiohookKeyboardEvent } from "uiohook-napi";

import { getDefaultLanguageSwitchShortcut } from "./config.js";
import {
	parseGnomeInputSources,
	parseXkbQuery,
	portableLayoutCode,
	prependXkbLayout,
} from "./input-sources.js";
import { convertPortableText } from "./portable-layouts.js";
import type { KeyShiftConfig } from "./types.js";
import {
	createWaylandPortalController,
	type WaylandKeyboardController,
} from "./wayland-portals.js";

interface ClipboardProvider {
	name: string;
	read(): string;
	write(value: string): void;
}

interface Shortcut {
	key: number;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
}

interface KeyboardController {
	tapApplicationShortcut(key: string): Promise<void>;
	tapEndOfText(): Promise<void>;
	tapKey(key: string): Promise<void>;
	tapShortcut(shortcut: string): Promise<void>;
}

const [, , action, configPath, logPath] = process.argv;
const WAYLAND_APP_ID = "io.github.mohadesegh.KeyShift";

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function log(message: string): Promise<void> {
	const line = `${new Date().toISOString()} ${message}\n`;
	await appendFile(logPath, line, "utf8");
}

type UiohookModule = typeof import("uiohook-napi");

let uiohookModule: UiohookModule | undefined;

// uiohook-napi is an optional native dependency that links against the X11
// client libraries on Linux. Load it only on the paths that need global input
// so clipboard conversion and the Wayland portal host work without it.
function loadUiohook(): UiohookModule {
	if (uiohookModule) {
		return uiohookModule;
	}

	try {
		uiohookModule = require("uiohook-napi") as UiohookModule;
	} catch (error: unknown) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			[
				"The global-input module (uiohook-napi) could not be loaded on " +
					`${process.platform}-${process.arch}.`,
				process.platform !== "linux"
					? "Reinstall KeyShift with install scripts enabled so the module can be built."
					: process.arch === "x64"
						? "Its prebuilt binary needs glibc 2.34 or newer and the libX11, " +
							"libXtst, libXt and libXrandr libraries. On older systems install " +
							"the build requirements below and reinstall KeyShift."
						: "It only ships a working Linux binary for x64, so on this " +
							"architecture it is compiled during installation.",
				...(process.platform === "linux"
					? [
						"Build requirements: a C/C++ toolchain, python3 and the X11 " +
							"development headers, for example on Debian/Ubuntu: " +
							"sudo apt-get install build-essential python3 libx11-dev " +
							"libxtst-dev libxt-dev libxrandr-dev",
					]
					: []),
				"Clipboard conversion still works: copy the text and run " +
					"`keyshift convert-clipboard`.",
				`Details: ${details}`,
			].join("\n"),
		);
	}

	return uiohookModule;
}

function commandExists(command: string): boolean {
	// `which` is not installed on every distribution, so search PATH directly.
	return (process.env.PATH ?? "")
		.split(path.delimiter)
		.filter(Boolean)
		.some((directory) => {
			try {
				accessSync(path.join(directory, command), constants.X_OK);
				return true;
			} catch {
				return false;
			}
		});
}

function isGnomeSession(): boolean {
	return [
		process.env.XDG_CURRENT_DESKTOP,
		process.env.DESKTOP_SESSION,
		process.env.GDMSESSION,
	].some((value) => /(^|[:;_-])gnome($|[:;_-])/iu.test(value ?? ""));
}

interface ClipboardCommand {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
}

function createCommandClipboard(
	name: string,
	read: ClipboardCommand,
	write: ClipboardCommand,
): ClipboardProvider {
	return {
		name,
		read: () => runClipboardCommand(read),
		write: (value) => {
			runClipboardCommand(write, value);
		},
	};
}

async function resolveClipboardProvider(): Promise<ClipboardProvider> {
	if (process.platform === "darwin") {
		// pbcopy and pbpaste encode text with the process locale. Without a
		// UTF-8 LC_CTYPE (SSH sessions, launchd, some terminals) they fall back
		// to Mac Roman and corrupt non-Latin text.
		const env: NodeJS.ProcessEnv = { ...process.env, LC_CTYPE: "UTF-8" };
		delete env.LC_ALL;

		return createCommandClipboard(
			"macOS pasteboard",
			{ command: "pbpaste", args: [], env },
			{ command: "pbcopy", args: [], env },
		);
	}

	if (process.platform !== "linux") {
		throw new Error(
			`The portable host does not support ${process.platform}.`,
		);
	}

	if (
		process.env.WAYLAND_DISPLAY &&
		commandExists("wl-copy") &&
		commandExists("wl-paste")
	) {
		return createCommandClipboard(
			"Wayland clipboard",
			{
				command: "wl-paste",
				args: ["--no-newline", "--type", "text"],
			},
			{ command: "wl-copy", args: ["--type", "text/plain"] },
		);
	}

	if (commandExists("xclip")) {
		return createCommandClipboard(
			"X11 clipboard (xclip)",
			{
				command: "xclip",
				args: ["-selection", "clipboard", "-out"],
			},
			{
				command: "xclip",
				args: ["-selection", "clipboard", "-in"],
			},
		);
	}

	if (commandExists("xsel")) {
		return createCommandClipboard(
			"X11 clipboard (xsel)",
			{
				command: "xsel",
				args: ["--clipboard", "--output"],
			},
			{
				command: "xsel",
				args: ["--clipboard", "--input"],
			},
		);
	}

	try {
		const clipboardy = (await import("clipboardy")).default;

		// Probe once during startup so display/permission failures are reported
		// by `keyshift start`, not only after the first shortcut press.
		clipboardy.readSync();

		return {
			name: "bundled Linux clipboard fallback",
			read: () => clipboardy.readSync(),
			write: (value) => clipboardy.writeSync(value),
		};
	} catch (error: unknown) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			[
				"Unable to access the Linux clipboard.",
				"The bundled X11 fallback could not connect to a display.",
				process.env.WAYLAND_DISPLAY
					? "For native Wayland, install `wl-clipboard`."
					: "Make sure an X11 display is active.",
				`Details: ${details}`,
			].join(" "),
		);
	}
}

function runClipboardCommand(
	specification: ClipboardCommand,
	input?: string,
): string {
	// X11 clipboard tools fork a background selection owner after a write.
	// Capturing its stdout/stderr keeps Node's pipes open and makes spawnSync
	// wait forever, so write operations must not use captured output streams.
	const result = spawnSync(specification.command, specification.args, {
		encoding: "utf8",
		env: specification.env,
		input,
		maxBuffer: 16 * 1024 * 1024,
		stdio: input === undefined
			? ["ignore", "pipe", "pipe"]
			: ["pipe", "ignore", "ignore"],
	});

	if (result.error) {
		throw new Error(
			`Unable to run ${specification.command}: ${result.error.message}`,
		);
	}

	if (result.status !== 0) {
		throw new Error(
			result.stderr?.trim() ||
				`${specification.command} exited with status ${result.status}.`,
		);
	}

	return result.stdout ?? "";
}

function normalizeShortcutKey(value: string): string {
	const normalized = value.trim().toLowerCase();
	const aliases: Record<string, string> = {
		"`": "Backquote",
		"-": "Minus",
		"=": "Equal",
		"[": "BracketLeft",
		"]": "BracketRight",
		"\\": "Backslash",
		";": "Semicolon",
		"'": "Quote",
		",": "Comma",
		".": "Period",
		"/": "Slash",
		esc: "Escape",
		return: "Enter",
	};

	if (aliases[normalized]) {
		return aliases[normalized];
	}

	if (/^[a-z0-9]$/u.test(normalized)) {
		return normalized.toUpperCase();
	}

	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function parseShortcut(
	value: string,
	allowModifierOnly = false,
): Shortcut {
	const tokens = value
		.split("+")
		.map((token) => token.trim())
		.filter(Boolean);
	const shortcut: Shortcut = {
		key: 0,
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
	};

	for (const token of tokens) {
		const normalized = token.toLowerCase();

		if (normalized === "control" || normalized === "ctrl") {
			shortcut.ctrl = true;
		} else if (normalized === "alt" || normalized === "option") {
			shortcut.alt = true;
		} else if (normalized === "shift") {
			shortcut.shift = true;
		} else if (
			normalized === "meta" ||
			normalized === "command" ||
			normalized === "cmd" ||
			normalized === "super" ||
			normalized === "win"
		) {
			shortcut.meta = true;
		} else if (shortcut.key === 0) {
			const keyName = normalizeShortcutKey(token);
			const keys = loadUiohook().UiohookKey as Record<string, number>;
			shortcut.key = keys[keyName] ?? 0;
		} else {
			throw new Error(`Shortcut contains multiple main keys: ${value}`);
		}
	}

	const hasModifier = shortcut.ctrl || shortcut.alt || shortcut.shift ||
		shortcut.meta;

	if (shortcut.key === 0 && !(allowModifierOnly && hasModifier)) {
		throw new Error(`Unsupported shortcut: ${value}`);
	}

	return shortcut;
}

function matchesShortcut(
	event: UiohookKeyboardEvent,
	shortcut: Shortcut,
): boolean {
	return event.keycode === shortcut.key &&
		event.ctrlKey === shortcut.ctrl &&
		event.altKey === shortcut.alt &&
		event.shiftKey === shortcut.shift &&
		event.metaKey === shortcut.meta;
}

function tapApplicationShortcut(key: number): void {
	const { uIOhook, UiohookKey } = loadUiohook();
	const modifier = process.platform === "darwin"
		? UiohookKey.Meta
		: UiohookKey.Ctrl;
	uIOhook.keyTap(key, [modifier]);
}

async function ensureWaylandDesktopEntry(): Promise<string | undefined> {
	try {
		const dataRoot = process.env.XDG_DATA_HOME ??
			path.join(os.homedir(), ".local", "share");
		const applicationsDirectory = path.join(dataRoot, "applications");
		await mkdir(applicationsDirectory, { recursive: true });
		await writeFile(
			path.join(applicationsDirectory, `${WAYLAND_APP_ID}.desktop`),
			[
				"[Desktop Entry]",
				"Type=Application",
				"Name=KeyShift",
				"Comment=Convert text typed with the wrong keyboard layout",
				"Exec=keyshift start",
				"NoDisplay=true",
				"Terminal=false",
				"",
			].join("\n"),
			"utf8",
		);
		return WAYLAND_APP_ID;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		await log(`Unable to install the Wayland application identity: ${message}`);
		return undefined;
	}
}

function tapShortcut(shortcut: Shortcut): void {
	const { uIOhook, UiohookKey } = loadUiohook();
	const modifiers: number[] = [
		...(shortcut.ctrl ? [UiohookKey.Ctrl] : []),
		...(shortcut.alt ? [UiohookKey.Alt] : []),
		...(shortcut.shift ? [UiohookKey.Shift] : []),
		...(shortcut.meta ? [UiohookKey.Meta] : []),
	];
	let key = shortcut.key;

	if (key === 0) {
		key = modifiers.pop() ?? 0;
	}

	if (key === 0) {
		throw new Error("The shortcut does not contain a key.");
	}

	uIOhook.keyTap(key, modifiers);
}

function tapEndOfText(): void {
	const { uIOhook, UiohookKey } = loadUiohook();

	if (process.platform === "darwin") {
		uIOhook.keyTap(UiohookKey.ArrowRight, [UiohookKey.Meta]);
		return;
	}

	uIOhook.keyTap(UiohookKey.End);
}

const uiohookKeyboardController: KeyboardController = {
	tapApplicationShortcut: async (key) => {
		const keycode = (loadUiohook().UiohookKey as Record<string, number>)[
			normalizeShortcutKey(key)
		];

		if (!keycode) {
			throw new Error(`Unsupported application shortcut key: ${key}`);
		}

		tapApplicationShortcut(keycode);
	},
	tapEndOfText: async () => tapEndOfText(),
	tapKey: async (key) => {
		const parsed = parseShortcut(key);
		tapShortcut(parsed);
	},
	tapShortcut: async (shortcut) => {
		tapShortcut(parseShortcut(shortcut, true));
	},
};

type InputSourceSelection =
	| { kind: "selected"; description: string }
	| { kind: "use-shortcut" }
	| { kind: "unavailable"; reason: string };

async function trySelectInputSource(
	layoutId: string,
): Promise<InputSourceSelection> {
	// macOS does not expose a supported command-line API for selecting an
	// input source. Use the user's configured system shortcut instead.
	if (process.platform !== "linux") {
		return { kind: "use-shortcut" };
	}

	const layoutCode = portableLayoutCode(layoutId);

	if (!layoutCode) {
		return { kind: "use-shortcut" };
	}

	// GNOME owns the keyboard configuration: it ignores the deprecated
	// `current` gsettings key and overrides setxkbmap, so the desktop's own
	// switch shortcut is the only dependable way to change the input source.
	if (isGnomeSession()) {
		if (commandExists("gsettings")) {
			const sources = spawnSync(
				"gsettings",
				["get", "org.gnome.desktop.input-sources", "sources"],
				{ encoding: "utf8" },
			);

			if (
				sources.status === 0 &&
				!parseGnomeInputSources(sources.stdout).includes(layoutCode)
			) {
				return {
					kind: "unavailable",
					reason: `${layoutCode} is not one of the GNOME input sources`,
				};
			}
		}

		return { kind: "use-shortcut" };
	}

	if (commandExists("xkb-switch")) {
		const selected = spawnSync("xkb-switch", ["-s", layoutCode], {
			encoding: "utf8",
		});

		if (selected.status === 0) {
			return {
				kind: "selected",
				description: `X11 keyboard group ${layoutCode}`,
			};
		}
	}

	if (!commandExists("setxkbmap")) {
		return { kind: "use-shortcut" };
	}

	const query = spawnSync("setxkbmap", ["-query"], { encoding: "utf8" });

	if (query.status !== 0) {
		return { kind: "use-shortcut" };
	}

	const current = parseXkbQuery(query.stdout);

	// The target is already one of several configured layouts. Rewriting the
	// layout list cannot select a group, so let the desktop shortcut do it.
	if (current.layouts.length > 1 && current.layouts.includes(layoutCode)) {
		return { kind: "use-shortcut" };
	}

	if (current.layouts.length === 1 && current.layouts[0] === layoutCode) {
		return {
			kind: "selected",
			description: `X11 keyboard layout ${layoutCode} (already active)`,
		};
	}

	// The target is not configured yet. Put it first and keep every existing
	// layout, variant and option so the user's own toggle keeps working.
	const next = prependXkbLayout(current, layoutCode);
	const selected = spawnSync(
		"setxkbmap",
		[
			"-layout",
			next.layouts.join(","),
			// Without variants there is nothing to realign with the new order.
			...(next.variants.some(Boolean)
				? ["-variant", next.variants.join(",")]
				: []),
		],
		{ encoding: "utf8" },
	);

	if (selected.status === 0) {
		return {
			kind: "selected",
			description: `X11 keyboard layouts ${next.layouts.join(",")}`,
		};
	}

	return { kind: "use-shortcut" };
}

async function switchInputLanguage(
	targetLayout: string,
	config: KeyShiftConfig,
	keyboard?: KeyboardController,
): Promise<void> {
	if (config.switchInputLanguage === false) {
		return;
	}

	if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
		await log(
			`Input-language switch to ${targetLayout} skipped on native Wayland; ` +
				"KeyShift will not alter the KWin or XWayland layout state.",
		);
		return;
	}

	const selection = await trySelectInputSource(targetLayout);

	if (selection.kind === "selected") {
		await log(`Switched directly to ${selection.description}.`);
		return;
	}

	if (selection.kind === "unavailable") {
		await log(`Input-language switch skipped: ${selection.reason}.`);
		return;
	}

	const languageSwitchShortcut = config.languageSwitchShortcut?.trim() ||
		getDefaultLanguageSwitchShortcut();

	if (!languageSwitchShortcut) {
		throw new Error(
			`Unable to select input source ${targetLayout}; no fallback shortcut is configured.`,
		);
	}

	if (!keyboard) {
		await log(
			`Input-language switch skipped: ${languageSwitchShortcut} requires ` +
				"the focused-text keyboard controller.",
		);
		return;
	}

	await keyboard.tapShortcut(languageSwitchShortcut);
	await log(`Switched input language with ${languageSwitchShortcut}.`);
}

async function waitForClipboardText(
	clipboard: ClipboardProvider,
	sentinel: string,
	timeoutMs: number,
): Promise<string> {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		const value = clipboard.read();

		if (value && value !== sentinel) {
			return value;
		}

		await delay(50);
	}

	return "";
}

async function waitForShortcutRelease(
	pressedKeys: Set<number>,
	shortcut: Shortcut,
): Promise<void> {
	const { UiohookKey } = loadUiohook();
	const relevantKeys = [
		shortcut.key,
		...(shortcut.ctrl ? [UiohookKey.Ctrl, UiohookKey.CtrlRight] : []),
		...(shortcut.alt ? [UiohookKey.Alt, UiohookKey.AltRight] : []),
		...(shortcut.shift ? [UiohookKey.Shift, UiohookKey.ShiftRight] : []),
		...(shortcut.meta ? [UiohookKey.Meta, UiohookKey.MetaRight] : []),
	];
	const startedAt = Date.now();

	while (relevantKeys.some((key) => pressedKeys.has(key))) {
		if (Date.now() - startedAt >= 5000) {
			throw new Error("Shortcut keys were not released within 5 seconds.");
		}

		await delay(20);
	}

	await delay(80);
}

async function convertFocusedText(
	config: KeyShiftConfig,
	clipboard: ClipboardProvider,
	keyboard: KeyboardController,
): Promise<void> {
	const previousClipboard = config.preserveClipboard
		? clipboard.read()
		: undefined;
	const sentinel = `keyshift:${process.pid}:${Date.now()}`;
	let restored = false;

	const restoreClipboard = async (): Promise<void> => {
		if (previousClipboard === undefined || restored) {
			return;
		}

		clipboard.write(previousClipboard);
		restored = true;
		await log("Clipboard restored.");
	};

	try {
		clipboard.write(sentinel);

		if (config.selectAllText) {
			await keyboard.tapApplicationShortcut("A");
			await delay(120);
		}

		await keyboard.tapApplicationShortcut("C");

		const selectedText = await waitForClipboardText(
			clipboard,
			sentinel,
			Math.max(config.copyDelayMs, 3000),
		);

		if (!selectedText) {
			if (config.selectAllText) {
				await keyboard.tapKey("ArrowRight");
			}

			if (previousClipboard === undefined) {
				clipboard.write("");
			}

			await log("Shortcut fired, but no editable or selected text was copied.");
			return;
		}

		const conversion = convertPortableText(
			selectedText,
			config.sourceLayout,
			config.targetLayout,
			config.layoutMode,
			config.directionDetection,
		);

		if (conversion.text === selectedText) {
			await log("Converted text was unchanged.");
			return;
		}

		await log(
			`Converting ${conversion.source} -> ${conversion.target}. ` +
				`InputLength=${selectedText.length}, OutputLength=${conversion.text.length}`,
		);
		clipboard.write(conversion.text);
		await delay(Math.max(config.pasteDelayMs, 120));
		await keyboard.tapApplicationShortcut("V");
		await delay(Math.max(config.pasteDelayMs, 250));

		if (config.selectAllText) {
			await keyboard.tapEndOfText();
		}

		await delay(100);
		await switchInputLanguage(conversion.target, config, keyboard);

		await log("Converted focused text successfully.");
	} finally {
		await restoreClipboard();
	}
}

async function convertClipboardText(
	config: KeyShiftConfig,
	clipboard: ClipboardProvider,
): Promise<void> {
	const input = clipboard.read();

	if (!input) {
		throw new Error("The clipboard does not contain text to convert.");
	}

	const conversion = convertPortableText(
		input,
		config.sourceLayout,
		config.targetLayout,
		config.layoutMode,
		config.directionDetection,
	);

	clipboard.write(conversion.text);
	await switchInputLanguage(conversion.target, config);
	await log(
		`Converted clipboard ${conversion.source} -> ${conversion.target}. ` +
			`InputLength=${input.length}, OutputLength=${conversion.text.length}`,
	);
}

async function run(): Promise<void> {
	if (
		(action !== "--run" && action !== "--convert-clipboard") ||
		!configPath ||
		!logPath
	) {
		throw new Error(
			"Use: portable-host (--run | --convert-clipboard) <configPath> <logPath>",
		);
	}

	const config = JSON.parse(
		await readFile(configPath, "utf8"),
	) as KeyShiftConfig;
	const clipboard = await resolveClipboardProvider();

	if (action === "--convert-clipboard") {
		await convertClipboardText(config, clipboard);
		return;
	}

	const nativeWayland = process.platform === "linux" &&
		Boolean(process.env.WAYLAND_DISPLAY);

	if (nativeWayland) {
		let converting = false;
		let controller: WaylandKeyboardController | undefined;
		const appId = await ensureWaylandDesktopEntry();

		await log(
			`KeyShift Wayland host starting. Shortcut=${config.shortcut}, ` +
				`Clipboard=${clipboard.name}. Waiting for portal permissions.`,
		);

		controller = await createWaylandPortalController({
			appId,
			shortcut: config.shortcut,
			portalStatePath: path.join(
				path.dirname(configPath),
				"wayland-portal.json",
			),
			log,
			onShortcut: async () => {
				if (converting || !controller) {
					return;
				}

				converting = true;
				await log("Shortcut detected through the Wayland portal.");

				try {
					await convertFocusedText(config, clipboard, controller);
				} catch (error: unknown) {
					const message = error instanceof Error
						? error.stack ?? error.message
						: String(error);
					await log(`Conversion failed: ${message}`);
				} finally {
					converting = false;
				}
			},
		});

		const shutDown = async (): Promise<void> => {
			await controller?.close();
			await log("KeyShift Wayland host stopped.");
			process.exit(0);
		};

		process.on("SIGTERM", () => void shutDown());
		process.on("SIGINT", () => void shutDown());
		return;
	}

	const { uIOhook } = loadUiohook();
	const shortcut = parseShortcut(config.shortcut);
	const pressedKeys = new Set<number>();
	let shortcutWasDown = false;
	let converting = false;

	await log(
		`KeyShift portable host running. Platform=${process.platform}, ` +
			`Shortcut=${config.shortcut}, Clipboard=${clipboard.name}`,
	);

	uIOhook.on("keydown", (event) => {
		pressedKeys.add(event.keycode);

		if (
			converting ||
			shortcutWasDown ||
			!matchesShortcut(event, shortcut)
		) {
			return;
		}

		shortcutWasDown = true;
		converting = true;
		void log("Shortcut detected.");
		void waitForShortcutRelease(pressedKeys, shortcut)
			.then(() => convertFocusedText(
				config,
				clipboard,
				uiohookKeyboardController,
			))
			.catch(async (error: unknown) => {
				const message = error instanceof Error
					? error.stack ?? error.message
					: String(error);
				await log(`Conversion failed: ${message}`);
			})
			.finally(() => {
				converting = false;
			});
	});

	uIOhook.on("keyup", (event) => {
		pressedKeys.delete(event.keycode);

		if (event.keycode === shortcut.key) {
			shortcutWasDown = false;
		}
	});

	const shutDown = async (): Promise<void> => {
		uIOhook.stop();
		await log("KeyShift portable host stopped.");
		process.exit(0);
	};

	process.on("SIGTERM", () => void shutDown());
	process.on("SIGINT", () => void shutDown());
	uIOhook.start();
}

run().catch(async (error: unknown) => {
	const message = error instanceof Error
		? error.stack ?? error.message
		: String(error);

	try {
		if (logPath) {
			await log(`Portable host failed: ${message}`);
		}
	} finally {
		console.error(message);
		process.exitCode = 1;
	}
});
