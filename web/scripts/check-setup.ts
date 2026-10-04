/**
 * Runnable self-check for the setup wizard's step rules and the layout
 * picker's minimums. `npx tsx scripts/check-setup.ts`.
 */
import assert from "node:assert/strict";
import { DEFAULT_FORM, firstIncompleteStep, stepProblem } from "../src/components/SetupWizard";
import { layoutsFor } from "../src/lib/layout";

// A blank form is stuck on the first step; a monthly public edition is the default.
assert.equal(DEFAULT_FORM.period, "monthly");
assert.equal(DEFAULT_FORM.includePrivate, false);
assert.equal(firstIncompleteStep(DEFAULT_FORM), 0);

// Public sources need no token; private ones do.
const named = { ...DEFAULT_FORM, githubUsername: "octocat" };
assert.equal(stepProblem("sources", named), null);
assert.notEqual(stepProblem("sources", { ...named, includePrivate: true }), null);
assert.equal(stepProblem("sources", { ...named, includePrivate: true, githubToken: "ghp_x" }), null);

// A gateway needs a model and a base URL on top of the key.
const keyed = { ...named, llmApiKey: "sk-x" };
assert.equal(stepProblem("newsroom", keyed), null);
assert.notEqual(stepProblem("newsroom", { ...keyed, llmProvider: "litellm" }), null);
assert.equal(stepProblem("newsroom", { ...keyed, llmProvider: "litellm", llmModel: "m", llmBaseUrl: "https://g/v1" }), null);

// Everything saved: a returning visitor opens on the last step.
assert.equal(firstIncompleteStep(keyed), 3);
assert.equal(firstIncompleteStep({ ...keyed, includePrivate: true }), 1);

// Layouts: one article can't fill V4's rail or V5's two leads; every flow layout can.
assert.deepEqual(layoutsFor(1), [1, 2, 3, 6]);
assert.deepEqual(layoutsFor(2), [1, 2, 3, 5, 6]);
assert.deepEqual(layoutsFor(3), [1, 2, 3, 4, 5, 6]);

console.log("setup self-check: OK");
