import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"

import {
  DEFAULT_MODEL,
  modelInfo,
  providerForKey,
  providerOf,
  type ModelId,
} from "./models"

/** The model to actually use for a key: the requested one if it belongs to the key's provider, else that provider's default. */
export function resolveModel(apiKey: string, model?: ModelId): ModelId {
  const provider = providerForKey(apiKey)
  return model && providerOf(model) === provider
    ? model
    : DEFAULT_MODEL[provider]
}

/** A language model for the given key (see resolveModel for the fallback). */
export function languageModel(apiKey: string, model?: ModelId) {
  const id = resolveModel(apiKey, model)
  switch (providerOf(id)) {
    case "anthropic":
      return createAnthropic({ apiKey })(id)
    case "openai":
      return createOpenAI({ apiKey })(id)
    case "google":
      return createGoogleGenerativeAI({ apiKey })(id)
    case "groq":
      return createGroq({ apiKey })(id)
    case "openrouter":
      return createOpenRouter({ apiKey })(id)
  }
}

/** Whether the model that will serve this key can take the PNG. */
export function supportsVision(apiKey: string, model?: ModelId): boolean {
  return modelInfo(resolveModel(apiKey, model)).vision
}
