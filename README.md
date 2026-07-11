# 🩻 ArchXray

**See what a pull request does to your architecture — before you merge it.**

Every PR quietly reshapes your system's structure, and nobody notices until the
architecture diagram on the wiki is a work of fiction. ArchXray watches the
*module dependency graph* instead of the lines of code. When a PR changes the
structure, it posts one picture:

- 🟥 **new modules and dependencies in red**
- ␡ **deleted ones crossed out**
- 🚫 **forbidden dependencies called out by name** (from `archrules.json`)
- 🔄 **new dependency cycles detected automatically** — including transitive
  ones the author never saw
- 🤖 an optional **AI one-paragraph read** of what the change *means*
- 🤫 **total silence when the architecture is untouched** — no bot spam

![example](demo-out/diff.png)

## Why it's different

| Typical tooling | ArchXray |
| --- | --- |
| Renders a diagram of *now* | Renders the **delta** — what *this PR* does |
| Diagram lives in a wiki, rots | Diagram is generated from the code, per PR |
| Lint rules print text walls | Violations are **drawn on the picture** |
| Needs image hosting / auth | The PlantUML-encoded **URL *is* the image** — zero storage, zero secrets |
| Reviews are frozen in time | `timelapse` replays your **architecture's whole evolution** |

Zero npm dependencies. Works on TypeScript/JavaScript and Python repos.

## Quickstart (60 seconds)

```bash
# build the demo repo (a small shop API with git history + a spicy feature branch)
node demo/setup.js

# x-ray the "PR"
node bin/archxray.js diff --repo demo/shop-api --base main --head feature/analytics-refunds

# open archxray-out/report.html  ← interactive Impact / Before / After view
```

The demo PR adds an `analytics` module, sneaks a `payments → ui` import in
(forbidden), creates **two** dependency cycles (one of them 4 modules long and
completely invisible in the file diff), and retires the `legacy` module.
ArchXray catches all of it.

```bash
# prove it stays quiet when only implementation changed
node bin/archxray.js diff --repo demo/shop-api --base main~2 --head main~1
#   architecture untouched — staying quiet.

# the showstopper: replay the architecture's history
node bin/archxray.js timelapse --repo demo/shop-api --count 10
# open archxray-out/timelapse.html and press play
```

## Use it on any repo

```bash
node bin/archxray.js diff --repo ../your-repo --base origin/main --head HEAD
node bin/archxray.js diff --repo ../your-repo --base main --head WORKTREE   # uncommitted changes
node bin/archxray.js diff --repo ../your-repo --base main --head HEAD --ai  # + Claude narration
```

Outputs in `archxray-out/`:

| file | what it is |
| --- | --- |
| `comment.md` | ready-to-post PR comment (`gh pr comment N --body-file archxray-out/comment.md`) |
| `report.html` | self-contained interactive report (Impact / Before / After tabs) |
| `diff.svg` / `*.puml` | the diagrams and their PlantUML sources |
| `diff.json` | machine-readable diff (for your own tooling) |

## Guardrails: `archrules.json`

Drop this in the repo root. Only *newly added* dependencies are judged —
pre-existing debt is baseline, not blame.

```json
{
  "forbid": [
    { "from": "payments", "to": "ui", "reason": "payment logic must stay UI-free" },
    { "from": "*", "to": "legacy", "reason": "legacy is frozen — no new callers" }
  ]
}
```

Add `--fail-on-violation` to make CI red when a rule breaks or a new cycle appears.

## GitHub bot mode

Copy `.github/workflows/archxray.yml` into the repo. It uses only the built-in
`GITHUB_TOKEN` — no app registration, no secrets, no image hosting. The comment
embeds the diagram as a PlantUML-server URL, so the picture *is* the data.

## How it works

1. `git archive` snapshots the base and head refs (no checkout, working tree untouched)
2. Imports are parsed (TS/JS `import`/`require`, Python `import`/`from`) and
   collapsed to a **module-level graph** — one node per top-level source folder
3. The two graphs are diffed: added/removed nodes and edges
4. Added edges are checked against `archrules.json`; each added edge is also
   tested for closing a cycle (BFS back-path), so every reported cycle is
   provably *introduced by this PR*
5. A merged PlantUML diagram is emitted (kept = neutral, added = red,
   removed = gray + struck out, forbidden = flagged) and deflate-encoded into a URL
6. Optionally, the diff summary is piped to `claude -p` for a 10-second human read

## POC limitations (deliberate)

- Module granularity = top-level folders under `src/` (or repo root); root-level files are ignored
- Import detection is regex-based (no tsconfig path aliases beyond `@/`, no barrel-file tracing)
- Rendering uses the public plantuml.com server — run your own PlantUML/Kroki
  container and pass `--server` for private code
- Rule patterns are exact names or `*` (no globs, no layer groups yet)

## Ideas that would take this further

- Coupling/instability score per PR ("this PR raises coupling by 12%")
- Blast-radius view: highlight every module transitively affected by the change
- `CODEOWNERS`-aware pings when *your* module gains a new inbound dependency
- Weekly "architecture drift" digest, and a badge for the README
