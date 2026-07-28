const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const hostPath = path.join(projectRoot, "native", "keyshift-host.exe");

if (process.platform !== "win32") {
	if (!existsSync(hostPath)) {
		console.error(
			[
				"The prebuilt Windows native host is missing:",
				hostPath,
				"Build the release on Windows once before packing it on this platform.",
			].join("\n"),
		);
		process.exitCode = 1;
	} else {
		console.log(
			`Skipping the Windows native-host build on ${process.platform}; ` +
				"the prebuilt host will be packaged.",
		);
	}
} else {
	const scriptPath = path.join(__dirname, "build-host.ps1");
	const result = spawnSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			scriptPath,
		],
		{ stdio: "inherit", windowsHide: true },
	);

	if (result.error) {
		console.error(`Unable to run the native-host build: ${result.error.message}`);
		process.exitCode = 1;
	} else if (result.status !== 0) {
		process.exitCode = result.status ?? 1;
	}
}
