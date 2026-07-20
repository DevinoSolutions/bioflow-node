/**
 * Secret redaction for debug logging — bf_ API keys and whsec_ webhook
 * secrets must never reach a log line, whatever string they ride in on.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bbf_(?:live|test)_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?\b/g,
  /\bwhsec_[A-Za-z0-9+/=]+/g,
];

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}
