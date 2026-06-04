import { createHash } from "node:crypto";

const REDACTION_PREFIX = "[REDACTED:sha256:";

const sensitiveKeyPattern = /(?:^|[_-])(token|password|passwd|pwd|secret|api[_-]?key|apikey|authorization|auth[_-]?token|access[_-]?key|private[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token)(?:$|[_-])/i;
const envAssignmentPattern = /^([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;
const sensitiveEnvNamePattern = /(TOKEN|PASSWORD|PASSWD|PWD|SECRET|API_?KEY|AUTHORIZATION|ACCESS_?KEY|PRIVATE_?KEY|CLIENT_?SECRET|REFRESH_?TOKEN|ACCESS_?TOKEN)/i;

export function redactForModel<T>(value: T): T {
  return redactValue(value, []) as T;
}

export function redactTextForModel(value: string): string {
  return redactFreeText(value);
}

function redactValue(value: unknown, path: string[]): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const key = path[path.length - 1] ?? "";
    if (isSensitiveKey(key)) return fingerprint(value);
    if (key.toLowerCase() === "env") return redactEnvBlock(value);
    return redactFreeText(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    const key = path[path.length - 1] ?? "";
    return isSensitiveKey(key) ? fingerprint(String(value)) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, [...path, String(index)]));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = redactSensitiveLeaf(child);
      } else if (key.toLowerCase() === "env" && typeof child === "string") {
        out[key] = redactEnvBlock(child);
      } else {
        out[key] = redactValue(child, [...path, key]);
      }
    }
    return out;
  }

  return value;
}

function redactSensitiveLeaf(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return fingerprint(String(value));
  }
  return fingerprint(JSON.stringify(value));
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key);
}

function redactEnvBlock(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(envAssignmentPattern);
      if (!match) return redactFreeText(line);
      const [, name, separator, rawValue] = match;
      if (!sensitiveEnvNamePattern.test(name)) return `${name}${separator}${redactFreeText(rawValue)}`;
      return `${name}${separator}${fingerprint(stripShellQuotes(rawValue))}`;
    })
    .join("\n");
}

function redactFreeText(value: string): string {
  let redacted = value;

  redacted = redacted.replace(
    /((?:Bearer|Basic)\s+)([A-Za-z0-9._~+\-/=]{12,})/gi,
    (_match, prefix: string, secret: string) => `${prefix}${fingerprint(secret)}`,
  );

  redacted = redacted.replace(
    /((?:--build-arg\s+)?[A-Z0-9_]*(?:TOKEN|PASSWORD|PASSWD|PWD|SECRET|API_?KEY|AUTHORIZATION|ACCESS_?KEY|PRIVATE_?KEY|CLIENT_?SECRET|REFRESH_?TOKEN|ACCESS_?TOKEN)[A-Z0-9_]*\s*=\s*)(['"]?)([^'"\s]+)(\2)/gi,
    (_match, prefix: string, quote: string, secret: string, closeQuote: string) => `${prefix}${quote}${fingerprint(secret)}${closeQuote}`,
  );

  redacted = redacted.replace(
    /(\/api\/deploy\/)([A-Za-z0-9._~-]{12,})/g,
    (_match, prefix: string, secret: string) => `${prefix}${fingerprint(secret)}`,
  );

  redacted = redacted.replace(
    /([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)=)([^&#\s]+)/gi,
    (_match, prefix: string, secret: string) => `${prefix}${fingerprint(secret)}`,
  );

  return redacted;
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function fingerprint(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${REDACTION_PREFIX}${hash}]`;
}
