# Session workflow

Use [next steps](next-steps.md) as the single current-priority register. This workflow is for repository development, not family-agent conversational memory, runtime instructions, or private installation state. New documentation is written in English; product interaction remains Spanish.

## Start a session

1. Read [root instructions](../AGENTS.md), this workflow, and the resume point and relevant IDs in [the register](next-steps.md). Read scoped instructions for the files you will touch; `agents/*/AGENTS.md` are product templates, not developer handoff files.
2. Check actual repository state with `git status --short`, `git branch --show-current`, `git log -5 --oneline`, `git diff --stat`, and the relevant staged/unstaged diffs. Preserve existing work, including generated files. A recorded HEAD, release, test run, or device version is a snapshot, not today's state.
3. Read [architecture](architecture.md), [development](development.md), [data layout](data-layout.md), and the technical plan linked by the task. Do not inspect private state merely to reconstruct context.
4. Reconcile the register with evidence and the user's current request. Identify the task ID, scope, next action, and missing evidence. Explicit current instructions take precedence over old plans. Ask only for information or authorization genuinely needed for the next action; proceed with independent authorized work.

If records disagree, use code/diffs to establish implementation, dated test results to establish verification, and explicit user instructions to establish intent. Do not resolve ambiguity by silently choosing the most optimistic status.

## During work

- Record a new request, idea, decision, or blocker when it appears. Give each task an unused `NIDO-###` ID and each indexed decision a `D-###` ID. Never reuse IDs or renumber existing items to imply priority.
- Each open task needs **origin, state, reason, next action, and closure criterion**. Record a blocker and the condition needed to remove it. Distinguish user requests from assistant proposals and historical pending items requiring review.
- Record decisions with a date and rationale. If the original date is unknown, label the date as the recording date. Link to the detailed specification instead of duplicating its contract.
- An idea is not approval. Preserve why something was parked, rejected, or superseded and what would cause it to be reconsidered. Do not silently promote it into the active queue.
- Keep priority and handoff state only in `next-steps.md`. Specific plans own technical details, alternatives, acceptance criteria, and historical evidence; they link back to the register instead of maintaining another ranked backlog. When priorities change, update the register once.
- Store reusable evidence in tests with fictitious data or generic documentation. Never paste private logs, tokens, family information, device identifiers, or installation-specific addresses into the handoff. Follow [data layout](data-layout.md).

Suggested task entry:

```text
NIDO-### — Outcome
Origin / state: user request | assistant proposal | historical review; state
Reason: why this matters and, if parked, why it was deferred
Evidence: source, diff, test, or dated observation; note uncertainty
Next action: one concrete step; blocker and unblocking condition if any
Closure: observable acceptance criterion and delivery scope
```

## Before ending a session

1. Inspect the final diff and preserve unrelated changes. Run checks appropriate to the actual change using [development guidance](development.md). Documentation-only work needs formatting, link and whitespace checks; do not restart services or flash hardware for it.
2. Update affected tasks and add completed outcomes with references to implementation and verification. Record commands/results and their scope, or state clearly what was not run. Keep failures and unknowns visible. Do not equate a build with deployment or device success.
3. Update the resume point with active work, last result, remaining work, blockers, and a concrete next action. Identify significant uncommitted work and distinguish it from committed, published, deployed, and physically verified results. Do not imply a commit or release that did not happen.
4. Check relative file links and any heading anchors in changed documentation. Update README sections governed by symbolic comments and the relevant plan backlinks when adding/moving documents.
5. End with links to the register and a short resume prompt. Registering a next action does not itself authorize publication, deployment, real-installation inspection, or hardware changes. Follow the current request and existing repository rules for those actions.
6. When local commits are authorized, commit completed, verified units of work before handing off. Keep unrelated documentation and functional changes in separate commits, report their hashes, and state any work left uncommitted. Pushes, releases, and deployments require their own applicable authorization.

## Reuse existing records

- [Next steps](next-steps.md): current priority, stable IDs, parked work, decision index, and handoff.
- [Implementation notes](implementation-notes.md): technical rationale and implementation history.
- [Verification](verification.md): dated results and limits; preserve historical entries rather than rewriting them as current claims.
- [MVP plan](implementation-plan.md), [OTA specification](note4-github-ota-spec.md), [OAuth service guide](google-oauth-service.md), and [design system](note4-design-system.md): detailed scope and acceptance criteria. Their old pending statements do not automatically become current priorities.

Keep closed IDs and concise evidence in the register. If it eventually needs an archive, preserve a linked index and the stable IDs; keep the live resume point and priority in one place.

## New-chat prompt

“Read AGENTS.md and docs/next-steps.md, check the actual repository state, and resume from the recorded next action within my current request. Preserve existing changes and distinguish proposals from approved work.”
