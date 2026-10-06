const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const npmExecPath = process.env.npm_execpath;
const tarballFlagIndex = process.argv.indexOf("--tarball");
const tarballPath = tarballFlagIndex >= 0
	? process.argv[tarballFlagIndex + 1]
	: undefined;

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

// CI verifies every packed tarball, including for versions that are already
// released, so the registry check only runs for an actual release.
if (!process.argv.includes("--skip-registry")) {
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
}

// Runs tar from the tarball's own directory with a relative name, because GNU
// tar treats a Windows drive letter such as D: as a remote host.
function runTar(arguments_) {
	const result = spawnSync(
		"tar",
		[...arguments_.slice(0, 1), path.basename(tarballPath), ...arguments_.slice(1)],
		{ cwd: path.dirname(path.resolve(tarballPath)), maxBuffer: 64 * 1024 * 1024 },
	);

	if (result.error || result.status !== 0) {
		fail(
			`tar failed for ${tarballPath}: ` +
				(result.error?.message || result.stderr?.toString().trim()),
		);
	}

	return result.stdout;
}

function listPackedFiles() {
	if (tarballFlagIndex >= 0) {
		if (!tarballPath) {
			fail("--tarball requires the path of a packed .tgz file.");
		}

		return runTar(["-tzf"])
			.toString("utf8")
			.split(/\r?\n/u)
			.filter((entry) => entry.startsWith("package/") && !entry.endsWith("/"))
			.map((entry) => entry.slice("package/".length));
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

	try {
		return JSON.parse(packed.stdout)[0].files.map((file) => file.path);
	} catch (error) {
		fail(`Unable to parse npm pack output: ${error.message}`);
	}
}

function readPackedFile(file) {
	return tarballFlagIndex >= 0
		? runTar(["-xzOf", `package/${file}`])
		: readFileSync(file);
}

const packedFiles = new Set(listPackedFiles());
const requiredFiles = [
	"dist/cli.js",
	"dist/config.js",
	"dist/input-sources.js",
	"dist/portable-host.js",
	"dist/portable-layouts.js",
	"dist/types.js",
	"dist/wayland-portals.js",
	"native/keyshift-host.exe",
];

for (const requiredFile of requiredFiles) {
	if (!packedFiles.has(requiredFile)) {
		fail(`packed tarball is missing ${requiredFile}.`);
	}
}

const packedManifest = JSON.parse(readPackedFile("package.json").toString("utf8"));

if (packedManifest.version !== packageJson.version) {
	fail(
		`the tarball contains version ${packedManifest.version}, ` +
			`but package.json is ${packageJson.version}.`,
	);
}

// The global-input and D-Bus modules must stay optional so installation
// succeeds on platforms without a prebuilt binary.
for (const optionalName of ["uiohook-napi", "@homebridge/dbus-native"]) {
	if (
		packedManifest.dependencies?.[optionalName] ||
		!packedManifest.optionalDependencies?.[optionalName]
	) {
		fail(`${optionalName} must be listed only in optionalDependencies.`);
	}
}

const hostExecutable = readPackedFile("native/keyshift-host.exe");

if (hostExecutable.length < 1024 || hostExecutable.toString("latin1", 0, 2) !== "MZ") {
	fail("native/keyshift-host.exe is not a Windows executable.");
}

// A carriage return after the shebang breaks the CLI on macOS and Linux.
if (!readPackedFile("dist/cli.js").toString("utf8").startsWith("#!/usr/bin/env node\n")) {
	fail("dist/cli.js must start with an LF-terminated node shebang.");
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
		`(${packedFiles.size} packed files).`,
);
