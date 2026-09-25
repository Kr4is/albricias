/**
 * Runnable self-check for what the scorers check (`@/lib/generation/checks`)
 * and for the scorers themselves. `npx tsx scripts/check-scorers.ts`.
 */
import assert from "node:assert/strict";
import { figuresIn, lengthFit, styleBreaches, ungroundedFigures, unknownRepos, wordCount } from "../src/lib/generation/checks";
import { figuresGrounded, houseStyle, lengthFitScorer, outlineClean } from "../src/mastra/scorers";

const material = {
  overview: { totals: { events: 79, commits: 67 }, rhythm: { busiestDay: { date: "2026-09-21", events: 18 }, busiestWeekday: { events: 22 }, weekendShare: 0.16, busiestHour: { hour: 14 } } },
  repos: [{ name: "Kr4is/octApp", about: { description: "resolved 24 alerts", stars: 108000 } }],
  elsewhere: [{ name: "nemoNoboru/vitruous", summary: "4 commits" }],
};

// Figures, in digits and in words, ordinals and thousands included; 0–2 and code are left alone.
assert.deepEqual(figuresIn("Twenty-two events, the 21st, 1,200 stars, 3.5k forks, one PR, `v2`").map((f) => f.value).sort((a, b) => a - b), [21, 22, 1200, 3500]);
assert.deepEqual(figuresIn("the eighteenth commit and sixty-seven more").map((f) => f.value).sort((a, b) => a - b), [18, 67]);

// Grounded: 79, 67, 18, 22, 16% (0.16), 2 p.m. (14), the 21st, 24, 108k (rounded); ungrounded: 31.
{
  const text = "Seventy-nine events and 67 commits; eighteen on September 21st, 22 on Mondays, 16% at weekends, peaking at 2 p.m. Kr4is/octApp cleared 24 alerts and has 108k stars, not 31.";
  const { checked, unmatched } = ungroundedFigures(text, material);
  assert.deepEqual(unmatched, ["31"]);
  assert.ok(checked >= 9);
}

// Repositories: named ones pass, an invented one doesn't; dates and "and/or" don't count.
assert.deepEqual(unknownRepos("Kr4is/octApp and nemoNoboru/vitruous, not someone/else, on 9/21 and/or later", material), { checked: 3, unmatched: ["someone/else"] });

// Length against the bands.
assert.equal(lengthFit(100, "short"), 1);
assert.equal(lengthFit(30, "short"), 0);
assert.equal(lengthFit(1200, "long"), 0);
assert.ok(lengthFit(240, "short") < 1);
assert.equal(wordCount("One — two, three."), 3);

// House style: the trace-5 slips.
assert.deepEqual(styleBreaches("Two days later, vitruous saw a landing page."), ["works out an interval"]);
assert.deepEqual(styleBreaches("The user also explored Laya."), ['calls the author "the user"']);
assert.deepEqual(styleBreaches("In September, the reading list leaned heavily toward agents."), ["names the kind of section"]);
assert.deepEqual(styleBreaches("**From Flask to a Newspaper Engine**\n\nThe transformation began."), ["echoes a heading"]);
assert.deepEqual(styleBreaches("The feature commits outnumbered the fixes on September 19."), []);

// The scorers, run as Mastra runs them.
(async () => {
  const output = { ok: true, text: "It logged 79 events and 31 commits. The user was busy.", material: JSON.stringify(material) };
  const figures = await figuresGrounded.run({ input: { heading: "h", lengthTier: "short" }, output });
  assert.equal(figures.score, 0.5);
  assert.match(String(figures.reason), /31/);
  const style = await houseStyle.run({ input: { heading: "h", lengthTier: "short" }, output });
  assert.equal(style.score, 0.75);
  const length = await lengthFitScorer.run({ input: { heading: "h", lengthTier: "short" }, output });
  assert.ok((length.score ?? 1) < 1);
  const clean = await outlineClean.run({ output: { notes: ["a", "b", "c"], sections: [] } });
  assert.equal(clean.score, 0.25);
  console.log("scorers self-check: OK");
})();
