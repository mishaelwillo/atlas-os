const ASSIGNMENT_SECRET =
  /\b(password|secret|token|api[_-]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PREFIXED_SECRET =
  /\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sb_secret_|sk-)[A-Za-z0-9_-]{6,}\b/gi;
const JWT_SECRET =
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g;
const POSTGRES_SECRET = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi;
const PEM_BLOCK_SECRET =
  /-----BEGIN[^\r\n]*?-----[\s\S]*?-----END[^\r\n]*?-----/gi;
const PEM_BEGIN_SECRET = /-----BEGIN\b/gi;

export function redactSecrets(value: string): string {
  return value
    .replace(POSTGRES_SECRET, '[redacted]')
    .replace(BEARER_SECRET, 'Bearer [redacted]')
    .replace(PREFIXED_SECRET, '[redacted]')
    .replace(JWT_SECRET, '[redacted]')
    .replace(PEM_BLOCK_SECRET, '[redacted]')
    .replace(PEM_BEGIN_SECRET, '[redacted]')
    .replace(
      ASSIGNMENT_SECRET,
      (_match, key: string, separator: string) => `${key}${separator}[redacted]`,
    );
}

export function containsSecret(value: string): boolean {
  return redactSecrets(value) !== value;
}
