export type CodedError = Error & { code?: string };

export function toError(value: unknown): CodedError {
  return value instanceof Error ? value : new Error(String(value));
}
