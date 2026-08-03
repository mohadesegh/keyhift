const assert = require("node:assert/strict");
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

assert.equal(getDefaultShortcut("win32"), "Control+Alt+K");
assert.equal(getDefaultShortcut("darwin"), "Command+Shift+K");
assert.equal(getDefaultShortcut("linux"), "Control+Shift+K");
assert.equal(getDefaultLanguageSwitchShortcut("darwin"), "Control+Space");
assert.equal(getDefaultLanguageSwitchShortcut("linux"), "Meta+Space");
assert.equal(getDefaultLanguageSwitchShortcut("win32"), "");
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

console.log("Portable layout tests passed.");
