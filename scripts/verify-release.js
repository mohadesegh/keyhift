const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const npmExecPath = process.env.npm_execpath;

function fail(message) {
	console.error(`Release check failed: ${message}`);
	process.exit(1);
}

function runNpm(arguments_) {
	if (!npmExecPath) {
		fail("npm_execpath is unavailable; run this check through npm run release:check.");
	}

	return spawnSync(
		process.execPath,
		[npmExecPath, ...arguments_],
		{ encoding: "utf8" },
	);
}

if (
	packageLock.version !== packageJson.version ||
	packageLock.packages?.[""]?.version !== packageJson.version
) {
	fail("package.json and package-lock.json versions do not match.");
}

const published = runNpm([
	"view",
	`${packageJson.name}@${packageJson.version}`,
	"version",
	"--json",
]);

if (published.status === 0 && published.stdout.trim()) {
	fail(`${packageJson.name}@${packageJson.version} is already published.`);
}

if (!/E404|not in this registry|No match found/u.test(published.stderr || "")) {
	fail(
		`Unable to confirm that ${packageJson.name}@${packageJson.version} is available. ` +
			(published.stderr?.trim() || published.error?.message || "npm view failed"),
	);
}

const packed = runNpm([
	"pack",
	"--dry-run",
	"--ignore-scripts",
	"--json",
]);

if (packed.status !== 0) {
	fail(packed.stderr?.trim() || packed.error?.message || "npm pack failed");
}

let manifest;

try {
	manifest = JSON.parse(packed.stdout)[0];
} catch (error) {
	fail(`Unable to parse npm pack output: ${error.message}`);
}

const packedFiles = new Set(manifest.files.map((file) => file.path));
const requiredFiles = [
	"dist/cli.js",
	"dist/config.js",
	"dist/input-sources.js",
	"dist/portable-host.js",
	"dist/portable-layouts.js",
	"native/keyshift-host.exe",
];

for (const requiredFile of requiredFiles) {
	if (!packedFiles.has(requiredFile)) {
		fail(`packed tarball is missing ${requiredFile}.`);
	}
}

if (
	process.env.npm_lifecycle_event === "prepublishOnly" &&
	process.env.KEYSHIFT_RELEASE_APPROVED !== "true"
) {
	fail(
		"publishing requires KEYSHIFT_RELEASE_APPROVED=true after all native integration gates pass.",
	);
}

console.log(
	`Release check passed for ${packageJson.name}@${packageJson.version} ` +
		`(${manifest.files.length} packed files).`,
);
