import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { catalogProcedureNames } from "../src/catalog.js";

const openapiFile = process.env.OPENAPI_FILE;
const openapiUrl = resolveOpenApiUrl(process.env.EASYPANEL_OPENAPI_URL, process.env.EASYPANEL_URL);

if (!openapiFile && !openapiUrl) {
  console.error("Set OPENAPI_FILE, EASYPANEL_OPENAPI_URL, or EASYPANEL_URL before running audit:openapi.");
  process.exit(1);
}

const source = openapiFile ? `file:${resolve(process.cwd(), openapiFile)}` : String(openapiUrl);
const rawSpec = openapiFile ? readFileSync(resolve(process.cwd(), openapiFile), "utf8") : await fetchOpenApi(String(openapiUrl));
const missing = catalogProcedureNames.filter((procedure) => !rawSpec.includes(procedure));

console.log(
  JSON.stringify(
    {
      source,
      checkedProcedures: catalogProcedureNames.length,
      missingProcedures: missing.length,
      missing,
    },
    null,
    2,
  ),
);

if (missing.length) {
  process.exit(1);
}

function resolveOpenApiUrl(explicitUrl?: string, panelUrl?: string) {
  if (explicitUrl) {
    return explicitUrl;
  }

  if (!panelUrl) {
    return undefined;
  }

  return `${panelUrl.replace(/\/+$/, "")}/api/openapi.json`;
}

async function fetchOpenApi(url: string) {
  const headers: Record<string, string> = {};
  if (process.env.EASYPANEL_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EASYPANEL_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI from ${url}: HTTP ${response.status}`);
  }

  return await response.text();
}
