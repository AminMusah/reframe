import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

import {
  DEFAULT_MODEL,
  providerForKey,
  providerOf,
  type ModelId,
} from "./models"

/**
 * A language model for the given key. When the requested model belongs to a
 * different provider than the key (e.g. the user swapped keys mid-project),
 * fall back to the key's default model rather than failing with a 401.
 */
export function languageModel(apiKey: string, model?: ModelId) {
  const provider = providerForKey(apiKey)
  const id =
    model && providerOf(model) === provider ? model : DEFAULT_MODEL[provider]
  return provider === "anthropic"
    ? createAnthropic({ apiKey })(id)
    : createOpenAI({ apiKey })(id)
}
