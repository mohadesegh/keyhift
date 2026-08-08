const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	convertPortableText,
	normalizePortableLayoutId,
} = require("../dist/portable-layouts.js");
const {
	parseGnomeInputSources,
	portableLayoutCode,
} = require("../dist/input-sources.js");
const {
	getDefaultLanguageSwitchShortcut,
	getDefaultShortcut,
} = require("../dist/config.js");
const {
	parseEvdevShortcut,
	toPortalShortcut,
} = require("../dist/wayland-portals.js");

assert.equal(getDefaultShortcut("win32"), "Control+Alt+K");
assert.equal(getDefaultShortcut("darwin"), "Command+Shift+K");
assert.equal(getDefaultShortcut("linux"), "Control+Shift+K");
assert.equal(getDefaultLanguageSwitchShortcut("darwin"), "Control+Space");
assert.equal(getDefaultLanguageSwitchShortcut("linux"), "Meta+Space");
assert.equal(getDefaultLanguageSwitchShortcut("win32"), "");
assert.equal(toPortalShortcut("Control+Shift+K"), "CTRL+SHIFT+k");
assert.equal(toPortalShortcut("Meta+Space"), "LOGO+space");
assert.deepEqual(parseEvdevShortcut("Control+A"), {
	key: 30,
	modifiers: [29],
});
assert.deepEqual(parseEvdevShortcut("Meta+Space"), {
	key: 57,
	modifiers: [125],
});
assert.throws(
	() => parseEvdevShortcut("Control+F13"),
	/Unsupported Wayland shortcut key: F13/,
);
assert.equal(portableLayoutCode("en-US"), "us");
assert.equal(portableLayoutCode("00000429"), "ir");
assert.deepEqual(
	parseGnomeInputSources("[('xkb', 'us'), ('ibus', 'mozc-jp'), ('xkb', 'ir+pes_keypad')]"),
	["us", "ir"],
);

assert.equal(normalizePortableLayoutId("00000409"), "en-US");
assert.equal(normalizePortableLayoutId("persian"), "fa-IR");
assert.throws(
	() => normalizePortableLayoutId("de-DE"),
	/Portable layout "de-DE" is not supported/,
);

assert.equal(
	convertPortableText(
		"sghl",
		"en-US",
		"fa-IR",
		"auto",
		"hybrid",
	).text,
	"سلام",
);

assert.equal(
	convertPortableText(
		"qwerty 123",
		"en-US",
		"fa-IR",
		"pair",
		"content",
	).text,
	"ضصثقفغ ۱۲۳",
);

assert.equal(
	convertPortableText(
		"سلام",
		"en-US",
		"fa-IR",
		"auto",
		"content",
	).text,
	"sghl",
);

assert.equal(
	convertPortableText(
		"sghl",
		"00000409",
		"00000429",
		"pair",
		"hybrid",
	).text,
	"سلام",
);

assert.equal(
	convertPortableText(
		"ضصث",
		"fa-IR",
		"en-US",
		"pair",
		"hybrid",
	).text,
	"qwe",
);

const uninstallTestRoot = mkdtempSync(
	path.join(os.tmpdir(), "keyshift-uninstall-"),
);

try {
	const appDataRoot = path.join(uninstallTestRoot, "appdata");
	const xdgConfigRoot = path.join(uninstallTestRoot, "config");
	const xdgDataRoot = path.join(uninstallTestRoot, "data");
	const testEnvironment = {
		...process.env,
		APPDATA: appDataRoot,
		HOME: uninstallTestRoot,
		XDG_CONFIG_HOME: xdgConfigRoot,
		XDG_DATA_HOME: xdgDataRoot,
	};
	const cliPath = path.resolve(__dirname, "../dist/cli.js");
	const expectedAppDirectory = process.platform === "win32"
		? path.join(appDataRoot, "keyshift")
		: process.platform === "darwin"
			? path.join(uninstallTestRoot, "Library", "Application Support", "keyshift")
			: path.join(xdgConfigRoot, "keyshift");

	const initialized = spawnSync(process.execPath, [cliPath, "init"], {
		encoding: "utf8",
		env: testEnvironment,
	});
	assert.equal(initialized.status, 0, initialized.stderr);
	assert.equal(existsSync(expectedAppDirectory), true);

	if (process.platform === "linux") {
		const applicationsDirectory = path.join(xdgDataRoot, "applications");
		mkdirSync(applicationsDirectory, { recursive: true });
		writeFileSync(
			path.join(
				applicationsDirectory,
				"io.github.mohadesegh.KeyShift.desktop",
			),
			"KeyShift test entry",
		);
	}

	const uninstalled = spawnSync(
		process.execPath,
		[cliPath, "uninstall", "--keep-package"],
		{
			encoding: "utf8",
			env: testEnvironment,
			timeout: 10_000,
		},
	);
	assert.equal(uninstalled.status, 0, uninstalled.stderr);
	assert.equal(existsSync(expectedAppDirectory), false);
	assert.match(uninstalled.stdout, /runtime files removed/u);

	if (process.platform === "linux") {
		assert.equal(
			existsSync(
				path.join(
					xdgDataRoot,
					"applications",
					"io.github.mohadesegh.KeyShift.desktop",
				),
			),
			false,
		);
	}

	const fakeNpmDirectory = path.join(uninstallTestRoot, "fake-npm");
	mkdirSync(fakeNpmDirectory, { recursive: true });
	const fakeNpmPath = path.join(
		fakeNpmDirectory,
		process.platform === "win32" ? "npm.cmd" : "npm",
	);
	writeFileSync(
		fakeNpmPath,
		process.platform === "win32"
			? "@echo off\r\nexit /b 0\r\n"
			: "#!/bin/sh\nexit 0\n",
	);
	if (process.platform !== "win32") {
		chmodSync(fakeNpmPath, 0o755);
	}

	const fullUninstallEnvironment = {
		...testEnvironment,
		PATH: `${fakeNpmDirectory}${path.delimiter}${testEnvironment.PATH ?? ""}`,
	};
	const reinitialized = spawnSync(process.execPath, [cliPath, "init"], {
		encoding: "utf8",
		env: fullUninstallEnvironment,
	});
	assert.equal(reinitialized.status, 0, reinitialized.stderr);

	const fullyUninstalled = spawnSync(
		process.execPath,
		[cliPath, "uninstall"],
		{
			encoding: "utf8",
			env: fullUninstallEnvironment,
			timeout: 10_000,
		},
	);
	assert.equal(fullyUninstalled.status, 0, fullyUninstalled.stderr);
	assert.equal(existsSync(expectedAppDirectory), false);
	assert.match(fullyUninstalled.stdout, /uninstalled successfully/u);
} finally {
	rmSync(uninstallTestRoot, { force: true, recursive: true });
}

console.log("Portable layout and uninstall tests passed.");
