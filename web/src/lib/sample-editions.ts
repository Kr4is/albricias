/**
 * Three invented editions — made-up people, repositories and numbers — set
 * on `/dev/layouts?sample=N` and exported to `public/examples/` (see the
 * README's "Sample editions") as the pictures the landing page and
 * `/examples` show. Nothing in them is a real GitHub account.
 */

import type { IssueArticle } from "@/components/issue/types";
import type { EditionMastheadInfo } from "@/components/EditionMasthead";
import type { LayoutIndex } from "@/lib/layout";

export interface SampleEdition {
  /** What the gallery calls it. */
  label: string;
  edition: EditionMastheadInfo;
  layout: LayoutIndex;
  articles: IssueArticle[];
}

const article = (id: number, category: string, title: string, deck: string, paragraphs: string[], blocks: IssueArticle["blocks"] = []): IssueArticle => ({
  id,
  category,
  title,
  deck,
  author: id === 0 ? "By Our Correspondent" : null,
  content: paragraphs.join("\n\n"),
  image: null,
  blocks,
});

export const SAMPLE_EDITIONS: SampleEdition[] = [
  {
    label: "A week in the life of a compiler hobbyist",
    edition: { vol: "VOL. 2026 NO. W38", dateLabel: "Week of September 14, 2026", weather: "Fair, 14°C" },
    layout: 4,
    articles: [
      article(0, "Engineering", "Marisol Vega Teaches Her Parser to Forgive", "Error recovery arrives at *tidepool* after seven days and sixty-one commits.", [
        "For three years the parser at the heart of **tidepool** met every misplaced bracket with a single, stern word: *unexpected*. This week, by the evidence of sixty-one commits across seven days, Marisol Vega taught it to forgive.",
        "The change began on Monday as a modest patch to the tokenizer and, as these things do, swelled by Wednesday into a rewrite of the whole recovery path. Where the old parser halted at the first fault, the new one notes it, skips to the next statement boundary and carries on, so that a file with nine mistakes now yields nine messages rather than one.",
        "Reviewers, of whom there was exactly one, approved the pull request on Thursday with the comment “finally”. A follow-up on Friday trimmed the error messages down from paragraphs to sentences, to the relief of those who must read them.",
        "The work was not without cost: the benchmark suite recorded a four per cent slowdown on well-formed input, which the author declared acceptable and a later commit, on Saturday night, mostly recovered.",
      ], [{ type: "chart", chart: { type: "bar", title: "Commits by day", labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], datasets: [{ label: "Commits", data: [6, 11, 17, 9, 8, 7, 3] }], unit: "commits", caption: "Wednesday was the rewrite." } }]),
      article(1, "Releases", "Version 0.8 Leaves the Dock", "", [
        "**tidepool 0.8.0** was tagged on Thursday evening, bringing the new recovery parser, a language-server mode and the long-promised `--explain` flag to the public.",
        "The release notes run to forty lines, thirty-one of them fixes. Downloads for the first day, a modest 212, were described by the maintainer as “more than my mother and I account for”.",
      ], [{ type: "facts", items: [{ label: "Commits", value: "61" }, { label: "Active days", value: "7 of 7" }, { label: "Release", value: "v0.8.0" }] }]),
      article(2, "Review", "A Lone Reviewer Clears the Queue", "", [
        "Four pull requests were reviewed this week, all by the same hand and all by Friday noon. Two were merged outright; one was sent back for tests; one was closed with a courteous essay on scope.",
        "The queue, which on Monday stood at nine, ended the week at five.",
      ]),
      article(3, "Tooling", "The Test Suite Gets a Haircut", "", [
        "A change to run the snapshot tests in parallel brought the suite from a leisurely ninety seconds to a brisk twenty-six. Continuous integration, which had been taking the afternoon off, was seen back at its desk.",
        "Left undone: the flaky test in `lexer_unicode`, which failed twice on Tuesday and was mentioned in the commit log in language unfit for print.",
      ]),
      article(4, "Notes", "Docs Catch Up With Code", "", [
        "The guide finally describes the module system, eleven months after the module system arrived. The new page includes a worked example and, at the foot, an apology.",
      ]),
      article(5, "Briefs", "Stars Gather", "", [
        "The repository gained 38 stars over the week, the larger share after a mention in a newsletter whose name the correspondent was unable to confirm.",
      ]),
    ],
  },
  {
    label: "A month of releases and stars",
    edition: { vol: "VOL. 2026 NO. 8", dateLabel: "August 2026", weather: "Clear, 22°C" },
    layout: 3,
    articles: [
      article(0, "Open Source", "Nia Okafor's Monthly Almanac: Three Releases and a Quiet Fourth", "August saw *lantern*, *quill-cli* and a documentation site cross the finish line.", [
        "It is the habit of this newspaper to record the months of those who ship, and August was a generous one for Nia Okafor, who tagged three releases across as many repositories and left a fourth waiting, politely, in a draft.",
        "**lantern**, the small tracing library on which most of her month turned, reached 2.0 on the ninth with a new exporter interface and the removal of everything that had been deprecated since the spring. **quill-cli** followed on the nineteenth, and the documentation site, rebuilt from scratch on a static generator, went live on the twenty-sixth to no announcement whatever.",
        "In between, there were one hundred and forty-two commits, thirty-three pull requests opened and thirty-one closed, the remaining two being, as ever, a matter for next month.",
        "Stars were generous: lantern alone gained 214, and the month's weekly totals climbed steadily, as the chart below shows.",
      ], [{ type: "chart", chart: { type: "line", title: "Week by week", labels: ["Week 32", "Week 33", "Week 34", "Week 35"], datasets: [{ label: "Events", data: [38, 51, 74, 63] }], unit: "events", caption: "Pushes, pull requests and releases." } }]),
      article(1, "Releases", "lantern 2.0 Clears the Decks", "", [
        "The release removes two years of deprecated functions, a decision the changelog calls “overdue” and the issue tracker, so far, calls nothing at all. A migration guide of eight pages accompanies it.",
        "Early reports from users are good: one reader writes that the upgrade took four minutes, a figure the author is framing.",
      ], [{ type: "facts", items: [{ label: "Releases", value: "3" }, { label: "Commits", value: "142" }, { label: "Pull requests", value: "33", note: "31 closed" }] }]),
      article(2, "Tooling", "quill-cli Learns to Speak Shell", "", [
        "Completion scripts for bash, zsh and fish arrived in the nineteenth’s release, each generated from a single description of the command line. Tab, it is reported, now does what one hopes of it.",
      ]),
      article(3, "Notes", "A Documentation Site Appears Unannounced", "", [
        "No post, no thread, no fanfare: the new site simply began answering at its address. Search works, the examples run, and the only complaint on record concerns the colour of the sidebar.",
      ]),
      article(4, "Stars", "Two Repositories Win the Month's Favour", "", [
        "Two repositories drew the month's stars, the larger by a wide margin.",
      ], [{
        type: "repos",
        items: [
          { name: "lumen-labs/lantern", url: "https://github.com/lumen-labs/lantern", description: "Small, fast tracing for small, fast programs.", language: "Rust", stars: 4120, forks: 163, topics: ["tracing", "observability"], starredOn: null },
          { name: "nia-okafor/quill-cli", url: "https://github.com/nia-okafor/quill-cli", description: "A command-line pen for writing release notes.", language: "Go", stars: 870, forks: 41, topics: ["cli", "changelog"], starredOn: null },
        ],
      }]),
    ],
  },
  {
    label: "A quarter of building an API",
    edition: { vol: "VOL. 2026 NO. Q2", dateLabel: "Q2 2026", weather: "Showers, 11°C" },
    layout: 2,
    articles: [
      article(0, "Engineering", "Tobias Wren Carries kettle-api to 1.0 in a Single Quarter", "Six hundred commits, three months and one very patient test suite.", [
        "When April began, **kettle-api** was a promising prototype with a long list of caveats in its README. By the end of June it was version 1.0, with the caveats struck through and, in several cases, the reasons for them removed from the code.",
        "The quarter's work fell into three parts. April went to the data layer, where Tobias Wren replaced a hand-rolled query builder with something that did not leak. May was given over to authentication, and to the discovery that a timezone bug had been misfiling midnight bookings for a year. June was for the things nobody enjoys: documentation, a deprecation policy and a release checklist.",
        "The numbers are tidy enough. Six hundred and twelve commits, forty-four pull requests merged, nine contributors besides the author, and a retry loop that retried forever, taught at last to stop after five attempts.",
      ], [{ type: "chart", chart: { type: "doughnut", title: "The mix of work", labels: ["feat", "fix", "docs", "chore", "test"], datasets: [{ label: "Commits", data: [198, 174, 96, 82, 62] }], unit: "commits", caption: "Six hundred and twelve commits, by kind." } }]),
      article(1, "Releases", "Version 1.0 Is Tagged on the Last Day of June", "", [
        "The tag went up at ten past six on the thirtieth, followed within the hour by a changelog of unusual candour. It lists, under “Known problems”, three things that are known problems.",
        "The first day brought 380 downloads, a figure the author called “respectable for a Tuesday”.",
      ], [{ type: "facts", items: [{ label: "Commits", value: "612" }, { label: "Pull requests merged", value: "44" }, { label: "Contributors", value: "10", note: "nine besides the author" }] }]),
      article(2, "Open Source", "Nine Strangers Send Patches", "", [
        "Most were small: a typo, a missing example, a flag renamed for clarity. One, from a contributor in Lisbon, rewrote the pagination and was merged after a single round of review. All were thanked, which costs little and is remembered for years.",
      ]),
      article(3, "Tooling", "The Test Suite Learns to Run in Parallel", "", [
        "A May change brought the suite from ninety seconds to twenty-six. Continuous integration, which had been taking the afternoon off, was seen back at its desk. Left undone: the flaky test in the booking module, which failed twice in June and was mentioned in the commit log in language unfit for print.",
      ]),
      article(4, "Notes", "The README Tells the Truth", "", [
        "The installation section now lists the commands that work. The author reports no regrets.",
      ]),
      article(5, "Briefs", "A Deprecation Policy Is Published", "", [
        "Anything deprecated will stay for two minor versions and be named in the changelog. The policy is four paragraphs long and has already been quoted back to the author twice.",
      ]),
    ],
  },
];
