/** Keep nested connection failures visible without logging database credentials. */
export function formatDatabaseError(error: unknown, connectionString = process.env.DATABASE_URL): string {
  const secrets = connectionString ? [connectionString] : [];
  if (connectionString) {
    try {
      const password = new URL(connectionString).password;
      if (password) secrets.push(password, decodeURIComponent(password));
    } catch { /* Invalid URLs must still produce a useful diagnostic. */ }
  }
  const seen = new Set<unknown>();
  const lines: string[] = [];
  const visit = (value: unknown) => {
    if (seen.has(value)) return;
    seen.add(value);
    if (!(value instanceof Error)) { lines.push(String(value)); return; }
    const code = 'code' in value ? String(value.code) : '';
    lines.push([value.name, code, value.message].filter(Boolean).join(': '));
    if (value instanceof AggregateError) for (const nested of value.errors) visit(nested);
    const cause = (value as Error & { cause?: unknown }).cause;
    if (cause !== undefined) visit(cause);
  };
  visit(error);
  let result = lines.join('\n');
  for (const secret of secrets) result = result.replaceAll(secret, '[REDACTED]');
  return result.replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, '[DATABASE_URL]');
}
