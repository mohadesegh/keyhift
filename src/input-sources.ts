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
