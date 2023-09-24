import fs from "fs";
import { execSync } from "child_process";

// Function to execute shell command and return the output
function execCommand(command) {
	try {
		return execSync(command).toString().trim();
	} catch (error) {
		console.error(`Failed to execute command: ${command}`, error);
		process.exit(1);
	}
}

// Read command-line arguments for version
const [, , versionArg] = process.argv;

if (!versionArg) {
	console.error("Please provide a version number.");
	process.exit(1);
}

// Identify current branch
const currentBranch = execCommand("git branch --show-current");
console.log(`Current branch is ${currentBranch}`);

// Check if there are any uncommitted changes
const isWorkingTreeClean = execCommand("git status --porcelain") === "";
if (!isWorkingTreeClean) {
	console.error(
		"Your git working tree is not clean. Please commit or stash your changes first."
	);
	process.exit(1);
}

// Read manifest.json
try {
	const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf-8"));

	// Update version
	manifest.version = versionArg;
	fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));
} catch (error) {
	console.error("Failed to read or write manifest.json", error);
	process.exit(1);
}

// Git commit, tag, and push
execCommand(`git add manifest.json`);
execCommand(`git commit -m "Bump to version ${versionArg}"`);
execCommand(`git tag ${versionArg}`);
execCommand(`git push origin ${currentBranch}`);
execCommand(`git push origin ${versionArg}`);
