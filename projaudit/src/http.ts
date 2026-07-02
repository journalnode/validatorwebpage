export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}

export function notFound(pathname: string): Response {
  return json(
    {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No /projaudit backend route is registered for ${pathname}`
      }
    },
    { status: 404 }
  );
}

export function methodNotAllowed(allowed: string[]): Response {
  return json(
    {
      ok: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        allowed
      }
    },
    {
      status: 405,
      headers: {
        allow: allowed.join(", ")
      }
    }
  );
}
