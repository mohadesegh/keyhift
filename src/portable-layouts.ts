import type {
	DirectionDetection,
	LayoutMode,
} from "./types.js";

interface PortableLayout {
	id: string;
	name: string;
	aliases: string[];
	plain: string[];
	shift: string[];
	isRightToLeft: boolean;
}

const US_PLAIN = [
	"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=",
	"q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\",
	"a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'",
	"z", "x", "c", "v", "b", "n", "m", ",", ".", "/",
];

const US_SHIFT = [
	"~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+",
	"Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "{", "}", "|",
	"A", "S", "D", "F", "G", "H", "J", "K", "L", ":", "\"",
	"Z", "X", "C", "V", "B", "N", "M", "<", ">", "?",
];

// Persian ISIRI 9147, the standard Persian layout used by current macOS and
// Linux keyboard definitions. The legacy Windows layout ID is accepted as an
// alias so an existing KeyShift config remains portable.
const PERSIAN_PLAIN = [
	"\u200d", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹", "۰", "-", "=",
	"ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج", "چ", "\\",
	"ش", "س", "ی", "ب", "ل", "ا", "ت", "ن", "م", "ک", "گ",
	"ظ", "ط", "ز", "ر", "ذ", "د", "پ", "و", ".", "/",
];

const PERSIAN_SHIFT = [
	"÷", "!", "٬", "٫", "﷼", "٪", "×", "،", "*", ")", "(", "ـ", "+",
	"ْ", "ٌ", "ٍ", "ً", "ُ", "ِ", "َ", "ّ", "]", "[", "}", "{", "|",
	"ؤ", "ئ", "ي", "إ", "أ", "آ", "ة", "«", "»", ":", "؛",
	"ك", "ٓ", "ژ", "ٰ", "\u200c", "ٔ", "ء", "<", ">", "؟",
];

const layouts: PortableLayout[] = [
	{
		id: "en-US",
		name: "English (US)",
		aliases: ["en", "us", "00000409"],
		plain: US_PLAIN,
		shift: US_SHIFT,
		isRightToLeft: false,
	},
	{
		id: "fa-IR",
		name: "Persian (ISIRI 9147)",
		aliases: [
			"fa",
			"ir",
			"persian",
			"00000429",
			"00050429",
		],
		plain: PERSIAN_PLAIN,
		shift: PERSIAN_SHIFT,
		isRightToLeft: true,
	},
];

function normalizeAlias(value: string): string {
	return value.trim().replace(/^0x/i, "").toLowerCase();
}

export function resolvePortableLayout(value: string): PortableLayout {
	const normalized = normalizeAlias(value);
	const layout = layouts.find((candidate) =>
		candidate.id.toLowerCase() === normalized ||
		candidate.aliases.some((alias) => alias.toLowerCase() === normalized),
	);

	if (!layout) {
		throw new Error(
			`Portable layout "${value}" is not supported. ` +
				"Run `keyshift layouts` to list supported layout IDs.",
		);
	}

	return layout;
}

export function normalizePortableLayoutId(value: string): string {
	return resolvePortableLayout(value).id;
}

export function formatPortableLayouts(): string {
	return layouts
		.map((layout) => {
			const aliases = layout.aliases.join(", ");
			return `${layout.id}  ${layout.name}\n  aliases: ${aliases}`;
		})
		.join("\n");
}

function createCharacterMap(
	source: PortableLayout,
	target: PortableLayout,
): Map<string, string> {
	const sourceCharacters = [...source.plain, ...source.shift];
	const targetCharacters = [...target.plain, ...target.shift];
	const result = new Map<string, string>();

	for (let index = 0; index < sourceCharacters.length; index++) {
		const sourceCharacter = sourceCharacters[index];
		const targetCharacter = targetCharacters[index];

		if (sourceCharacter && targetCharacter && !result.has(sourceCharacter)) {
			result.set(sourceCharacter, targetCharacter);
		}
	}

	return result;
}

function countScripts(text: string): {
	latin: number;
	rtl: number;
} {
	let latin = 0;
	let rtl = 0;

	for (const character of text) {
		if (/[A-Za-z]/u.test(character)) {
			latin++;
		} else if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(character)) {
			rtl++;
		}
	}

	return { latin, rtl };
}

function countConvertible(text: string, layout: PortableLayout): number {
	const characters = new Set([...layout.plain, ...layout.shift]);
	let count = 0;

	for (const character of text) {
		if (!/\s/u.test(character) && characters.has(character)) {
			count++;
		}
	}

	return count;
}

function determineDirection(
	text: string,
	first: PortableLayout,
	second: PortableLayout,
	mode: LayoutMode,
	detection: DirectionDetection,
): [PortableLayout, PortableLayout] {
	if (mode === "pair") {
		return [first, second];
	}

	const scripts = countScripts(text);

	if (scripts.rtl > scripts.latin) {
		if (first.isRightToLeft !== second.isRightToLeft) {
			return first.isRightToLeft ? [first, second] : [second, first];
		}
	}

	if (scripts.latin > scripts.rtl) {
		if (first.isRightToLeft !== second.isRightToLeft) {
			return first.isRightToLeft ? [second, first] : [first, second];
		}
	}

	const firstScore = countConvertible(text, first);
	const secondScore = countConvertible(text, second);

	if (secondScore > firstScore) {
		return [second, first];
	}

	// Portable hosts cannot reliably query the focused application's active
	// layout on every desktop, so active-layout and hybrid use content as the
	// deterministic fallback when the scores tie.
	void detection;
	return [first, second];
}

export function convertPortableText(
	text: string,
	sourceId: string,
	targetId: string,
	mode: LayoutMode,
	detection: DirectionDetection,
): {
	text: string;
	source: string;
	target: string;
} {
	const first = resolvePortableLayout(sourceId);
	const second = resolvePortableLayout(targetId);
	const [source, target] = determineDirection(
		text,
		first,
		second,
		mode,
		detection,
	);
	const characterMap = createCharacterMap(source, target);
	let converted = "";

	for (const character of text) {
		converted += characterMap.get(character) ?? character;
	}

	return {
		text: converted,
		source: source.id,
		target: target.id,
	};
}
