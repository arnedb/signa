import createClient, { type Middleware } from "openapi-fetch";

import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];
export type Me = Schemas["Me"];
export type Word = Schemas["WordOut"];
export type DifficultWord = Schemas["DifficultWordOut"];
export type AdminWord = Schemas["AdminWordOut"];
export type Clip = Schemas["ClipOut"];
export type Catalog = Schemas["Catalog"];
export type Direction = Schemas["ResultIn"]["direction"];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  /** API origin, e.g. "https://vgt.arnedb.be". Empty for same-origin (web). */
  baseUrl?: string;
  /** Mobile: returns the session token, sent as a Bearer header. Web uses the cookie. */
  getToken?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
}

export function createApi({ baseUrl = "", getToken, fetch: f }: ClientOptions = {}) {
  const client = createClient<paths>({ baseUrl, credentials: "include", fetch: f });
  const auth: Middleware = {
    async onRequest({ request }) {
      // Required for cookie sessions on state-changing requests (CSRF protection).
      request.headers.set("X-VGT-Client", getToken ? "mobile" : "web");
      const token = getToken ? await getToken() : null;
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  };
  client.use(auth);
  return client;
}

export type Api = ReturnType<typeof createApi>;

/** Unwrap an openapi-fetch result: return data or throw an ApiError with the server message. */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise;
  if (error !== undefined || !response.ok) {
    const detail = (error as { detail?: unknown } | undefined)?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? "Invalid input"
          : response.statusText;
    throw new ApiError(response.status, message);
  }
  return data as T;
}
