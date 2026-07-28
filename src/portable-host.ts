#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import {
	uIOhook,
	UiohookKey,
	type UiohookKeyboardEvent,
} from "uiohook-napi";

import { convertPortableText } from "./portable-layouts.js";
import type { KeyShiftConfig } from "./types.js";

interface ClipboardCommands {
	name: string;
	read: {
		command: string;
		args: string[];
	};
	write: {
		command: string;
		args: string[];
	};
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

function resolveClipboardCommands(): ClipboardCommands {
	if (process.platform === "darwin") {
		return {
			name: "macOS pasteboard",
			read: { command: "pbpaste", args: [] },
			write: { command: "pbcopy", args: [] },
		};
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
		return {
			name: "Wayland clipboard",
			read: {
				command: "wl-paste",
				args: ["--no-newline", "--type", "text"],
			},
			write: { command: "wl-copy", args: ["--type", "text/plain"] },
		};
	}

	if (commandExists("xclip")) {
		return {
			name: "X11 clipboard (xclip)",
			read: {
				command: "xclip",
				args: ["-selection", "clipboard", "-out"],
			},
			write: {
				command: "xclip",
				args: ["-selection", "clipboard", "-in"],
			},
		};
	}

	if (commandExists("xsel")) {
		return {
			name: "X11 clipboard (xsel)",
			read: {
				command: "xsel",
				args: ["--clipboard", "--output"],
			},
			write: {
				command: "xsel",
				args: ["--clipboard", "--input"],
			},
		};
	}

	throw new Error(
		[
			"No supported Linux clipboard tool was found.",
			"Install `wl-clipboard` on Wayland or `xclip`/`xsel` on X11.",
		].join(" "),
	);
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

function readClipboard(commands: ClipboardCommands): string {
	return runClipboardCommand(commands.read);
}

function writeClipboard(
	commands: ClipboardCommands,
	value: string,
): void {
	runClipboardCommand(commands.write, value);
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

function parseShortcut(value: string): Shortcut {
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

	if (shortcut.key === 0) {
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

function tapEndOfText(): void {
	if (process.platform === "darwin") {
		uIOhook.keyTap(UiohookKey.ArrowRight, [UiohookKey.Meta]);
		return;
	}

	uIOhook.keyTap(UiohookKey.End);
}

async function waitForClipboardText(
	clipboard: ClipboardCommands,
	sentinel: string,
	timeoutMs: number,
): Promise<string> {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		const value = readClipboard(clipboard);

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
	clipboard: ClipboardCommands,
): Promise<void> {
	const previousClipboard = config.preserveClipboard
		? readClipboard(clipboard)
		: undefined;
	const sentinel = `keyshift:${process.pid}:${Date.now()}`;
	let restored = false;

	const restoreClipboard = async (): Promise<void> => {
		if (previousClipboard === undefined || restored) {
			return;
		}

		writeClipboard(clipboard, previousClipboard);
		restored = true;
		await log("Clipboard restored.");
	};

	try {
		writeClipboard(clipboard, sentinel);

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
				writeClipboard(clipboard, "");
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
		writeClipboard(clipboard, conversion.text);
		await delay(Math.max(config.pasteDelayMs, 120));
		tapApplicationShortcut(UiohookKey.V);
		await delay(Math.max(config.pasteDelayMs, 250));

		if (config.selectAllText) {
			tapEndOfText();
		}

		await log("Converted focused text successfully.");
	} finally {
		await restoreClipboard();
	}
}

async function run(): Promise<void> {
	if (action !== "--run" || !configPath || !logPath) {
		throw new Error(
			"Use: portable-host --run <configPath> <logPath>",
		);
	}

	const config = JSON.parse(
		await readFile(configPath, "utf8"),
	) as KeyShiftConfig;
	const shortcut = parseShortcut(config.shortcut);
	const clipboard = resolveClipboardCommands();
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
