// Called by semantic-release's prepare step with the new tag (e.g. v1.2.2-beta).
// Writes the tag minus its leading "v" to the files the app reads its version from.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2].replace(/^v/, "");

writeFileSync("backend/VERSION", `${version}\n`);

const pkgPath = "frontend/package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
