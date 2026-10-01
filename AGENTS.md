# Repository workflow

These rules apply to all work in this repository.

## Branches

- Never commit directly to `main`. Start from an up-to-date `main` and use one focused branch per change.
- Name branches `<type>/<short-kebab-case-topic>`, using an appropriate type such as `feat`, `fix`, `chore`, `docs`, `refactor`, or `test`.
- An issue number may follow the type when the work is issue-linked, for example `feat/24-ticket-activity-timeline`.
- Keep follow-up concerns in separate branches and pull requests.
- Do not include tool names, automation attribution, or similar references in branch names or other repository artifacts.

## Commits

- Use exactly one line in conventional format: `<type>: <description>`.
- Use an appropriate lowercase type such as `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`, `style`, or `revert`.
- Keep the description concise, lowercase, and without a trailing period, for example `feat: bundle event artwork with portable archives`.
- Prefer a series of small, logically complete commits over one broad commit whenever the work can be separated cleanly.
- Keep each commit simple enough for a human to review independently and keep the repository working at commit boundaries wherever practical.
- Leave unrelated working-tree changes untouched.
- Do not add commit bodies, tool or automation attribution, or co-author trailers.

## Pull requests

- Open every change against `main`; do not push changes directly to `main`.
- Use an imperative, sentence-case title that describes the user-visible outcome.
- Include a concise summary and the exact verification performed.
- Do not mention tools used to create the change or include automation attribution in titles, descriptions, comments, or review replies.
- Do not merge until the branch is mergeable and required checks pass.
- Use a merge commit unless the user requests another strategy.
- After every merge, delete the source branch both remotely and locally, return to `main`, update it, and prune stale remote branches.

## Issues and scope

- Read the full assigned issue, its acceptance criteria, and its dependencies before making changes.
- Implement only the assigned scope. Do not silently expand the task into adjacent work.
- Keep follow-up work separate when it is not required to satisfy the current issue.
- Reference the relevant issue in the pull request when the work is issue-linked.
- If a requirement is genuinely ambiguous and the existing repository context does not resolve it, surface the ambiguity instead of inventing product requirements.
- Do not merge a pull request, close an issue, or begin follow-up work unless explicitly requested or the current task specifically requires it.

## Code changes

- Inspect the existing architecture, conventions, and nearby code before implementing a change.
- Prefer existing project abstractions and patterns over introducing parallel approaches.
- Avoid unrelated refactors and formatting churn.
- Do not change public contracts unnecessarily.
- Do not add a dependency when the required behavior is already reasonably supported by the project or platform.
- Do not manually edit generated, vendored, or lock-managed content except through the appropriate generator or package manager.

## Verification

- Run the narrowest relevant tests while developing, then the affected workspace checks and production build before opening a pull request.
- Add or update tests when behavior changes.
- Never delete, weaken, skip, or rewrite a valid test merely to make a failing implementation pass.
- Never claim a test, check, build, or manual verification was performed when it was not.
- For frontend changes, verify the live route when an authenticated local session is available and state any verification boundary clearly.
- Record commands run and meaningful limitations in the pull request body.

## Security and privacy

- Never commit credentials, access tokens, private keys, secrets, `.env` contents, private recordings, transcripts, or user data.
- Treat uploaded media and transcription content as sensitive user data.
- Keep uploaded media private by default and expose it only through explicitly authorized application flows.
- Validate authorization at trust boundaries rather than relying only on client-side checks.
- Do not log secrets or sensitive transcript/media contents unless a requirement explicitly calls for safe, deliberate diagnostic handling.

## Database changes

- Represent schema changes with migrations.
- Do not rewrite an already-applied migration merely to alter the resulting schema; add a new migration instead.
- Keep migrations reviewable and include the corresponding application/model changes in the same focused change when appropriate.

## Dependencies

- Use the repository's configured package manager and workspace tooling.
- Keep dependency additions intentional and minimal.
- Prefer stable, maintained packages when a dependency is justified.
- Do not replace foundational libraries or tooling as incidental work in an unrelated issue.

## Documentation

- Update documentation when setup, configuration, architecture, public behavior, or developer workflow materially changes.
- Keep documentation aligned with the implementation rather than documenting planned behavior as if it already exists.

## Attribution

- Treat work produced with development tools as ordinary project work.
- Do not include AI, assistant, model, tool, automation, or generator attribution in commits, branches, pull requests, issues, comments, review replies, source code, documentation, changelogs, or other repository artifacts unless the user explicitly requests it.
- Do not add `Co-authored-by` trailers or similar attribution.

## Completion

- Work is not complete merely because code has been written.
- Before declaring a change complete, confirm the assigned acceptance criteria are satisfied and run the required verification that is available in the working environment.
- State any known verification gaps, blockers, or limitations clearly.
- Leave unrelated working-tree changes untouched.
