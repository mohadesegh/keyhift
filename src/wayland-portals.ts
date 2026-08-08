import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const PORTAL_DESTINATION = "org.freedesktop.portal.Desktop";
const PORTAL_PATH = "/org/freedesktop/portal/desktop";
const REQUEST_INTERFACE = "org.freedesktop.portal.Request";
const SESSION_INTERFACE = "org.freedesktop.portal.Session";
const GLOBAL_SHORTCUTS_INTERFACE =
	"org.freedesktop.portal.GlobalShortcuts";
const REMOTE_DESKTOP_INTERFACE = "org.freedesktop.portal.RemoteDesktop";
const HOST_REGISTRY_INTERFACE = "org.freedesktop.host.portal.Registry";
const SHORTCUT_ID = "convert-focused-text";
const KEYBOARD_DEVICE = 1;

type OutgoingVariant = [signature: string, value: unknown];
type VariantDictionary = Array<[key: string, value: unknown]>;

interface NativeMessage {
	body?: unknown[];
	errorName?: string;
	interface?: string;
	member?: string;
	path?: string;
	signature?: string;
}

interface NativeBus {
	addMatch(rule: string, callback: (error?: NativeError) => void): void;
	connection: {
		end(): void;
		off(event: "message", listener: (message: NativeMessage) => void): void;
		on(event: "message", listener: (message: NativeMessage) => void): void;
	};
	invoke(
		message: {
			body?: unknown[];
			destination: string;
			interface: string;
			member: string;
			path: string;
			signature?: string;
		},
		callback: (error?: NativeError, ...values: unknown[]) => void,
	): void;
	name: string | null;
	removeMatch(rule: string, callback: (error?: NativeError) => void): void;
}

interface NativeError {
	message?: string;
	name?: string;
}

interface PortalState {
	remoteDesktopRestoreToken?: string;
}

export interface WaylandKeyboardController {
	close(): Promise<void>;
	tapApplicationShortcut(key: string): Promise<void>;
	tapEndOfText(): Promise<void>;
	tapKey(key: string): Promise<void>;
	tapShortcut(shortcut: string): Promise<void>;
}

interface ParsedEvdevShortcut {
	key: number;
	modifiers: number[];
}

const EVDEV_KEYS: Record<string, number> = {
	backquote: 41,
	minus: 12,
	equal: 13,
	bracketleft: 26,
	bracketright: 27,
	backslash: 43,
	semicolon: 39,
	quote: 40,
	comma: 51,
	period: 52,
	slash: 53,
	escape: 1,
	enter: 28,
	return: 28,
	space: 57,
	end: 107,
	arrowright: 106,
	ctrl: 29,
	control: 29,
	alt: 56,
	shift: 42,
	meta: 125,
	logo: 125,
	super: 125,
};

const LETTER_KEYCODES = [
	30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50,
	49, 24, 25, 16, 19, 31, 20, 22, 47, 17, 45, 21, 44,
];

const PORTAL_KEY_NAMES: Record<string, string> = {
	backquote: "grave",
	minus: "minus",
	equal: "equal",
	bracketleft: "bracketleft",
	bracketright: "bracketright",
	backslash: "backslash",
	semicolon: "semicolon",
	quote: "apostrophe",
	comma: "comma",
	period: "period",
	slash: "slash",
	escape: "Escape",
	enter: "Return",
	return: "Return",
	space: "space",
	end: "End",
	arrowright: "Right",
};

for (let index = 0; index < 26; index++) {
	EVDEV_KEYS[String.fromCharCode(97 + index)] = LETTER_KEYCODES[index]!;
}

for (let digit = 1; digit <= 9; digit++) {
	EVDEV_KEYS[String(digit)] = digit + 1;
}

EVDEV_KEYS["0"] = 11;

function token(): string {
	return `keyshift_${randomBytes(12).toString("hex")}`;
}

function variant(signature: string, value: unknown): OutgoingVariant {
	return [signature, value];
}

function options(
	values: Record<string, OutgoingVariant>,
): VariantDictionary {
	return Object.entries(values);
}

function variantValue<T>(value: unknown): T | undefined {
	if (!Array.isArray(value) || value.length < 2) {
		return undefined;
	}

	const payload = value[1];
	return (Array.isArray(payload) ? payload[0] : payload) as T | undefined;
}

function resultValue<T>(results: VariantDictionary, key: string): T | undefined {
	return variantValue<T>(results.find(([name]) => name === key)?.[1]);
}

function requestPath(bus: NativeBus, requestToken: string): string {
	if (!bus.name) {
		throw new Error("The D-Bus session connection is not ready.");
	}

	const sender = bus.name.slice(1).replace(/\./gu, "_");
	return `${PORTAL_PATH}/request/${sender}/${requestToken}`;
}

function nativeError(error: NativeError): Error {
	return new Error(
		[error.name, error.message].filter(Boolean).join(": ") ||
			"The D-Bus request failed.",
	);
}

function addMatch(bus: NativeBus, rule: string): Promise<void> {
	return new Promise((resolve, reject) => {
		bus.addMatch(rule, (error) => error ? reject(nativeError(error)) : resolve());
	});
}

function removeMatch(bus: NativeBus, rule: string): Promise<void> {
	return new Promise((resolve) => {
		bus.removeMatch(rule, () => resolve());
	});
}

function invoke(
	bus: NativeBus,
	interfaceName: string,
	member: string,
	signature = "",
	body: unknown[] = [],
): Promise<unknown[]> {
	return new Promise((resolve, reject) => {
		bus.invoke(
			{
				destination: PORTAL_DESTINATION,
				path: PORTAL_PATH,
				interface: interfaceName,
				member,
				signature,
				body,
			},
			(error, ...values) => error
				? reject(nativeError(error))
				: resolve(values),
		);
	});
}

async function waitForBusName(bus: NativeBus): Promise<void> {
	const startedAt = Date.now();

	while (!bus.name) {
		if (Date.now() - startedAt > 5000) {
			throw new Error("Unable to connect to the D-Bus session bus.");
		}

		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function portalRequest(
	bus: NativeBus,
	invokeRequest: (requestToken: string) => Promise<unknown[]>,
): Promise<VariantDictionary> {
	const requestToken = token();
	const expectedPath = requestPath(bus, requestToken);
	const rule = [
		"type='signal'",
		`interface='${REQUEST_INTERFACE}'`,
		"member='Response'",
		`path='${expectedPath}'`,
	].join(",");

	await addMatch(bus, rule);

	let resolveResponse!: (response: [number, VariantDictionary]) => void;
	let rejectResponse!: (error: Error) => void;
	const responsePromise = new Promise<[number, VariantDictionary]>(
		(resolve, reject) => {
			resolveResponse = resolve;
			rejectResponse = reject;
		},
	);

	const onMessage = (message: NativeMessage): void => {
		if (
			message.path !== expectedPath ||
			message.interface !== REQUEST_INTERFACE ||
			message.member !== "Response"
		) {
			return;
		}

		resolveResponse(message.body as [number, VariantDictionary]);
	};

	bus.connection.on("message", onMessage);

	try {
		await invokeRequest(requestToken);
	} catch (error: unknown) {
		rejectResponse(error instanceof Error ? error : new Error(String(error)));
	}

	try {
		const [response, results] = await responsePromise;

		if (response === 1) {
			throw new Error("The Wayland permission request was cancelled.");
		}

		if (response !== 0) {
			throw new Error(
				`The Wayland permission request failed with code ${response}.`,
			);
		}

		return results;
	} finally {
		bus.connection.off("message", onMessage);
		await removeMatch(bus, rule);
	}
}

function normalizeKey(value: string): string {
	const normalized = value.trim().toLowerCase();
	const aliases: Record<string, string> = {
		"`": "backquote",
		"-": "minus",
		"=": "equal",
		"[": "bracketleft",
		"]": "bracketright",
		"\\": "backslash",
		";": "semicolon",
		"'": "quote",
		",": "comma",
		".": "period",
		"/": "slash",
		esc: "escape",
		cmd: "meta",
		command: "meta",
		option: "alt",
		win: "meta",
	};

	return aliases[normalized] ?? normalized;
}

export function parseEvdevShortcut(
	shortcut: string,
	allowModifierOnly = false,
): ParsedEvdevShortcut {
	const modifiers: number[] = [];
	let key = 0;

	for (const rawToken of shortcut.split("+").map((part) => part.trim()).filter(Boolean)) {
		const normalized = normalizeKey(rawToken);
		const keycode = EVDEV_KEYS[normalized];

		if (!keycode) {
			throw new Error(`Unsupported Wayland shortcut key: ${rawToken}`);
		}

		if ([29, 42, 56, 125].includes(keycode)) {
			if (!modifiers.includes(keycode)) {
				modifiers.push(keycode);
			}
		} else if (key === 0) {
			key = keycode;
		} else {
			throw new Error(`Shortcut contains multiple main keys: ${shortcut}`);
		}
	}

	if (key === 0 && allowModifierOnly && modifiers.length > 0) {
		key = modifiers.pop()!;
	}

	if (key === 0) {
		throw new Error(`Unsupported Wayland shortcut: ${shortcut}`);
	}

	return { key, modifiers };
}

export function toPortalShortcut(shortcut: string): string {
	const modifierNames: string[] = [];
	let key = "";

	for (const rawToken of shortcut.split("+").map((part) => part.trim()).filter(Boolean)) {
		const normalized = normalizeKey(rawToken);

		if (normalized === "ctrl" || normalized === "control") {
			modifierNames.push("CTRL");
		} else if (normalized === "alt") {
			modifierNames.push("ALT");
		} else if (normalized === "shift") {
			modifierNames.push("SHIFT");
		} else if (["meta", "logo", "super"].includes(normalized)) {
			modifierNames.push("LOGO");
		} else if (!key) {
			key = normalized.length === 1
				? normalized
				: PORTAL_KEY_NAMES[normalized] ?? rawToken;
		} else {
			throw new Error(`Shortcut contains multiple main keys: ${shortcut}`);
		}
	}

	if (!key) {
		throw new Error(`The global shortcut needs a non-modifier key: ${shortcut}`);
	}

	return [...modifierNames, key].join("+");
}

async function closeSession(bus: NativeBus, sessionPath: string): Promise<void> {
	try {
		await new Promise<void>((resolve) => {
			bus.invoke(
				{
					destination: PORTAL_DESTINATION,
					path: sessionPath,
					interface: SESSION_INTERFACE,
					member: "Close",
				},
				() => resolve(),
			);
		});
	} catch {
		// The compositor may already have closed the session.
	}
}

async function readPortalState(path: string): Promise<PortalState> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as PortalState;
	} catch {
		return {};
	}
}

export async function createWaylandPortalController(optionsInput: {
	appId?: string;
	log(message: string): Promise<void>;
	onShortcut(): Promise<void>;
	portalStatePath: string;
	shortcut: string;
}): Promise<WaylandKeyboardController> {
	const dbus = require("@homebridge/dbus-native") as {
		sessionBus(): NativeBus;
	};
	const bus = dbus.sessionBus();
	await waitForBusName(bus);

	if (optionsInput.appId) {
		try {
			await invoke(
				bus,
				HOST_REGISTRY_INTERFACE,
				"Register",
				"sa{sv}",
				[optionsInput.appId, []],
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			await optionsInput.log(
				`Wayland app identity registration unavailable: ${message}`,
			);
		}
	}

	const state = await readPortalState(optionsInput.portalStatePath);
	const remoteSessionResults = await portalRequest(bus, (requestToken) =>
		invoke(
			bus,
			REMOTE_DESKTOP_INTERFACE,
			"CreateSession",
			"a{sv}",
			[options({
				handle_token: variant("s", requestToken),
				session_handle_token: variant("s", token()),
			})],
		)
	);
	const remoteSession = resultValue<string>(
		remoteSessionResults,
		"session_handle",
	);

	if (!remoteSession) {
		throw new Error("The Remote Desktop portal did not create a session.");
	}

	const selectOptions: Record<string, OutgoingVariant> = {
		types: variant("u", KEYBOARD_DEVICE),
		persist_mode: variant("u", 2),
	};

	if (state.remoteDesktopRestoreToken) {
		selectOptions.restore_token = variant(
			"s",
			state.remoteDesktopRestoreToken,
		);
	}

	await portalRequest(bus, (requestToken) =>
		invoke(
			bus,
			REMOTE_DESKTOP_INTERFACE,
			"SelectDevices",
			"oa{sv}",
			[
				remoteSession,
				options({
					...selectOptions,
					handle_token: variant("s", requestToken),
				}),
			],
		)
	);

	const startResults = await portalRequest(bus, (requestToken) =>
		invoke(
			bus,
			REMOTE_DESKTOP_INTERFACE,
			"Start",
			"osa{sv}",
			[
				remoteSession,
				"",
				options({ handle_token: variant("s", requestToken) }),
			],
		)
	);
	const selectedDevices = resultValue<number>(startResults, "devices") ?? 0;

	if ((selectedDevices & KEYBOARD_DEVICE) === 0) {
		await closeSession(bus, remoteSession);
		throw new Error("Keyboard control was not granted by the Wayland portal.");
	}

	const restoreToken = resultValue<string>(startResults, "restore_token");

	if (restoreToken) {
		await writeFile(
			optionsInput.portalStatePath,
			JSON.stringify({ remoteDesktopRestoreToken: restoreToken }, null, 2),
			"utf8",
		);
	}

	const globalSessionResults = await portalRequest(bus, (requestToken) =>
		invoke(
			bus,
			GLOBAL_SHORTCUTS_INTERFACE,
			"CreateSession",
			"a{sv}",
			[options({
				handle_token: variant("s", requestToken),
				session_handle_token: variant("s", token()),
			})],
		)
	);
	const globalSession = resultValue<string>(
		globalSessionResults,
		"session_handle",
	);

	if (!globalSession) {
		await closeSession(bus, remoteSession);
		throw new Error("The Global Shortcuts portal did not create a session.");
	}

	const listed = await portalRequest(bus, (requestToken) =>
		invoke(
			bus,
			GLOBAL_SHORTCUTS_INTERFACE,
			"ListShortcuts",
			"oa{sv}",
			[
				globalSession,
				options({ handle_token: variant("s", requestToken) }),
			],
		)
	);
	const existingShortcuts = resultValue<Array<[string, VariantDictionary]>>(
		listed,
		"shortcuts",
	) ?? [];

	if (!existingShortcuts.some(([id]) => id === SHORTCUT_ID)) {
		const bound = await portalRequest(bus, (requestToken) =>
			invoke(
				bus,
				GLOBAL_SHORTCUTS_INTERFACE,
				"BindShortcuts",
				"oa(sa{sv})sa{sv}",
				[
					globalSession,
					[[
						SHORTCUT_ID,
						options({
							description: variant("s", "Convert focused text"),
							preferred_trigger: variant(
								"s",
								toPortalShortcut(optionsInput.shortcut),
							),
						}),
					]],
					"",
					options({ handle_token: variant("s", requestToken) }),
				],
			)
		);
		const shortcuts = resultValue<Array<[string, VariantDictionary]>>(
			bound,
			"shortcuts",
		) ?? [];

		if (!shortcuts.some(([id]) => id === SHORTCUT_ID)) {
			await closeSession(bus, globalSession);
			await closeSession(bus, remoteSession);
			throw new Error("The KeyShift global shortcut was not granted.");
		}
	}

	const signalRule = [
		"type='signal'",
		`interface='${GLOBAL_SHORTCUTS_INTERFACE}'`,
		`path='${PORTAL_PATH}'`,
	].join(",");
	await addMatch(bus, signalRule);

	let shortcutActive = false;
	let closed = false;

	const onSignal = (message: NativeMessage): void => {
		if (
			message.path !== PORTAL_PATH ||
			message.interface !== GLOBAL_SHORTCUTS_INTERFACE
		) {
			return;
		}

		const [session, shortcutId] = message.body as [string, string];

		if (session !== globalSession || shortcutId !== SHORTCUT_ID) {
			return;
		}

		if (message.member === "Activated") {
			shortcutActive = true;
		} else if (message.member === "Deactivated" && shortcutActive && !closed) {
			shortcutActive = false;
			void optionsInput.onShortcut();
		}
	};

	bus.connection.on("message", onSignal);

	const tapEvdev = (
		keycode: number,
		stateValue: 0 | 1,
	): Promise<void> => invoke(
		bus,
		REMOTE_DESKTOP_INTERFACE,
		"NotifyKeyboardKeycode",
		"oa{sv}iu",
		[remoteSession, [], keycode, stateValue],
	).then(() => undefined);

	const tapShortcut = async (
		shortcut: string,
		allowModifierOnly = false,
	): Promise<void> => {
		const parsed = parseEvdevShortcut(shortcut, allowModifierOnly);

		for (const modifierKey of parsed.modifiers) {
			await tapEvdev(modifierKey, 1);
		}

		await tapEvdev(parsed.key, 1);
		await tapEvdev(parsed.key, 0);

		for (const modifierKey of [...parsed.modifiers].reverse()) {
			await tapEvdev(modifierKey, 0);
		}
	};

	await optionsInput.log(
		`Wayland portals ready. Shortcut=${optionsInput.shortcut}, ` +
			"KeyboardControl=granted.",
	);

	return {
		close: async () => {
			if (closed) {
				return;
			}

			closed = true;
			bus.connection.off("message", onSignal);
			await removeMatch(bus, signalRule);
			await closeSession(bus, globalSession);
			await closeSession(bus, remoteSession);
			bus.connection.end();
		},
		tapApplicationShortcut: (key) => tapShortcut(`Control+${key}`),
		tapEndOfText: () => tapShortcut("End"),
		tapKey: (key) => tapShortcut(key),
		tapShortcut: (shortcut) => tapShortcut(shortcut, true),
	};
}
