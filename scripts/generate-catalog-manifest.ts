import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCatalogManifest } from "../src/catalog.js";

const manifestPath = resolve(process.cwd(), "catalog-manifest.json");
const manifest = buildCatalogManifest();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${manifestPath}`);
