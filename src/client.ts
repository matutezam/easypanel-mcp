import http from "node:http";
import https from "node:https";

export interface EasyPanelClientOptions {
  /**
   * Invoked when the Easypanel API rejects a call as unauthenticated/forbidden
   * (HTTP 401/403 or tRPC code UNAUTHORIZED/FORBIDDEN). Fire-and-forget; used
   * by the OAuth layer to revoke the bound access+refresh token so the next
   * MCP call forces a re-login.
   */
  onAuthFailure?: () => void;
  /**
   * Extra headers to send on every request. Intended for things like
   * Cloudflare Access service tokens (CF-Access-Client-Id / CF-Access-Client-Secret)
   * so the shim can reach an Easypanel API that sits behind CF Zero Trust.
   */
  extraHeaders?: Record<string, string>;
}

export class EasyPanelClient {
  private baseUrl: string;
  private token: string | null = null;
  private onAuthFailure?: () => void;
  private extraHeaders: Record<string, string>;

  constructor(baseUrl: string, token?: string, opts?: EasyPanelClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token ?? null;
    this.onAuthFailure = opts?.onAuthFailure;
    this.extraHeaders = opts?.extraHeaders ?? {};
  }

  async login(email: string, password: string): Promise<string> {
    const result = await this.mutation("auth.login", { email, password });
    this.token = result.token as string;
    return this.token;
  }

  async query(procedure: string, input?: Record<string, unknown>): Promise<unknown> {
    if (input && Object.keys(input).length) {
      try {
        return await this.request("POST", this.buildRpcUrl(procedure), { json: input });
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        return this.request("POST", `${this.baseUrl}/api/trpc/${procedure}`, { json: input });
      }
    }

    try {
      return await this.request("GET", this.buildRpcUrl(procedure));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      return this.request("GET", this.buildTrpcQueryUrl(procedure, input));
    }
  }

  async mutation(procedure: string, input: Record<string, unknown>): Promise<any> {
    try {
      return await this.request("POST", this.buildRpcUrl(procedure), { json: input });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      return this.request("POST", `${this.baseUrl}/api/trpc/${procedure}`, { json: input });
    }
  }

  private buildRpcUrl(procedure: string, input?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}/api/rpc/${procedure.replace(/\./g, "/")}`);
    for (const [key, value] of Object.entries(input ?? {})) {
      if (value === undefined) continue;
      appendQueryValue(url.searchParams, key, value);
    }
    return url.toString();
  }

  private buildTrpcQueryUrl(procedure: string, input?: Record<string, unknown>): string {
    let url = `${this.baseUrl}/api/trpc/${procedure}`;
    if (input) {
      url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    }
    return url;
  }

  private fireAuthFailure(): void {
    if (!this.onAuthFailure) return;
    try { this.onAuthFailure(); } catch { /* swallow */ }
  }

  private request(method: string, url: string, body?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === "https:" ? https : http;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...this.extraHeaders,
      };
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }
      const bodyStr = body ? JSON.stringify(body) : undefined;
      if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();

      const req = mod.request(parsed, { method, headers }, (res) => {
        const status = res.statusCode ?? 0;
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const httpAuthFailed = status === 401 || status === 403;
          try {
            const json = JSON.parse(data);
            const errorInfo = extractApiError(json, status);
            const apiAuthFailed = errorInfo?.code === "UNAUTHORIZED" || errorInfo?.code === "FORBIDDEN";
            if (httpAuthFailed || apiAuthFailed) this.fireAuthFailure();

            if (errorInfo) {
              reject(new EasyPanelApiError(errorInfo.message, errorInfo.code, errorInfo.status));
            } else if (json.result?.data?.json !== undefined) {
              resolve(json.result.data.json);
            } else if (json.json !== undefined && Object.keys(json).every((key) => key === "json" || key === "meta")) {
              resolve(json.json);
            } else {
              resolve(json);
            }
          } catch {
            if (httpAuthFailed) this.fireAuthFailure();
            if (status === 404) {
              reject(new EasyPanelApiError("Not found", "NOT_FOUND", 404));
            } else if (status >= 400) {
              reject(new EasyPanelApiError(data.slice(0, 500) || `HTTP ${status}`, undefined, status));
            } else {
              reject(new Error(`Invalid response: ${data.slice(0, 500)}`));
            }
          }
        });
      });
      req.on("error", reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }
}

class EasyPanelApiError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(`EasyPanel API error: ${message}`);
    this.name = "EasyPanelApiError";
  }
}

function extractApiError(json: any, httpStatus: number): { message: string; code?: string; status?: number } | undefined {
  if (json?.json) {
    const nested = extractApiError(json.json, httpStatus);
    if (nested) return nested;
  }

  if (json?.error) {
    return {
      message: json.error?.json?.message ?? json.error?.message ?? JSON.stringify(json.error),
      code: json.error?.json?.data?.code ?? json.error?.data?.code ?? json.error?.code,
      status: json.error?.json?.data?.httpStatus ?? json.error?.data?.httpStatus ?? httpStatus,
    };
  }

  const embeddedStatus = typeof json?.status === "number" ? json.status : undefined;
  const embeddedCode = typeof json?.code === "string" ? json.code : undefined;
  const embeddedMessage = typeof json?.message === "string" ? json.message : undefined;
  if ((embeddedStatus && embeddedStatus >= 400) || embeddedCode === "BAD_REQUEST" || json?.defined === false) {
    return {
      message: embeddedMessage ?? JSON.stringify(json),
      code: embeddedCode,
      status: embeddedStatus ?? httpStatus,
    };
  }

  if (httpStatus >= 400) {
    return {
      message: embeddedMessage ?? JSON.stringify(json),
      code: embeddedCode,
      status: httpStatus,
    };
  }

  return undefined;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof EasyPanelApiError && (error.status === 404 || error.code === "NOT_FOUND" || /not found/i.test(error.message));
}

function appendQueryValue(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return;
  if (value === null) {
    params.set(key, "");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(params, `${key}[]`, item);
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendQueryValue(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  params.set(key, String(value));
}
