# Implementation notes, frontend polish (branch `ui/facing-pages`)

Started 21 Sep 2026, evening. Direction chosen by seunniee: the hybrid of
"Facing Pages" (A) and "Redline" (C), as drawn in
`web/mockups/direction-d-hybrid.html`, after two rounds of feedback:

- Two real documents side by side, the seven compared lines named in the
  margin, hairline threads joining each to its twin, click draws the thread
  and sweeps both values.
- Red gutter rule at each correction, wrong value struck, correct value
  written beneath, correction notes in a row under the pages.
- Non-compared lines greyed; no line numbers.
- No editorial sentences. The UI states what happened, never how trustworthy
  it is.
- Worklist: counter strip, "next thing to send" column, and a next-step chip
  row as the primary filter. Result checkboxes removed. Tabs: To do / Done / All.
- Review queue: inbox layout (list left, selected case right), grouped by
  reason, keyboard navigable, confirm step on every resolve, "confirm and
  next", bulk only for outbound requests.
- Analytics: four questions (taken off the desk, left to do, what goes wrong,
  why the system stops), every block a link into the filtered worklist.
- Held state word: "Held for review" replaces "Needs a person" (owner's call,
  recorded as v8 in `docs/design_system.md`).

## What changed, file by file

| File | Change |
| --- | --- |
| `src/Pages.jsx` | New. The two facing documents, the threads (SVG, absolutely positioned, redrawn on resize and font load), the refusal record that fills a document slot when there is no text, and `buildHits`, which maps each comparison to a line and offset in each document. |
| `src/CaseView.jsx` | Loads the case and both documents together so the screen paints once. Headline sentence, correction notes, hold-case buttons that name the specific request ("Ask for a text copy"). `?field=` in the URL preselects a field. |
| `src/Sheet.jsx`, `src/Evidence.jsx`, `src/Pipeline.jsx` | Removed. Replaced by `Pages.jsx`; `Pipeline.jsx` was not imported anywhere. |
| `src/status.js` | "Held for review"; `verdictKind`, `STEPS` and `stepOf` (the next-step derivation shared by worklist, analytics and case page). |
| `src/Worklist.jsx` | Next-step chips, To do / Done / All, counter strip, next-step column, one live region, deep links with `kind=step` and `view=`. |
| `src/Review.jsx` | Inbox layout, keyboard navigation, confirm step, confirm-and-next with focus on the heading, bulk outbound requests, per-item activity list, no page-replacing error. |
| `src/Dashboard.jsx`, `src/Analytics.jsx` | Funnel plus four question panels. Classification confidence and the health panel are gone; health is one line. |
| `src/AuditTrail.jsx` | `buildStages` exported for the refusal record. One sentence reworded. |
| `src/CaseReport.jsx` | Result word "HELD FOR REVIEW". |
| `src/route.js`, `src/App.jsx` | Case route accepts `?field=`. |
| `src/index.css` | Font faces, pages, hits, record, corrections, steps, next column, queue, funnel. Old sheet, box, note, evidence, dashboard and pipeline rules removed. |
| `src/fonts/` | Four woff2 files, 106 KB total. |
| `index.html` | Google Fonts link removed. |
| `docs/design_system.md` | §4 word and a v8 changelog entry. |

## Decisions taken while building

- Fonts are bundled and declared in `index.css`, so the app renders
  identically with no network. Mockups still use Google Fonts.
- Highlight sweep uses an ink tint, not orange (chrome only) and not blue
  (would read as "held for review"). 180ms, sharp start, soft finish.
- Threads carry position and an endpoint shape only. No label, no number, no
  verdict word, so they are a pointer, not a second telling. A thread with one
  end missing (value absent on one side) stops in the gutter at a blue rounded
  square. Under reduced motion the selected thread appears without drawing.
- Correction notes carry only facts: which field, the label each document
  used, and a link that selects the field. Matched fields get no note; the
  thread is their evidence. A refusal gets no notes; the record in the empty
  document slot says everything.
- Hold-case actions: the primary button is the specific request the reason
  calls for; "Hold for review" is the secondary. The API action stays
  `request` / `review`, unchanged.
- Bulk actions in the review queue exist only for outbound requests
  (ask for the draft, the right file, a text copy, a complete instruction).
  "Confirm and close" is never bulk.
- No animation library. Everything is CSS transitions under 250ms and one
  SVG path draw at 220ms.

## Deviations

- The direction poster showed "Needs a person" in the case banner; the built
  app uses "Held for review" everywhere, per the owner's later decision.
- A held case with nothing attached (email_506) now gets the facing-pages
  layout with two record slots ("No shipping instruction was attached." /
  "No draft was attached.") instead of the old "Nothing to compare" card,
  which is kept only for cleared cases with no attachments (email_003).
- The counter strip's fourth cell was "System mode" in the poster's source
  app; it read "Unavailable" in fixture mode, which looks broken on stage, so
  it is "Not a check" as in the poster.

## After the fresh-eyes check (21 Sep, late)

- A file attached as the draft but detected as something else (email_501, a
  commercial invoice) is now titled by what it is and stamped WRONG DOCUMENT,
  instead of being drawn under a BILL OF LADING heading.
- The headline no longer uses "checked" to mean matched ("2 corrections, 5
  details match"), so the confidence word "checked" beside a struck value
  keeps its single ratified meaning: read with confidence, whatever the verdict.
- The case report's Issues cell shows counts only; the fields are named on the
  pages and in the notes.
- The audit drawer's decide stage says "Held the case for review." The
  sentence "stopped instead of guessing" lives in the review queue intro only.
- Record-slot facts are set in Archivo except format and detected kind.
- Review queue: resolving the last item moves focus to the page heading; the
  intro paragraph hides when the queue is clear.
- Worklist: a mismatch with an empty defect list now reads "Differences found"
  instead of throwing.

## Known limits to say out loud in the demo

- Threads and highlights work on `txt` and `docx` documents (character
  offsets). PDFs and spreadsheets show the document text without a thread when
  no offsets exist; the fixtures are all `txt`.
- In fixture mode the top banner says "Sample data" and write actions are
  mocked: they succeed instantly and nothing is persisted.
- The review queue's activity list is built from the item plus actions taken
  in this browser session. The live audit events endpoint is not called here.
- The "Sample data" banner adds 42px above the 50px bar; the layout below it
  is unchanged.
