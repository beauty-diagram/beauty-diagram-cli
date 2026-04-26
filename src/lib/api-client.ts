// packages/cli/src/lib/api-client.ts
//
// Tiny HTTP client over `fetch`. We avoid pulling in axios/got etc. — the
// product is "render a diagram", not "compose 12 different SDKs".

export type ApiError = {
  status: number;
  code: string;
  message: string;
};

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
    });
    return parseJsonResponse<T>(res);
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    return parseJsonResponse<T>(res);
  }

  /**
   * POST and read the response as a UTF-8 text download (body + headers).
   * Used by `/api/v1/export?format=svg` which returns
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
   * `/api/v1/export?format=png` which returns `Content-Type: image/png`.
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
    });
    if (res.ok) return res;
    // Server emits JSON error even when caller asked for binary.
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // empty / non-json
    }
    const obj = (parsed ?? {}) as { error?: string; message?: string };
    const err: ApiError = {
      status: res.status,
      code: obj.error ?? "http_error",
      message: obj.message ?? `HTTP ${res.status}`,
    };
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
    const obj = (parsed ?? {}) as { error?: string; message?: string };
    const err: ApiError = {
      status: res.status,
      code: obj.error ?? "http_error",
      message: obj.message ?? `HTTP ${res.status}`,
    };
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
