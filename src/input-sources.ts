export function portableLayoutCode(layoutId: string): string | undefined {
	const normalized = layoutId.trim().toLowerCase();

	if (["en", "en-us", "us", "00000409"].includes(normalized)) {
		return "us";
	}

	if (
		["fa", "fa-ir", "ir", "persian", "00000429", "00050429"]
			.includes(normalized)
	) {
		return "ir";
	}

	return undefined;
}

export function parseGnomeInputSources(value: string): string[] {
	return [...value.matchAll(/\('xkb',\s*'([^']+)'\)/gu)]
		.map((match) => match[1]?.split("+")[0])
		.filter((layout): layout is string => Boolean(layout));
}

export interface XkbLayoutState {
	layouts: string[];
	variants: string[];
}

export function parseXkbQuery(value: string): XkbLayoutState {
	const field = (name: string): string[] => {
		const match = new RegExp(`^${name}:[ \\t]*(.*)$`, "mu").exec(value);
		return match?.[1] ? match[1].trim().split(",") : [];
	};
	const layouts = field("layout").filter(Boolean);
	const variants = field("variant");

	return {
		layouts,
		variants: layouts.map((_, index) => variants[index] ?? ""),
	};
}

export function prependXkbLayout(
	state: XkbLayoutState,
	layout: string,
): XkbLayoutState {
	const kept = state.layouts
		.map((name, index) => ({ name, variant: state.variants[index] ?? "" }))
		.filter((entry) => entry.name !== layout)
		// XKB supports at most four groups.
		.slice(0, 3);

	return {
		layouts: [layout, ...kept.map((entry) => entry.name)],
		variants: ["", ...kept.map((entry) => entry.variant)],
	};
}
