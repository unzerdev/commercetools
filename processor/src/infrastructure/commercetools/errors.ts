/** A commercetools 404, in every shape the SDK raises it. */
export function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const e = error as { statusCode?: number; status?: number; code?: number; body?: { statusCode?: number } };
  return e.statusCode === 404 || e.status === 404 || e.code === 404 || e.body?.statusCode === 404;
}

/** A commercetools 409: a version-CAS conflict, or a create-only post against an existing object. */
export function isConcurrentModification(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const e = error as {
    statusCode?: number;
    status?: number;
    code?: number;
    body?: { statusCode?: number; errors?: { code?: string }[] };
  };
  return (
    e.statusCode === 409 ||
    e.status === 409 ||
    e.code === 409 ||
    e.body?.statusCode === 409 ||
    (e.body?.errors?.some((err) => err.code === 'ConcurrentModification') ?? false)
  );
}
