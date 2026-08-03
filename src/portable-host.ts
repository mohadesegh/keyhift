#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import {
	uIOhook,
	UiohookKey,
	type UiohookKeyboardEvent,
} from "uiohook-napi";

import { getDefaultLanguageSwitchShortcut } from "./config.js";
import {
	parseGnomeInputSources,
	portableLayoutCode,
} from "./input-sources.js";
import { convertPortableText } from "./portable-layouts.js";
import type { KeyShiftConfig } from "./types.js";

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

const [, , action, configPath, logPath] = process.argv;

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function log(message: string): Promise<void> {
	const line = `${new Date().toISOString()} ${message}\n`;
	await appendFile(logPath, line, "utf8");
}

function commandExists(command: string): boolean {
	const result = spawnSync("which", [command], {
		stdio: "ignore",
	});
	return result.status === 0;
}

function isGnomeSession(): boolean {
	return [
		process.env.XDG_CURRENT_DESKTOP,
		process.env.DESKTOP_SESSION,
		process.env.GDMSESSION,
	].some((value) => /(^|[:;_-])gnome($|[:;_-])/iu.test(value ?? ""));
}

function createCommandClipboard(
	name: string,
	read: { command: string; args: string[] },
	write: { command: string; args: string[] },
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
		return createCommandClipboard(
			"macOS pasteboard",
			{ command: "pbpaste", args: [] },
			{ command: "pbcopy", args: [] },
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
	specification: {
		command: string;
		args: string[];
	},
	input?: string,
): string {
	const result = spawnSync(specification.command, specification.args, {
		encoding: "utf8",
		input,
		maxBuffer: 16 * 1024 * 1024,
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
			const keys = UiohookKey as Record<string, number>;
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
	const modifier = process.platform === "darwin"
		? UiohookKey.Meta
		: UiohookKey.Ctrl;
	uIOhook.keyTap(key, [modifier]);
}

function tapShortcut(shortcut: Shortcut): void {
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
	if (process.platform === "darwin") {
		uIOhook.keyTap(UiohookKey.ArrowRight, [UiohookKey.Meta]);
		return;
	}

	uIOhook.keyTap(UiohookKey.End);
}

async function trySelectInputSource(layoutId: string): Promise<string | undefined> {
	if (process.platform === "darwin") {
		// macOS does not expose a supported command-line API for selecting an
		// input source. Use the user's configured system shortcut instead.
		return undefined;
	}

	if (process.platform !== "linux") {
		return undefined;
	}

	const layoutCode = portableLayoutCode(layoutId);

	if (!layoutCode) {
		return undefined;
	}

	// `gsettings` is installed on many headless Linux images, but changing its
	// input-source index only affects the keyboard when a GNOME session is
	// actually running. Prefer setxkbmap on plain X11/Xvfb sessions.
	if (isGnomeSession() && commandExists("gsettings")) {
		const sources = spawnSync(
			"gsettings",
			["get", "org.gnome.desktop.input-sources", "sources"],
			{ encoding: "utf8", windowsHide: true },
		);

		if (sources.status === 0) {
			const layouts = parseGnomeInputSources(sources.stdout);
			const index = layouts.indexOf(layoutCode);

			if (index >= 0) {
				const selected = spawnSync(
					"gsettings",
					[
						"set",
						"org.gnome.desktop.input-sources",
						"current",
						String(index),
					],
					{ encoding: "utf8", windowsHide: true },
				);

				if (selected.status === 0) {
					return `GNOME input source ${layoutCode}`;
				}
			}
		}
	}

	if (commandExists("setxkbmap")) {
		const selected = spawnSync(
			"setxkbmap",
			["-layout", layoutCode],
			{ encoding: "utf8", windowsHide: true },
		);

		if (selected.status === 0) {
			return `X11 keyboard layout ${layoutCode}`;
		}
	}

	return undefined;
}

async function switchInputLanguage(
	targetLayout: string,
	config: KeyShiftConfig,
): Promise<void> {
	if (config.switchInputLanguage === false) {
		return;
	}

	const selectedSource = await trySelectInputSource(targetLayout);

	if (selectedSource) {
		await log(`Switched directly to ${selectedSource}.`);
		return;
	}

	const languageSwitchShortcut = config.languageSwitchShortcut?.trim() ||
		getDefaultLanguageSwitchShortcut();

	if (!languageSwitchShortcut) {
		throw new Error(
			`Unable to select input source ${targetLayout}; no fallback shortcut is configured.`,
		);
	}

	tapShortcut(parseShortcut(languageSwitchShortcut, true));
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
			tapApplicationShortcut(UiohookKey.A);
			await delay(120);
		}

		tapApplicationShortcut(UiohookKey.C);

		const selectedText = await waitForClipboardText(
			clipboard,
			sentinel,
			Math.max(config.copyDelayMs, 3000),
		);

		if (!selectedText) {
			if (config.selectAllText) {
				uIOhook.keyTap(UiohookKey.ArrowRight);
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
		tapApplicationShortcut(UiohookKey.V);
		await delay(Math.max(config.pasteDelayMs, 250));

		if (config.selectAllText) {
			tapEndOfText();
		}

		await delay(100);
		await switchInputLanguage(conversion.target, config);

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

	const shortcut = parseShortcut(config.shortcut);
	const pressedKeys = new Set<number>();
	let shortcutWasDown = false;
	let converting = false;

	await log(
		`KeyShift portable host running. Platform=${process.platform}, ` +
			`Shortcut=${config.shortcut}, Clipboard=${clipboard.name}`,
	);

	if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
		await log(
			"Wayland detected. Global shortcuts may be limited by the compositor; " +
				"an X11/XWayland session is recommended.",
		);
	}

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
		void waitForShortcutRelease(pressedKeys, shortcut)
			.then(() => convertFocusedText(config, clipboard))
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
