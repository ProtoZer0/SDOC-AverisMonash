# HANDOFF

## Snapshot

**22 Sep 2026, 01:05 MYT.** `ui/facing-pages` is merged into `main` locally as
`e8aca4e` (branch tip `eac3a3c`, pushed). **main is NOT pushed.** Pushing main
triggers the GitHub Actions deploy, so that is Yingxin's call. Build passes,
48 tests pass, the live dev server (port 5175, serving main) shows the facing
pages, review queue and analytics. **Judging today, 12:00 MYT.** Demo path:
worklist, open `email_004`, click a red value on the draft, then `email_515`
(refusal), then the review queue.

**The repo is `C:\Users\yingx\Desktop\SDOC-AverisMonash`.** The folder
`C:\Users\yingx\Desktop\ProtoZero-AverisMonash` is an old clone; never edit it.
**Do not switch branches in GitHub Desktop while a session is editing**: each
switch stashes and reshuffles the working tree (cost an hour on 22 Sep).

## Done tonight (22 Sep, 00:00 to 01:00)

- Type scale raised one step and fully tokenised (`--fs-*` in `index.css`,
  nothing readable below 11px); `docs/design_system.md` §3 matches.
- Case screen: no threads on a refusal, the record card fills the empty page
  with the stage strip at its foot; a value whose twin cannot be located on the
  other page draws no thread and no lone marker; wider text margins; label
  column 150px.
- Three panels under the pages share one card style, one left edge, one-line
  titles, hairline under each title, only the decision button is orange; the
  priority pill and the report's result chip are gone (status lives in the
  banner only). Report Documents cell says "not read" / "wrong document" /
  "not attached" instead of a tick; Issues says "Not compared" when nothing was.
- Link-styled buttons no longer underline and centre like real buttons.
- Tabs read Analytics, Worklist. Review queue keeps DickGrayson's two
  behaviours (no "Confirm and close" on a blank-value hold; "Correct a value"
  targets the instruction when it is the blank side).

## Active plan

No staged plan file. Frontend work is driven by the brief seunniee gave on 21 Sep
(two rounds: mockups, then implementation) and `web/implementation-notes.md`,
which has the file-by-file table and a Deviations section. Scored gates live in
`docs/submission_checklist.md`.

## Done & verified

- **Branch `ui/facing-pages`** (4 commits on top of `863dee5`: `c23d665`,
  `6ce5439`, `2c3c882`, `3594aa4`). Comparison screen is two facing documents
  with SVG threads (`web/src/Pages.jsx`, new); worklist has next-step chips and
  To do / Done / All; review queue is an inbox layout with confirm step and bulk
  outbound requests; analytics is a funnel plus four question panels. "Held for
  review" replaces "Needs a person" everywhere (design_system v8). Fonts bundled
  in `web/src/fonts/`, no Google Fonts, no animation library.
  *Verified:* `npm run build` passes inside SDOC; headless-Chrome click script
  (`drive.mjs`, in the old session's scratchpad, not in the repo) run against
  the **live** server on 5175: chips filter, 12 hits and 6 threads on
  `email_004`, selected thread stays drawn after click, audit evidence buttons,
  confirm strip, queue keyboard nav, bulk request, confirm-and-next focus,
  analytics drill-down, zero console errors. Fresh-eyes verifier (double-checker)
  returned FAIL on seven wording items on 21 Sep; all seven fixed in `2c3c882`.
- **Tab order swap** (Analytics before Worklist in `web/src/Bar.jsx`): committed
  on the branch as `3594aa4`; screenshot of the live server confirmed.
- Her earlier "some small fixes" commit (`c542f0e`) is fully contained in the
  branch; the cherry-pick onto the new main lost nothing.

## In flight

- **Review queue lists a case once per blank field** (`email_517`, `email_518`
  appear twice under "A value is blank"; header says 16 or 17 open while the
  top bar says 13 or 14). Not fixed; visible to a judge. Group by case.
- **`web/mocks/README.md` is copied into `dist/`** by `publicDir: 'mocks'`.
  Remove before the judged deploy.
- Quiz gate for the Round 2 work was offered and not answered.

## Next steps

1. **Push main** when Yingxin says so (deploys via GitHub Actions). *Done
   when:* `origin/main` = `e8aca4e` or later and the Container App serves the
   facing pages.
2. **Demo run-through on the live server**: worklist, `email_004` (click
   "UAB NOVAKOPA"), `email_515`, review queue confirm-and-next. *Done when:*
   no empty or broken state on that path.
3. Fix the duplicate queue rows (see In flight) if there is time.
4. Remaining submission gates: public deploy URL plus the raw
   `*.azurecontainerapps.io` fallback in `README.md`, slide deck (brief at
   `docs/deck_brief.md`, untracked), unlisted demo video, Azure architecture
   diagram in the deck.

## Decisions & why

- **Hybrid "Facing Pages + Redline" direction** chosen by seunniee after two
  feedback rounds over four mockups (`web/mockups/direction-*.html`). Not to be
  re-litigated: threads carry no words; corrections read wrong-then-right;
  correction notes sit under the pages, not beside them; non-compared lines are
  greyed; no line numbers; no editorial sentences ("Nothing here is a guess").
- **"Held for review"** is the held-state word (she disliked "Needs a person").
- **Headline says "match", never "checked"**, so the confidence word "checked"
  (design_system §5.1: read with confidence, whatever the verdict) keeps one
  meaning. Renaming that mark to "read" is her call, not done.
- **Bulk actions only for outbound requests** in the review queue; "Confirm and
  close" is never bulk.
- **Tabs read Analytics, Worklist**; the app still opens on the worklist.
- Unchanged from before: one 50px bar is the whole shell; orange `#E78823` is
  chrome only; blue = needs a person and active states; mono = what the document
  said; say each thing once; white-on-orange button is a recorded AA failure,
  leave it.

## Watch-outs

- **Organisers' package deleted from disk by the pull.** `173899f` untracked
  `sdoc-hackathon-docker/`, so the 790 files vanished from her working copy. A
  full copy is at `C:\Users\yingx\Desktop\sdoc-hackathon-docker-backup`. Copy it
  back in if she wants `scoring.py` locally; it is now ignored by git.
- **Project `CLAUDE.md` still says orange `#D88C3D`.** The real token is
  `#E78823` in `index.css`. Fix the doc, not the CSS.
- **Case report keeps its own result chip** (deliberate: printable summary);
  the verifier flagged it as a possible third home. Issues cell shows counts only.
- **`npm run build` on seunniee's machine** needs `npm install --os=win32`
  because her `~/.npmrc` has `os=linux`. It built fine on 21 Sep, so this may
  already be resolved; do not add platform binaries to `package.json`.
- **`publicDir: 'mocks'` copies `web/mocks/README.md` into `dist/`.** Remove
  before the judged deploy.
- **Threads need char offsets.** Fixtures are all `txt`; PDFs and spreadsheets
  show text without threads. Live data shape matched fixtures on 21 Sep
  (`fmt,text,page_count,attachment_path,page_urls`).
- **Untracked local files she owns:** `docs/deck_brief.md`, `web/mockups/`
  brandkit, logo, fav*.svg, favsize, zerocheck. Leave them alone.
- `HANDOFF.md` is tracked in git (committed by a teammate as `0fd9636`); it
  carries absolute `C:\Users\yingx` paths on purpose, since the folder mix-up
  cost an evening.
