// packages/cli/src/lib/api-client.ts
//
// Tiny HTTP client over `fetch`. We avoid pulling in axios/got etc. — the
// product is "render a diagram", not "compose 12 different SDKs".
//
// Every outbound request opts out of redirect following (`redirect: "error"`).
// The CLI sends a Bearer token in `Authorization`, and Node's default
// `redirect: "follow"` would forward that header to whatever host the redirect
// points at. That's an API key exfil channel if the configured base URL is
// ever pointed at (or hijacked into) an attacker-controlled origin. The API
// itself does not legitimately need redirects — pin to the origin we resolved.

export type ApiError = {
  status: number;
  code: string;
  message: string;
  signUpUrl?: string;
  upgradeUrl?: string;
};

function pickString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function extractApiError(parsed: unknown, status: number): ApiError {
  const obj = (parsed ?? {}) as {
    error?: string;
    message?: string;
    hints?: { signUpUrl?: unknown; upgradeUrl?: unknown };
  };
  const signUpUrl = pickString(obj.hints?.signUpUrl);
  const upgradeUrl = pickString(obj.hints?.upgradeUrl);
  return {
    status,
    code: obj.error ?? "http_error",
    message: obj.message ?? `HTTP ${status}`,
    ...(signUpUrl ? { signUpUrl } : {}),
    ...(upgradeUrl ? { upgradeUrl } : {}),
  };
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}

  private buildUrl(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      accept: "application/json",
    };
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    if (extra) Object.assign(h, extra);
    return h;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: "GET",
      headers: this.headers(),
      redirect: "error",
    });
    return parseJsonResponse<T>(res);
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
      redirect: "error",
    });
    return parseJsonResponse<T>(res);
  }

  /**
   * POST and read the response as a UTF-8 text download (body + headers).
   * Used by `/v1/export?format=svg` which returns
   * `Content-Type: image/svg+xml`. On non-2xx the server still answers JSON;
   * we surface that as an `ApiError`.
   */
  async postRaw(
    path: string,
    body: unknown,
  ): Promise<{ body: string; headers: Record<string, string>; status: number }> {
    const res = await this.postExpectingDownload(path, body, "image/svg+xml,*/*");
    const text = await res.text();
    return { body: text, headers: extractHeaders(res), status: res.status };
  }

  /**
   * POST and read the response as binary bytes. Used by
   * `/v1/export?format=png` which returns `Content-Type: image/png`.
   */
  async postBinary(
    path: string,
    body: unknown,
    accept = "image/png,*/*",
  ): Promise<{ body: Uint8Array; headers: Record<string, string>; status: number }> {
    const res = await this.postExpectingDownload(path, body, accept);
    const buf = new Uint8Array(await res.arrayBuffer());
    return { body: buf, headers: extractHeaders(res), status: res.status };
  }

  private async postExpectingDownload(
    path: string,
    body: unknown,
    accept: string,
  ): Promise<Response> {
    const res = await fetch(this.buildUrl(path), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", accept }),
      body: JSON.stringify(body),
      redirect: "error",
    });
    if (res.ok) return res;
    // Server emits JSON error even when caller asked for binary.
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // empty / non-json
    }
    const err = extractApiError(parsed, res.status);
    throw Object.assign(new Error(`${err.code}: ${err.message}`), { apiError: err });
  }
}

function extractHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return headers;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // empty body or non-json
  }
  if (!res.ok) {
    const err = extractApiError(parsed, res.status);
    throw Object.assign(new Error(`${err.code}: ${err.message}`), { apiError: err });
  }
  return parsed as T;
}

export function isApiError(err: unknown): err is Error & { apiError: ApiError } {
  return (
    err instanceof Error &&
    typeof (err as Error & { apiError?: unknown }).apiError === "object"
  );
}
