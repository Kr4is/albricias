/**
 * Runnable self-check for reading a provider's refusal of one of our
 * settings (`refusedSetting`). `npx tsx scripts/check-errors.ts`.
 */
import assert from "node:assert/strict";
import { refusedSetting } from "../src/lib/ai/error";

// The Azure-behind-LiteLLM refusal of a reasoning model's temperature, verbatim.
assert.equal(
  refusedSetting(
    "litellm.BadRequestError: AzureException BadRequestError - Unsupported value: 'temperature' does not support 0.8 with this model. Only the default (1) value is supported.. Received Model Group=gpt-6-luna Available Model Group Fallbacks=None (HTTP 400)",
  ),
  "temperature",
);
assert.equal(refusedSetting("Unrecognized request argument supplied: chat_template_kwargs (HTTP 400)"), "providerOptions");
assert.equal(refusedSetting("Extra inputs are not permitted: enable_thinking"), "providerOptions");
// Anything else is a real failure.
assert.equal(refusedSetting("Incorrect API key provided (HTTP 401)"), null);
assert.equal(refusedSetting("The temperature in Madrid is 30 degrees"), null);
console.log("errors self-check: OK");
