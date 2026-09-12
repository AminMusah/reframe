import { APICallError, NoObjectGeneratedError } from "ai"

export type ErrorCode = "bad_key" | "rate_limit" | "invalid_output" | "network"

export class LlmError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
  }
}

/** Map AI SDK failures onto the four codes the UI knows how to explain. */
export function classifyError(err: unknown): LlmError {
  if (err instanceof LlmError) return err
  if (NoObjectGeneratedError.isInstance(err)) {
    return new LlmError("invalid_output", err.message)
  }
  if (APICallError.isInstance(err)) {
    if (err.statusCode === 401 || err.statusCode === 403) {
      return new LlmError("bad_key", "The API key was rejected")
    }
    if (err.statusCode === 429) {
      return new LlmError("rate_limit", "Rate limited by the provider")
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return new LlmError("invalid_output", err.message)
    }
  }
  return new LlmError(
    "network",
    err instanceof Error ? err.message : String(err)
  )
}
