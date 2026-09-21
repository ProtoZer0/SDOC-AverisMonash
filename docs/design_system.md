# Design system and frontend plan

v1, 19 Sep 2026 · seunniee · **This file is load-bearing for the frontend.**
Anything in §2 to §5 is a decision, not a suggestion. Changing one means a note
in the changelog and a message in the team channel, same rule as
[`contracts.md`](contracts.md).

Every contrast figure here was measured with the WCAG 2.1 formula against our
own paper background, not taken from a brand book.

> **Partly stale as of 19 Sep, evening.** §1 to §5 (principles, colour, type,
> status) are current and were followed when building `web/src/index.css`.
> **§6 to §9 are out of date**: they still describe a sidebar, a density
> switcher, four screens and the tick pattern, all of which the build replaced.
> Trust `web/src/index.css` and `web/mockups/screens.html` over those sections
> until this file is brought in line. See `HANDOFF.md`, next steps.

---

## 1. Principles

Four rules. Everything else in this document follows from them.

1. **Colour is never the only signal.** Every state also carries a shape and a
   word. Tested: our three status colours collapse to nearly the same grey when
   desaturated, so colour alone fails in greyscale and for colour-blind users.
2. **Mono means "this is what the file actually said".** Any string lifted from
   a source document is set in Azeret Mono. Anything we wrote ourselves is
   Archivo. The eye learns the difference in about ten seconds and then it is free
   information forever.
3. **Every claim points at its evidence.** No value is shown without a route to
   the line it came from. This is the product's whole argument, so the UI is not
   allowed to break it.
4. **Brand colour is chrome. Status colour is meaning.** They never mix, and
   they never appear in the same role.

---

## 2. Colour

### 2.1 Neutrals

| Token | Hex | Use | Measured |
| --- | --- | --- | --- |
| `--ink` | `#101A24` | All primary text, dark surfaces | 16.25:1 on paper · AAA |
| `--paper` | `#F7F6F2` | Page background. Warm off-white, never `#FFFFFF` | |
| `--muted` | `#55606B` | Secondary text, labels, metadata | 5.94:1 on paper · AA |
| `--rule` | `rgba(16,26,36,0.10)` | Hairline dividers. 1px, never heavier | |

### 2.2 Brand accent

| Token | Hex | Use |
| --- | --- | --- |
| `--brand` | `#E78823` | Averis orange. Header, logo lockup, primary buttons, slide deck |

**Corrected on 21 Sep.** This token previously held `#D88C3D`, described here as
"sampled from the Averis site". That sample was wrong. `#E78823` is the value
the Averis site's own stylesheet uses, 53 times on the homepage, and it is the
exact fill of the swoosh in `averis-master-logo.svg`, the logo file the site
itself serves. A near-variant `#EA8B23` appears nine times and looks like drift
rather than a second brand colour.

**Two hard rules:**

- **Never use it as a status.** It sits at hue 30.9 degrees, six degrees from
  the amber we originally had for "needs a person". Chrome and meaning would be
  indistinguishable.
- **Never use it for small text on paper.** 2.20:1, fails.

**One accepted exception, decided on 19 Sep by seunniee.**

Primary buttons use **white text on the brand orange**. On the corrected value
this measures **2.64:1 and fails AA**, marginally worse than the 2.71:1 recorded
against the old sample. It cannot be made to pass at any font size, because even
the large-text allowance is 3:1. Ink on orange would pass at 6.65:1.

The correction does not change the decision. The exception was taken knowing the
number failed; it still fails, by about the same margin.

This was raised twice with the numbers and chosen anyway on appearance. It is
the one deliberate accessibility failure in the design, it is confined to the
primary button, and it is written down here so nobody silently "fixes" it or
silently repeats it somewhere new.

If we ever want white text legally, the orange has to darken until it is brown
and no longer the Averis colour. That trade was looked at and rejected.

It is legible as orange-on-ink (6.65:1), which is how the Averis footer uses it
and the one genuinely accessible use on their site.

### 2.3 Status

| State | Token | Hex | On paper | White text on it | On `--ink` |
| --- | --- | --- | --- | --- | --- |
| Something is wrong | `--status-wrong` | `#B83A28` | 5.29:1 AA | 5.72:1 AA | 3.07:1 UI only |
| Held for review | `--status-review` | `#006DAE` | 5.11:1 AA | 5.53:1 AA | **3.18:1 shape only** |
| All clear | `--status-clear` | `#2E7D6E` | 4.54:1 AA | 4.91:1 AA | 3.58:1 UI only |

`--status-review` is **Monash blue, unaltered**. On the dark shell it may appear
as a shape at true value, but as **text** it must lift to `--blue-lift`
`#5FB3E8` (7.61:1 on ink). That is a dark-mode treatment of the same hue, not a
change to the brand colour.

**Status colours do not go on dark surfaces.** §2.2 sanctions orange-on-ink for
chrome, which makes a dark header or a dark panel tempting. Do not put a status
badge on one: `--status-review` fails outright there at 2.77:1, and the other
two clear only the 3:1 non-text threshold. On a dark surface, invert instead,
solid status fill with white text on top.

**Changed from the standup deck.** "Needs a person" was amber `#9A6614`. Amber
sits six degrees of hue from the Averis orange and would have read as chrome.
Monash blue sits 175 degrees away and cannot be confused with it.

**Do not lighten `--status-clear`.** At 4.54:1 it clears AA by 0.04. There is no
margin in it.

### 2.4 Both hosts, neither brand system

The product carries **Averis orange and Monash blue, both at their exact
values**, because it is built for the Averis x Monash hackathon and both hosts
should be visible in it.

What we are **not** doing is adopting either brand system wholesale. The Monash
brand book requires a minimum of 25% Monash blue across all communications and
puts deviations behind an approval form. Those are obligations on Monash
communicators, not on us, and a tool that looked like a university website would
undercut the ops-desk credibility the pitch is built on. We take the colour, not
the rulebook.

The one further part of the Monash system worth borrowing is the **utility
palette**,
which they built specifically for data visualisation "where multiple data points
need clear differentiation". It is the right tool for the seven-category bar
chart on the dashboard. Measured against our paper:

- **Usable:** Blueberry `#121256` 15.58:1 · Navy `#102F86` 10.95:1 ·
  Forest `#0B6554` 6.47:1 · Red `#EA001F` 4.30:1 · Purple `#7463D7` 4.31:1
- **Not usable on our background:** Yellow `#FFBA00` 1.58:1 ·
  Heritage blue `#ABF5F9` 1.13:1 · Green `#83A00A` 2.78:1 ·
  Orange `#F86700` 2.80:1

---

## 3. Typography

| Role | Face | Size | Weight |
| --- | --- | --- | --- |
| Screen title | Archivo | 22px | 600 |
| Section heading | Archivo | 17px | 600 |
| Body and table cells | Archivo | 15px | 400 |
| Secondary | Archivo | 14px | 400 |
| Metadata and counts | Archivo | 12.5px | 400 |
| Tracked labels (compact capitals) | Archivo | 11px | 600 |
| **Document values** | **Azeret Mono** | 14px | 400 |

Each row is a token in `web/src/index.css` (`--fs-title`, `--fs-head`,
`--fs-body`, `--fs-small`, `--fs-meta`, `--fs-label`). Every size below 15px
goes through a token; a few display numbers, hero headings and glyphs at 15px
or larger are written in place. Nothing a person is meant to read sits below 11px. The scale
was raised one step on 22 Sep 2026 after it read too small at 100% zoom.

The protected ProtoZero wordmark is the sole typography exception: it retains
the original Lato 700 lettering and JetBrains Mono 700 orange zero.

Use 400 for body copy, 500 for controls and 600 for headings. Weight 700 is
reserved for the product wordmark. Sentence case everywhere except compact
operational labels, which may use tracked capitals.

Numbers get mono for a second reason beyond principle 2: in a proportional face,
`131,058` reads as visually smaller than `99,999`. Container count and gross
weight are our two numeric fields and both appear in comparison tables, so this
matters.

---

## 4. The status system

Every state is expressed **three times**: colour, shape, word. Any one of them
removed, the row still reads.

| State | Colour | Shape | Icon | Word |
| --- | --- | --- | --- | --- |
| Something is wrong | `--status-wrong` | Circle | `ti-x` | "2 differences" |
| Held for review | `--status-review` | Rounded square | `ti-user` | "Held for review" |
| All clear | `--status-clear` | Square | `ti-check` | "All clear" |
| Not a check | `--muted` | None | none | "Invoice query" etc. |

**Why three signals.** Desaturated, `--status-clear` and the old amber came out
as the identical grey `#717171`, and `--status-wrong` as `#666666`. I tried to
design a status set that separates in both hue and brightness and could not make
it work: passing AA on a light background forces every colour dark, which
squashes the brightness range.

The best any pair reached was 1.54:1, and the move to blue made the tightest
pair **worse**, not better: wrong against review is now 1.11:1 in greyscale,
where the old red against amber was 1.17:1. The blue was chosen to separate from
the brand orange, and it costs us slightly on this axis. So this is not solvable
by picking better colours. The shape and the word are load-bearing, not
decorative.

**Test for any new screen:** delete every colour. Can you still read every state?
If not, the screen is not finished.

---

## 5. Confidence display

**Ratified 20 Sep by seunniee, and built.** Slide 8 flagged this as the one
must-have with no design. The tick pattern that stood here was dropped; what
follows is what `.conf` in `web/src/index.css` actually does.

### 5.1 The mark is a word

Every compared field carries one word at the right-hand end of its box label:

| Word | Condition | Colour |
| --- | --- | --- |
| checked | `score >= REVIEW_THRESHOLD` and no `hard_fail` | `--muted` |
| unsure | `score < REVIEW_THRESHOLD`, no `hard_fail` | `--blue` |
| not checked | `hard_fail` is set, whatever the score | `--blue` |

`REVIEW_THRESHOLD` starts at `0.55`, from `pipeline/config.py`
([`spec/pipeline.md`](spec/pipeline.md) §6). `hard_fail` wins over the score, so
a field can sit at `0.70` and still read **not checked** — which is exactly
`email_516`'s gross weight.

**Why a word and not an icon.** §1 asks for colour plus shape plus word. A word
*is* a shape: `checked` and `not checked` separate at a glance with every colour
stripped, which is the §4 test, and it was run against the built page in
greyscale, not assumed. An icon on top of the word would be the fourth telling
of the same fact that §1 exists to prevent.

**It never borrows the verdict colours.** Confidence answers "how well did we
read this", the verdict answers "do the two documents agree". They are
independent: a field can match perfectly at low confidence. So the mark uses
only `--muted` and `--blue` — never `--wrong`, never `--clear` — and
`index.css` holds an explicit rule keeping it muted inside a flagged box, where
`.bx--flag` would otherwise inherit red onto it.

Measured on `--sheet`: `--muted` 6.42:1, `--blue` 5.53:1. Both AA.

### 5.2 Where it does not appear

Only the seven `FieldName` fields get a mark. Boxes the pipeline never compares
— export carrier, commodity, description — get nothing, so the column of marks
is itself the answer to "which fields do you actually check".

It appears in the document boxes and nowhere else. The margin note explains
*why* a field was not checked; it does not repeat the word.

**Do not show the raw number.** A score of `0.95` invites an argument about
whether it should have been `0.96`. If the five-component breakdown is ever
wanted, it belongs in a hover or an expandable row, not on the surface.

### 5.3 What was cut, and why

**The green "a human confirmed this" tick is not built.** It has no source of
truth. `ExtractedField.extracted_by` looks like the answer but is not: it
records **how a value was extracted** (`parser` / `doc_intelligence` / `llm` /
`human`), and a reviewer pressing confirm on a value the parser already got
right does not change how it was extracted. The confirm lands in the separate
`corrections` collection as `Correction.action`.

One of two things has to happen first, and it is a backend decision, not a
frontend workaround:

1. A `human_reviewed` flag on `FieldComparison`, set when a correction resolves,
   **or**
2. The API derives it from the `corrections` collection and includes it on the
   `Case`.

Option 1 is cheaper to render and cheaper to cache. Either way it needs a
changelog entry in [`contracts.md`](contracts.md) before the state is added.
Until then the mark is machine confidence only, and the UI does not imply
otherwise.

**`unsure` is specified but not pictured.** No fixture in `web/mocks/` currently
produces a score below the threshold without also setting `hard_fail`, so the
mockup demonstrates `checked` and `not checked` from real data and shows
`unsure` only in the specimen strip. A scan-sourced field (`doc_quality` 0.5)
is the case that will produce it.

### 5.4 Case audit drawer

**Added 21 Sep.** Every case exposes an `Audit trail` action in the existing
50px shell. It opens a right-hand drawer rather than adding another route or
navigation surface.

The drawer explains the seven pipeline stages in order: classify, gate,
extract, normalize, compare, confidence and decide. Each stage carries a word
and a shape as well as colour: `Completed`, `Needs attention`, `Difference
found`, or `Not run`. The first sentence is written for a documentation
executive; durations, pipeline versions and model names stay under collapsed
`Technical details`.

The stage explanation is reconstructed from the saved `Case`, so it remains
available in fixture mode. When the live API is connected, the drawer also reads
`GET /cases/{email_id}/events` and shows the ordered system and reviewer history.
The two views stay separate: stages explain the current result; events show what
changed over time.

`Copy audit summary` produces a plain-text handoff for support or a hackathon
demo. `Download case JSON` exposes the exact saved record behind the explanation.
When a stage identifies a field with a difference or confidence problem, its
evidence action closes the drawer and opens that field's highlighted SI and
draft lines. `Show issues only` is available when the run has an attention or
difference stage. With the live API connected, a separate activity log shows
ordered system and reviewer events.

### 5.5 New-user orientation

**Added 21 Sep.** The product's distinctive idea is stated once on the worklist:
"from inbox to decision, with proof at every step." A three-step explanation
then teaches the workflow — sort the email, compare seven details, explain the
decision — without introducing a tour modal or requiring dismissal.

Every route names itself in the dark shell. Case pages lead with one compact
status banner containing the outcome, email subject, plain-language summary,
case id and sender. The review queue calls itself a human checkpoint and says
explicitly that the system stopped instead of guessing. These additions use the
existing paper/document metaphor and existing tokens only; no new brand or
status colours were introduced.

---

## 6. Layout and density

Figures from enterprise data table practice, not invented.

- **Row heights:** condensed 40px, regular 48px, relaxed 56px. Ship a switcher
  and remember the choice. Someone reading this screen two hundred times a day
  will want condensed.
- **Status marker goes at the start of the row**, so a column of them scans
  vertically.
- **Dividers:** 1px `--rule`. **No zebra striping.** Stripes plus hover plus
  selected plus focus produces five competing greys and the hierarchy collapses.
- **Alignment:** text left. Numbers right, in mono. Headers match their column's
  alignment.
- **Vertical alignment in cells:** centre for one to three lines, top-align at
  four or more.
- **Sticky header** on the worklist.
- **Focus states must be visually distinct from hover states.** Keyboard users
  cannot locate themselves otherwise.
- **Row click opens the detail as a side panel**, which is the standard pattern
  for large record payloads, and means screen two may not need its own route.
- **High-stakes edits get friction.** Inline editing is fine for ordinary data.
  Resolving a review item overrides the machine on a field that decides where a
  container goes. That goes through a modal or an expanded row, never a
  single-click inline edit.

---

## 7. The four screens

Build in this order. It is deliberately not the order a user meets them in.

### Screen two, the comparison (build first)

The screen that sells the project. If the video shows one thing, this is it, and
it is what the 25-point prototype criterion is actually looking at.

Seven rows, SI value against BL value, differences tinted. Click a row and the
source document panel scrolls to and highlights the exact text that value came
from. Confidence mark per row. Label actually seen in the document shown as
metadata, because "we read `To the Order of` and understood it as consignee" is
the normalisation feature becoming visible.

### Screen three, the review queue

Only cases the system refused to answer. One card per item carrying: what it
could not decide, why, what it saw in both documents, and a way to settle it.
`ReviewItem` in `contracts.md` §5 already supplies every one of those fields.

Show a **history of actions** on each item. Two people demoing at once otherwise
looks like a bug.

### Screen one, the worklist

An inbox-oriented table separates incoming work, completed history and the full
record. A contained panel filters by result, email type and date and allows
multiple selections. It expands below the work-view tabs, preserving the full
list width and avoiding an overlay over operational records.

Consider showing the open review count on load, so triage is the first thing
seen rather than something to navigate to.

### Screen four, the dashboard

The expandable dashboard uses the same reporting period as the worklist and
Excel register. It shows scoped counts, email workload, document-comparison
outcomes, defects by field and human-review reasons. Counts remain visible next
to every bar so colour or relative length is never the only way to read a
result. Non-comparison email is not counted as automatically cleared.

**The time-saved figure stays bracketed until Averis gives us a real number.** If
a judge asks where it came from and the answer is that we invented it, we lose
more than the number is worth.

---

## 8. Accessibility checklist

Run this before calling any screen done.

- [ ] Every status reads with all colour removed
- [ ] Body text at least 4.5:1, UI components and large text at least 3:1,
      with the one recorded exception in §2.2 (white on the primary button)
- [ ] Focus visible and distinct from hover on every interactive element
- [ ] Icon-only buttons have an `aria-label`
- [ ] The comparison table is a real `<table>` with proper headers
- [ ] Keyboard alone can reach a row, open it, and resolve a review item
- [ ] Nothing depends on hover alone to be discoverable

---

## 9. Working order

Not a staged execution plan. If one is wanted, say so and it can be written
properly with per-stage owners and acceptance criteria.

| Order | Work | Depends on |
| --- | --- | --- |
| 1 | Vite and Tailwind scaffold, tokens from §2 and §3 as CSS variables | nothing |
| 2 | Fixture client reading `web/mocks/`, one swap point for the real base URL | [`web/mocks/`](../web/mocks/README.md) |
| 3 | Screen two against `email_004`, text highlighting path only | 1, 2 |
| 4 | Screen three, all five escalation fixtures | 1, 2 |
| 5 | Screen one, filters and density switcher | 1, 2 |
| 6 | Swap fixtures for the live API | Gene's `/api` |
| 7 | Screen four, if the core is green | 6 |

**Point the app at `web/mocks/` from step 2 and do not wait for the backend.**
Every endpoint shape in `contracts.md` §6 already has a fixture with real values
and verified character offsets.

### The highlight path is three components, not one

The single most likely thing to eat a day if discovered on Sunday.

| Format | Locator gives you | Render as |
| --- | --- | --- |
| `txt`, `docx` | `line`, `char_start`, `char_end` | offsets into `text` |
| `pdf`, `scan_pdf` | `page`, `bbox` | box overlaid on the page image |
| `xlsx` | `sheet`, `line` | highlighted row in a rendered table |

Every fixture is currently `txt`. The real set has 28 PDFs, 22 spreadsheets and
8 Word documents. Build the text path first, but do not write it as though one
component covers all three.

---

## 10. Open questions

- Confidence mark: the §5 tick pattern, ratified or replaced. **seunniee.**
- **Blocking:** nothing on the `Case` records that a human confirmed a field, so
  the green tick cannot be built yet. Needs a `contracts.md` decision, §5.
  **Whoever owns `contracts.md`.**
- **Screen four.** Rejected as built: four stat tiles above a bar chart is the
  most templated dashboard layout there is. Cut it, replace it with a proof
  screen showing the eval score climbing, or keep it operational without tiles.
  **Open.**
- Worklist on a narrow screen: table or cards.
- Empty states. Nothing has been designed for "no results" or "queue is clear".
- Do we want a logo.
- Judge-uploaded documents, or bundled inbox only. Open in
  [`prd.md`](prd.md) §8 too.

---

## Changelog

- **v1, 19 Sep 2026** — initial. Palette carried over from the standup deck with
  one change: "needs a person" moved from amber `#9A6614` to blue `#2C5FA8` to
  stop it colliding with the Averis brand orange. Every contrast figure measured
  rather than assumed.
- **v2, 19 Sep 2026** — `--status-review` changed again, from `#2C5FA8` to
  Monash blue `#006DAE`, on seunniee's call: both host brands present, neither
  altered. On the dark shell it lifts to `#5FB3E8` for text only, since true
  `#006DAE` is 3.18:1 there. Shell changed to ink with bright content. Screen
  two now leads with the failing details only. Primary buttons take white text
  on the orange as a recorded, accepted AA failure, §2.2.
- **v3, 21 Sep 2026** — added the case audit drawer, §5.4. It explains all
  seven pipeline stages from the current `Case`, keeps technical metadata
  secondary, and remains honest that immutable audit events are not live yet.
- **v4, 21 Sep 2026** — connected the drawer to the live audit-event endpoint;
  added issue-only filtering, saved-case JSON export and stage-to-source
  evidence navigation without changing the established colour system.
- **v5, 21 Sep 2026** — added the evidence-first welcome path, explicit screen
  names, case context banner, review-queue explanation and useful empty-filter
  state for first-time users. Existing status shapes and colours remain intact.
- **v6, 21 Sep 2026** — rebuilt the worklist as one coherent operations surface,
  shortened the welcome content, grouped search/reporting/filters with the case
  register, and replaced IBM Plex Sans + JetBrains Mono with Archivo + Azeret
  Mono. The evidence-versus-interface type distinction remains unchanged.
- **v7, 21 Sep 2026** — added Incoming, History and All records work views, a
  quick-look inbox summary, combined keyword/date/type/result filtering, and a
  responsive expandable filter panel that never overlaps the case list. The
  reporting-period control scopes both the visible worklist and Excel export;
  keyword and advanced filters remain screen-only refinements.
- **v8, 21 Sep 2026** — the held state's word changed from "Needs a person" to
  "Held for review" on seunniee's call: it names the action the system took
  rather than a lack. Shape and colour unchanged. The comparison screen was
  rebuilt as two facing documents (instruction and draft, every line, the
  seven compared lines named in the margin, a thread joining each to its twin)
  with corrections written in place and a note per correction beneath the
  pages; the separate evidence panel and margin cards are gone, see
  `web/mockups/direction-d-hybrid.html`. Fonts are bundled in `web/src/fonts/`
  so the app renders identically offline. Editorial sentences that asserted
  the system's own trustworthiness were removed; the UI states what happened.
