/**
 * Three invented editions — made-up people, repositories and numbers — one
 * per cadence. `/examples/[slug]` sets them with the real layouts, and the
 * pictures on the landing page and `/examples` are crops of their PNG export
 * (`public/examples/<slug>.webp`, see the README's "Sample editions").
 * Nothing in them is a real GitHub account.
 */

import type { IssueArticle } from "@/components/issue/types";
import type { EditionMastheadInfo } from "@/components/EditionMasthead";
import type { ArticleBlock, ChartSpec, RepoCard } from "@/lib/article-blocks";
import type { LayoutIndex } from "@/lib/layout";

export interface SampleEdition {
  slug: string;
  /** "Weekly" — what the cards' tab says. */
  cadence: string;
  /** One line on what this edition shows, for the cards. */
  teaser: string;
  edition: EditionMastheadInfo;
  layout: LayoutIndex;
  articles: IssueArticle[];
}

const article = (id: number, category: string, title: string, deck: string, paragraphs: string[], blocks: ArticleBlock[] = []): IssueArticle => ({
  id,
  category,
  title,
  deck,
  author: id === 0 ? "By Our Correspondent" : null,
  content: paragraphs.join("\n\n"),
  image: null,
  blocks,
});

const chart = (spec: ChartSpec): ArticleBlock => ({ type: "chart", chart: spec });
const facts = (...items: { label: string; value: string; note?: string }[]): ArticleBlock => ({ type: "facts", items });
const repos = (...items: RepoCard[]): ArticleBlock => ({ type: "repos", items });
const repo = (name: string, description: string, language: string, stars: number, forks: number, topics: string[], starredOn: string | null = null): RepoCard => ({
  name,
  url: `https://github.com/${name}`,
  description,
  language,
  stars,
  forks,
  topics,
  starredOn,
});

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}h`);

export const SAMPLE_EDITIONS: SampleEdition[] = [
  {
    slug: "weekly",
    cadence: "Weekly",
    teaser: "Seven days of a compiler hobbyist, with a side rail of briefs.",
    edition: { vol: "VOL. 2026 NO. W38", dateLabel: "Week of September 14, 2026", weather: "Fair, 14°C" },
    layout: 4,
    articles: [
      article(0, "Engineering", "Marisol Vega Teaches Her Parser to Forgive", "Error recovery arrives at tidepool after seven days and sixty-one commits.", [
        "For three years the parser at the heart of **tidepool** met every misplaced bracket with a single, stern word: *unexpected*. This week, by the evidence of sixty-one commits across seven days, Marisol Vega taught it to forgive.",
        "The change began on Monday as a modest patch to the tokenizer and, as these things do, swelled by Wednesday into a rewrite of the whole recovery path. Where the old parser halted at the first fault, the new one notes it, skips to the next statement boundary and carries on, so that a file with nine mistakes now yields nine messages rather than one.",
        "Reviewers, of whom there was exactly one, approved the pull request on Thursday with the comment “finally”. A follow-up on Friday trimmed the error messages down from paragraphs to sentences, to the relief of those who must read them.",
        "The work was not without cost: the benchmark suite recorded a four per cent slowdown on well-formed input, which the author declared acceptable and a later commit, on Saturday night, mostly recovered.",
        "Asked for comment, the maintainer said only that the old parser had been “honest, but unkind”. The new one, by her account, is merely honest, and a good deal more talkative.",
      ], [chart({ type: "bar", title: "Commits by day", labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], datasets: [{ label: "Commits", data: [6, 11, 17, 9, 8, 7, 3] }], unit: "commits", caption: "Wednesday was the rewrite." })]),
      article(1, "Releases", "Version 0.8 Leaves the Dock", "", [
        "**tidepool 0.8.0** was tagged on Thursday evening, bringing the new recovery parser, a language-server mode and the long-promised `--explain` flag to the public.",
        "The release notes run to forty lines, thirty-one of them fixes. Downloads for the first day, a modest 212, were described by the maintainer as “more than my mother and I account for”.",
      ], [facts({ label: "Commits", value: "61" }, { label: "Active days", value: "7 of 7" }, { label: "Release", value: "v0.8.0" })]),
      article(2, "Review", "A Lone Reviewer Clears the Queue", "", [
        "Four pull requests were reviewed this week, all by the same hand and all by Friday noon. Two were merged outright; one was sent back for tests; one was closed with a courteous essay on scope.",
        "The queue, which on Monday stood at nine, ended the week at five.",
      ]),
      article(3, "Tooling", "The Test Suite Gets a Haircut", "", [
        "A change to run the snapshot tests in parallel brought the suite from a leisurely ninety seconds to a brisk twenty-six. Continuous integration, which had been taking the afternoon off, was seen back at its desk.",
        "Left undone: the flaky test in `lexer_unicode`, which failed twice on Tuesday and was mentioned in the commit log in language unfit for print.",
      ]),
      article(4, "Dispatch", "The Working Day Runs Late", "", [
        "The week's commits were not evenly spread across the clock. A first wave rose at ten in the morning and broke before lunch; a second, larger one gathered after nine at night and did not subside until nearly one.",
        "The author, asked whether this was a considered schedule, replied that it was “mostly the coffee”.",
      ], [chart({ type: "polarArea", title: "The working day", labels: HOURS, datasets: [{ label: "Commits", data: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 5, 7, 4, 2, 3, 5, 4, 3, 2, 1, 4, 8, 9, 5] }], unit: "commits", caption: "Commits by hour of the day, all week." })]),
      article(5, "Open Source", "A Stranger Fixes the Lexer", "", [
        "On Tuesday, a contributor never before seen in the project sent a patch for the unicode bug that had stumped the maintainer for a month. It changed four lines and came with a test.",
        "It was merged within the hour, and the contributor thanked in the changelog by name, a courtesy that costs little and is remembered for years.",
      ]),
      article(6, "Pull Requests", "Seven Opened, Five Merged", "", [
        "Of the seven pull requests opened on the tidepool repository this week, five were merged, one was closed and one was left, politely, to think things over. The median time to merge was a little under a day.",
      ]),
      article(7, "Notes", "Docs Catch Up With Code", "", [
        "The guide finally describes the module system, eleven months after the module system arrived. The new page includes a worked example and, at the foot, an apology.",
      ]),
      article(8, "Stars", "Three Parsers Catch the Eye", "", [
        "The week's stars went to three projects in the author's own neighbourhood: a grammar toolkit, a tiny regular-expression engine and a book about writing interpreters.",
      ], [repos(
        repo("pale-harbour/gramma", "A grammar toolkit that explains its own errors.", "Rust", 3180, 142, ["parser", "grammar"], "September 15"),
        repo("ines-castro/tinyre", "A regular-expression engine in four hundred lines.", "C", 940, 51, ["regex", "education"], "September 17"),
        repo("walt-fenn/interpreters-by-hand", "A book on writing interpreters, one chapter a week.", "Markdown", 2210, 98, ["book", "interpreter"], "September 19"),
      )]),
      article(9, "Briefs", "Stars Gather", "", [
        "The repository gained 38 stars over the week, the larger share after a mention in a newsletter whose name the correspondent was unable to confirm.",
      ]),
    ],
  },
  {
    slug: "monthly",
    cadence: "Monthly",
    teaser: "An August of releases and stars, under a full-width banner.",
    edition: { vol: "VOL. 2026 NO. 8", dateLabel: "August 2026", weather: "Clear, 22°C" },
    layout: 3,
    articles: [
      article(0, "Open Source", "Nia Okafor's Monthly Almanac: Three Releases and a Quiet Fourth", "August saw lantern, quill-cli and a documentation site cross the finish line.", [
        "It is the habit of this newspaper to record the months of those who ship, and August was a generous one for Nia Okafor, who tagged three releases across as many repositories and left a fourth waiting, politely, in a draft.",
        "**lantern**, the small tracing library on which most of her month turned, reached 2.0 on the ninth with a new exporter interface and the removal of everything that had been deprecated since the spring. **quill-cli** followed on the nineteenth, and the documentation site, rebuilt from scratch on a static generator, went live on the twenty-sixth to no announcement whatever.",
        "In between, there were one hundred and forty-two commits, thirty-three pull requests opened and thirty-one closed, the remaining two being, as ever, a matter for next month.",
        "Stars were generous: lantern alone gained 214, and the month's weekly totals climbed steadily, as the chart below shows.",
        "The correspondent notes that the month's busiest week, the third, coincided with the lantern release, and that the quietest, the first, coincided with the author's holiday. The two facts are, we believe, related.",
      ], [chart({ type: "line", title: "Week by week", labels: ["Week 32", "Week 33", "Week 34", "Week 35"], datasets: [{ label: "Events", data: [38, 51, 74, 63] }], unit: "events", caption: "Pushes, pull requests and releases." })]),
      article(1, "Releases", "lantern 2.0 Clears the Decks", "", [
        "The release removes two years of deprecated functions, a decision the changelog calls “overdue” and the issue tracker, so far, calls nothing at all. A migration guide of eight pages accompanies it.",
        "Early reports from users are good: one reader writes that the upgrade took four minutes, a figure the author is framing.",
      ], [facts({ label: "Releases", value: "3" }, { label: "Commits", value: "142" }, { label: "Pull requests", value: "33", note: "31 closed" })]),
      article(2, "Tooling", "quill-cli Learns to Speak Shell", "", [
        "Completion scripts for bash, zsh and fish arrived in the nineteenth's release, each generated from a single description of the command line. Tab, it is reported, now does what one hopes of it.",
      ]),
      article(3, "Notes", "A Documentation Site Appears Unannounced", "", [
        "No post, no thread, no fanfare: the new site simply began answering at its address. Search works, the examples run, and the only complaint on record concerns the colour of the sidebar.",
      ]),
      article(4, "Dispatch", "Where the Month Went", "", [
        "Of the month's activity, a little over half belonged to lantern, a third to quill-cli and the rest to the documentation site and a scattering of smaller things. The author's own account was that August “mostly happened in one repository”.",
      ], [chart({ type: "bar", title: "Commits by repository", labels: ["lantern", "quill-cli", "lantern-docs", "dotfiles"], datasets: [{ label: "Commits", data: [78, 41, 17, 6] }], horizontal: true, unit: "commits", caption: "Four repositories, one hundred and forty-two commits." })]),
      article(5, "Review", "Thirty-One Closed, Two Remain", "", [
        "Of the thirty-three pull requests opened this month, thirty-one were closed by month's end. The two stragglers, both from the same contributor, are described in the tracker as “waiting on the author”, who is Okafor herself.",
        "Median time to first review was under three hours, a figure the maintainer attributes to a well-timed notification and a strong cup of tea.",
      ]),
      article(6, "Open Source", "Eleven Contributors, Four of Them New", "", [
        "Eleven people sent patches to lantern this month, four of them for the first time. One rewrote the benchmark harness, one fixed a Windows path bug that had survived two releases, and two corrected typos with equal enthusiasm.",
      ]),
      article(7, "Notes", "A Changelog Worth Reading", "", [
        "The 2.0 changelog is organised by what the reader will have to do, not by what the author did. Under “You will need to change”, there are three items; under “You may like”, nine. It has been praised in at least one newsletter.",
      ]),
      article(8, "Dispatch", "A Fourth Release Waits in the Wings", "", [
        "A draft release for **lantern-otel**, the bridge to a widely used observability format, sat unpublished at month's end. The notes are written, the tests green; what remains, the author says, is “the courage”.",
      ]),
      article(9, "Stars", "Two Repositories Win the Month's Favour", "", [
        "Two repositories drew the month's stars, the larger by a wide margin.",
      ], [repos(
        repo("lumen-labs/lantern", "Small, fast tracing for small, fast programs.", "Rust", 4120, 163, ["tracing", "observability"]),
        repo("nia-okafor/quill-cli", "A command-line pen for writing release notes.", "Go", 870, 41, ["cli", "changelog"]),
      )]),
    ],
  },
  {
    slug: "quarterly",
    cadence: "Quarterly",
    teaser: "Three months of building an API to 1.0, in four columns.",
    edition: { vol: "VOL. 2026 NO. Q2", dateLabel: "Q2 2026", weather: "Showers, 11°C" },
    layout: 2,
    articles: [
      article(0, "Engineering", "Tobias Wren Carries kettle-api to 1.0 in a Single Quarter", "Six hundred commits, three months and one very patient test suite.", [
        "When April began, **kettle-api** was a promising prototype with a long list of caveats in its README. By the end of June it was version 1.0, with the caveats struck through and, in several cases, the reasons for them removed from the code.",
        "The quarter's work fell into three parts. April went to the data layer, where Tobias Wren replaced a hand-rolled query builder with something that did not leak. May was given over to authentication, and to the discovery that a timezone bug had been misfiling midnight bookings for a year. June was for the things nobody enjoys: documentation, a deprecation policy and a release checklist.",
        "The numbers are tidy enough. Six hundred and twelve commits, forty-four pull requests merged, nine contributors besides the author, and a retry loop that retried forever, taught at last to stop after five attempts.",
      ], [chart({ type: "doughnut", title: "The mix of work", labels: ["feat", "fix", "docs", "chore", "test"], datasets: [{ label: "Commits", data: [198, 174, 96, 82, 62] }], unit: "commits", caption: "Six hundred and twelve commits, by kind." })]),
      article(1, "Releases", "Version 1.0 Is Tagged on the Last Day of June", "", [
        "The tag went up at ten past six on the thirtieth, followed within the hour by a changelog of unusual candour. It lists, under “Known problems”, three things that are known problems.",
        "The first day brought 380 downloads, a figure the author called “respectable for a Tuesday”.",
      ], [facts({ label: "Commits", value: "612" }, { label: "Pull requests merged", value: "44" }, { label: "Contributors", value: "10", note: "nine besides the author" })]),
      article(2, "Open Source", "Nine Strangers Send Patches", "", [
        "Most were small: a typo, a missing example, a flag renamed for clarity. One, from a contributor in Lisbon, rewrote the pagination and was merged after a single round of review. All were thanked, which costs little and is remembered for years.",
      ]),
      article(3, "Tooling", "The Test Suite Learns to Run in Parallel", "", [
        "A May change brought the suite from ninety seconds to twenty-six. Continuous integration, which had been taking the afternoon off, was seen back at its desk. Left undone: the flaky test in the booking module, which failed twice in June and was mentioned in the commit log in language unfit for print.",
      ]),
      article(4, "Dispatch", "April, May, June: A Quarter in Three Bars", "", [
        "The quarter did not run evenly. April, spent on the data layer, was the heaviest month by some way; May, with its authentication work and its long review threads, the quietest in commits and the loudest in comments; June, with the release at its end, a steady climb.",
      ], [chart({ type: "bar", title: "Commits by month", labels: ["April", "May", "June"], datasets: [{ label: "Commits", data: [264, 148, 200] }], unit: "commits", caption: "Q2 2026." })]),
      article(5, "Notes", "The README Tells the Truth", "", [
        "The installation section now lists the commands that work. The author reports no regrets.",
      ]),
      article(6, "Briefs", "A Deprecation Policy Is Published", "", [
        "Anything deprecated will stay for two minor versions and be named in the changelog. The policy is four paragraphs long and has already been quoted back to the author twice.",
      ]),
      article(7, "Review", "Forty-Four Merged, Eleven Sent Back", "", [
        "Of the pull requests that came to kettle-api this quarter, forty-four were merged and eleven were sent back for changes at least once. The most common reason, by a margin the reviewer found embarrassing, was a missing test.",
      ]),
      article(8, "Dispatch", "A Timezone Bug Is Laid to Rest", "", [
        "Discovered in May by a customer's complaint and a single unlucky booking at 00:30, the bug had been quietly misfiling midnight appointments for twelve months. The fix is nine lines; the post-mortem is two pages and the better read.",
      ]),
      article(9, "Stars", "The Quarter's Favourites", "", [
        "Three repositories caught the author's eye this quarter, all of them in the author's own line of work: a query builder, a testing library and a small server that does almost nothing, very quickly.",
      ], [repos(
        repo("ada-quill/rowset", "A query builder that doesn't leak.", "TypeScript", 5230, 301, ["sql", "query-builder"], "April 9"),
        repo("pia-lindqvist/snaptest", "Snapshot tests that fail with a useful message.", "Go", 1460, 77, ["testing", "snapshots"], "May 21"),
        repo("hollis-gray/nothing-server", "A web server that does almost nothing, very quickly.", "C", 3770, 129, ["http", "minimal"], "June 12"),
      )]),
      article(10, "Dispatch", "Downloads Climb After the Release", "", [
        "Weekly downloads, a few dozen at the start of April, passed three hundred in the week of the release and settled, by the quarter's end, at a figure the author calls “enough to be paged about”.",
      ], [chart({ type: "line", title: "Downloads by week", labels: ["Wk 14", "Wk 16", "Wk 18", "Wk 20", "Wk 22", "Wk 24", "Wk 26"], datasets: [{ label: "Downloads", data: [42, 55, 71, 96, 140, 212, 380] }], unit: "downloads", caption: "Every second week of the quarter." })]),
    ],
  },
];

export const sampleBySlug = (slug: string) => SAMPLE_EDITIONS.find((sample) => sample.slug === slug);
