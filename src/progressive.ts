import {
  CapabilityMode,
  CapabilitySpec,
  JsonSchemaObject,
  ServerContext,
  capabilitySpecs,
  directToolMap,
  executeToolSpec,
  getCapabilitySpec,
  getDiscoverableCapabilities,
} from "./catalog.js";

type ProgressiveRisk = "read" | "write";

type DiscoverResult = {
  ok: true;
  intent: string;
  risk: ProgressiveRisk;
  capabilities: Array<{
    id: string;
    mode: CapabilityMode;
    summary: string;
    category: string;
    safetyClass: CapabilitySpec["safetyClass"];
  }>;
  totalMatches: number;
  nextStep: string;
};

type CapabilitySchemaResult =
  | {
      ok: true;
      capabilityId: string;
      mode: CapabilityMode;
      category: string;
      safetyClass: CapabilitySpec["safetyClass"];
      description: string;
      argsSchema: JsonSchemaObject;
      example: Record<string, unknown>;
      aliases: string[];
    }
  | {
      ok: false;
      error: "unknown_capability";
      capabilityId: string;
      available: string[];
    };

type ExecuteOkResult = {
  ok: true;
  capabilityId: string;
  data: unknown;
};

type ExecuteErrorResult = {
  ok: false;
  capabilityId?: string;
  error?: string;
  blocked?: boolean;
  reason?: string;
  allowed?: string[];
};

const DISCOVER_LIMIT = 8;
const categoryOrder = [
  "projects",
  "services",
  "apps",
  "boxes",
  "wordpress",
  "databases",
  "compose",
  "domains",
  "ports",
  "mounts",
  "monitoring",
  "actions",
  "admin",
  "system",
  "templates",
  "escape-hatch",
] as const;

const writeVerbRegex = /(deploy|create|publish|write|update|delete|destroy|remove|start|stop|restart|reboot|prune|set|cleanup|run)/;
const explicitDangerRegex = /(delete|destroy|remove|reboot|prune|raw|mutation|template|cleanup)/;
const rawRegex = /(trpc|raw|procedure|query|mutation|escape)/;
const tokenSynonyms: Record<string, string[]> = {
  proyecto: ["project", "projects"],
  proyectos: ["project", "projects"],
  servicio: ["service", "services"],
  servicios: ["service", "services"],
  puerto: ["port", "ports"],
  puertos: ["port", "ports"],
  dominio: ["domain", "domains"],
  dominios: ["domain", "domains"],
  montar: ["mount", "mounts", "volume", "volumes"],
  montaje: ["mount", "mounts", "volume", "volumes"],
  volumen: ["volume", "volumes", "mount", "mounts"],
  volumenes: ["volume", "volumes", "mount", "mounts"],
  app: ["app", "apps"],
  aplicacion: ["app", "apps"],
  aplicaciones: ["app", "apps"],
  box: ["box", "boxes", "devbox", "workspace", "ide"],
  wordpress: ["wordpress", "wp", "blog", "cms"],
  notas: ["notes", "annotation", "metadata"],
  nota: ["notes", "annotation", "metadata"],
  error: ["error", "failure", "diagnostics"],
  errores: ["error", "errors", "failure", "diagnostics"],
  renombrar: ["rename", "move", "transfer"],
  base: ["database", "databases", "db"],
  datos: ["database", "databases", "db"],
  bases: ["database", "databases", "db"],
  despliegue: ["deploy", "deployment", "build"],
  desplegar: ["deploy", "deployment"],
  crear: ["create", "new"],
  borrar: ["delete", "destroy", "remove"],
  eliminar: ["delete", "destroy", "remove"],
  reiniciar: ["restart", "reboot"],
  estadisticas: ["stats", "metrics"],
  acciones: ["actions", "history", "logs"],
  certificados: ["certificates", "ssl", "tls"],
  nodos: ["nodes", "cluster"],
  usuarios: ["users", "accounts"],
  plantilla: ["template", "templates"],
};

export const progressiveExternalTools = [
  "ep_discover",
  "ep_capability_schema",
  "ep_execute_read",
  "ep_execute_write_guarded",
] as const;

export function inferRisk(intent: string, rawRisk?: string): ProgressiveRisk {
  const normalizedRisk = String(rawRisk || "").trim().toLowerCase();
  if (normalizedRisk === "read" || normalizedRisk === "write") {
    return normalizedRisk;
  }
  return writeVerbRegex.test(intent) ? "write" : "read";
}

export function discoverCapabilities(intentInput?: string, rawRisk?: string): DiscoverResult {
  const intent = normalizeText(intentInput || "");
  const risk = inferRisk(intent, rawRisk);
  const candidates = getDiscoverableCapabilities().filter((capability) => risk === "read" ? capability.mode === "read" : true);
  const scored = candidates.map((capability) => ({
    capability,
    score: scoreCapability(capability, intent, risk),
  }));

  const sorted = scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.capability.id.localeCompare(b.capability.id);
    });

  const strongMatches = sorted.filter((entry) => entry.score > 0);
  const ordered = strongMatches.length
    ? fillWithFallback(strongMatches.map((entry) => entry.capability), candidates)
    : buildFallbackCandidates(candidates);

  return {
    ok: true,
    intent,
    risk,
    capabilities: ordered.slice(0, DISCOVER_LIMIT).map(toDiscoverableShape),
    totalMatches: strongMatches.length || candidates.length,
    nextStep: "Call ep_capability_schema then ep_execute_read/ep_execute_write_guarded.",
  };
}

export function getCapabilitySchema(capabilityId: string): CapabilitySchemaResult {
  const capability = getCapabilitySpec(capabilityId.trim());
  if (!capability) {
    return {
      ok: false,
      error: "unknown_capability",
      capabilityId,
      available: capabilitySpecs.map((spec) => spec.id),
    };
  }

  const aliases = capability.aliasOf
    ? [capability.aliasOf]
    : capability.aliases;

  return {
    ok: true,
    capabilityId: capability.id,
    mode: capability.mode,
    category: capability.category,
    safetyClass: capability.safetyClass,
    description: capability.description,
    argsSchema: capability.argsSchema,
    example: capability.example,
    aliases,
  };
}

export function parseCapabilityArgs(
  capabilityId: string,
  rawArgs: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string; capabilityId: string } {
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    return { ok: true, args: rawArgs as Record<string, unknown> };
  }

  if (typeof rawArgs === "string") {
    const trimmed = rawArgs.trim();
    if (!trimmed) return { ok: true, args: {} };

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, args: parsed as Record<string, unknown> };
      }
      return { ok: false, capabilityId, error: "args_must_be_json_object" };
    } catch {
      return { ok: false, capabilityId, error: "invalid_args_json" };
    }
  }

  return { ok: true, args: {} };
}

export async function executeReadCapability(
  ctx: ServerContext,
  capabilityId: string,
  rawArgs: unknown,
): Promise<ExecuteOkResult | ExecuteErrorResult> {
  const parsedArgs = parseCapabilityArgs(capabilityId, rawArgs);
  if (!parsedArgs.ok) return parsedArgs;

  const capability = getCapabilitySpec(capabilityId.trim());
  if (!capability || capability.mode !== "read") {
    return {
      ok: false,
      capabilityId,
      error: "unsupported_read_capability",
      allowed: capabilitySpecs.filter((spec) => spec.mode === "read").map((spec) => spec.id),
    };
  }

  return runCapability(ctx, capability, parsedArgs.args);
}

export async function executeWriteCapability(
  ctx: ServerContext,
  capabilityId: string,
  rawArgs: unknown,
  approved: boolean,
): Promise<ExecuteOkResult | ExecuteErrorResult> {
  const parsedArgs = parseCapabilityArgs(capabilityId, rawArgs);
  if (!parsedArgs.ok) return parsedArgs;

  const capability = getCapabilitySpec(capabilityId.trim());
  if (!capability || capability.mode !== "write_guarded") {
    return {
      ok: false,
      capabilityId,
      error: "unsupported_write_capability",
      allowed: capabilitySpecs.filter((spec) => spec.mode === "write_guarded").map((spec) => spec.id),
    };
  }

  if (!approved) {
    return {
      ok: false,
      capabilityId,
      blocked: true,
      reason: "write_requires_approved_true",
    };
  }

  return runCapability(ctx, capability, parsedArgs.args);
}

function toDiscoverableShape(capability: CapabilitySpec) {
  return {
    id: capability.id,
    mode: capability.mode,
    summary: capability.summary,
    category: capability.category,
    safetyClass: capability.safetyClass,
  };
}

async function runCapability(
  ctx: ServerContext,
  capability: CapabilitySpec,
  args: Record<string, unknown>,
): Promise<ExecuteOkResult | ExecuteErrorResult> {
  const toolSpec = directToolMap.get(capability.toolName);
  if (!toolSpec) {
    return {
      ok: false,
      capabilityId: capability.id,
      error: `missing_tool_spec:${capability.toolName}`,
    };
  }

  try {
    const mappedArgs = capability.mapArgs ? capability.mapArgs(args) : args;
    const result = await executeToolSpec(ctx, toolSpec, mappedArgs);
    return {
      ok: true,
      capabilityId: capability.id,
      data: capability.transformResult ? capability.transformResult(result, args) : result,
    };
  } catch (error) {
    return {
      ok: false,
      capabilityId: capability.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildFallbackCandidates(candidates: CapabilitySpec[]): CapabilitySpec[] {
  const byCategory = new Map<string, CapabilitySpec[]>();
  for (const capability of candidates) {
    const list = byCategory.get(capability.category) ?? [];
    list.push(capability);
    byCategory.set(capability.category, list);
  }

  const ordered: CapabilitySpec[] = [];
  for (const category of categoryOrder) {
    const list = sortCapabilities(byCategory.get(category) ?? []);
    if (list[0]) ordered.push(list[0]);
  }

  const remaining = sortCapabilities(
    candidates.filter((candidate) => !ordered.some((item) => item.id === candidate.id)),
  );

  return [...ordered, ...remaining].slice(0, DISCOVER_LIMIT);
}

function fillWithFallback(primary: CapabilitySpec[], candidates: CapabilitySpec[]): CapabilitySpec[] {
  const seen = new Set(primary.map((capability) => capability.id));
  const fallback = buildFallbackCandidates(candidates).filter((capability) => !seen.has(capability.id));
  return [...primary, ...fallback];
}

function sortCapabilities(capabilities: CapabilitySpec[]): CapabilitySpec[] {
  return [...capabilities].sort((a, b) => {
    const rawPenaltyDiff = rawCapabilityPenalty(a) - rawCapabilityPenalty(b);
    if (rawPenaltyDiff !== 0) return rawPenaltyDiff;
    const safetyDiff = safetyRank(a.safetyClass) - safetyRank(b.safetyClass);
    if (safetyDiff !== 0) return safetyDiff;
    return a.id.localeCompare(b.id);
  });
}

function rawCapabilityPenalty(capability: CapabilitySpec) {
  return capability.id.startsWith("ep.trpc_raw") ? 1 : 0;
}

function safetyRank(safetyClass: CapabilitySpec["safetyClass"]) {
  switch (safetyClass) {
    case "safe":
      return 0;
    case "guarded":
      return 1;
    case "dangerous":
      return 2;
  }
}

function scoreCapability(capability: CapabilitySpec, intent: string, risk: ProgressiveRisk) {
  const tokens = tokenize(intent);
  const searchable = [
    capability.id,
    capability.toolName,
    capability.category,
    capability.summary,
    capability.description,
    ...capability.keywords,
  ].map(normalizeText);

  let score = 0;
  for (const token of tokens) {
    if (capability.toolName.includes(token)) score += 8;
    if (capability.id.includes(token)) score += 7;
    if (capability.category.includes(token)) score += 5;
    if (capability.keywords.some((keyword) => normalizeText(keyword).includes(token))) score += 4;
    if (searchable.some((value) => value.includes(token))) score += 2;
  }

  if (!tokens.length) {
    score += capability.mode === "read" ? 1 : 0;
  }

  if (capability.mode === "read" && risk === "read") score += 1;
  if (capability.mode === "write_guarded" && risk === "write") score += 1;

  const explicitDanger = explicitDangerRegex.test(intent);
  if (capability.safetyClass === "dangerous" && !explicitDanger) {
    score -= 3;
  }

  if (capability.id.startsWith("ep.trpc_raw")) {
    score -= 2;
    if (rawRegex.test(intent)) score += 8;
  }

  return score;
}

function tokenize(intent: string) {
  const rawTokens = normalizeText(intent).split(/\s+/).filter(Boolean);
  const expanded = new Set<string>();

  for (const token of rawTokens) {
    expanded.add(token);
    for (const synonym of tokenSynonyms[token] ?? []) {
      expanded.add(synonym);
    }
  }

  return Array.from(expanded);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
