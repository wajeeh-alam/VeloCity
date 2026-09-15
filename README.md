# Create and Submit the VeloCity Project README

## Summary

Replace the default Vite README in `wajeeh-alam/VeloCity` with a judge-facing project specification and three-person collaboration guide.

The repository already contains a React/Vite app on `main`, and only `main` exists remotely. The change will be made on `docs/hackathon-readme`, committed, pushed, independently reviewed, and submitted as a PR.

⚠️ The GitHub CLI is unavailable. After pushing, create the PR through the authenticated GitHub web interface. If GitHub authentication is unavailable, report the blocker prominently and provide the branch comparison link without claiming that a PR exists.

## README Content

Replace the template README with:

- **VeloCity — Toronto Bike-Lane Agent Simulator**
  - Tagline: “Find where Torontonians would bike if a safe connection existed.”
  - Status badge: `Hackathon MVP — planning evidence, not an official recommendation`.
- **Problem and insight**
  - Existing ridership data emphasizes places where people already cycle.
  - VeloCity combines observed demand, latent demand, road danger, accessibility, and network gaps.
- **60-second demo**
  - Select a corridor.
  - Review its nine inputs and rating.
  - Virtually build it.
  - Watch weighted agents reroute.
  - Compare low-stress trips, population connected, destinations reached, and dangerous segments avoided.
  - Advance through an illustrative Year 1–3 rollout.
- **ML and simulation**
  - Predict relative bicycles per observed hour, not exact future riders.
  - Use Bike Share OD flows, counters, census indicators, collisions, infrastructure, transit, destinations, and OSM routing.
  - Describe agents as weighted synthetic travel-demand units.
  - Label results “simulated low-stress uptake” and “accessibility benefit,” not causal ridership growth.
  - Use spatial validation against a median baseline and a transparent fallback if ML does not outperform it.
  - Treat ages 15–34 as a limited hypothesis feature alongside all-age population and accessibility; never automatically down-rank older communities.
- **Ratings**
  - Normalize and version nine inputs: safety, connectivity, equity/population, current demand, potential demand, transit, barriers, coverage, and destinations.
  - A strong input is `>=60`.
  - `Top`: 8–9 strong inputs and no core weakness below 40 in safety, connectivity, or potential demand.
  - `High`: 6–7 strong inputs.
  - `Medium`: 4–5 strong inputs.
  - `Low`: 0–3 strong inputs.
  - Rank within tiers by mean score and explicitly allow no route to qualify as `Top`.
- **Four-hour MVP**
  - Evaluate 15–25 plan-backed candidates and 3–5 exploratory connectors.
  - Precompute the 10 strongest scenarios.
  - Animate only a representative subset of agents.
  - Exclude live model training, exhaustive citywide optimization, precise engineering costs, and arbitrary route drawing.
  - Crime and bicycle-theft data are intentionally excluded.
- **Data sources**
  - Toronto Transportation Data & Analytics.
  - Bike Share Toronto OD trips.
  - Permanent counters and intersection bicycle counts.
  - Cycling Network and planned routes.
  - KSI collision data.
  - 2021 Census/Neighbourhood Profiles.
  - Transit, schools, employment, destinations, and OpenStreetMap.
- **Architecture and contracts**
  - Document `corridors.geojson`, `flows.json`, `portfolio.json`, `model-metrics.json`, and `data-manifest.json`.
  - Add a compact Mermaid diagram showing preprocessing → model → simulation → static artifacts → React map.
- **Limitations**
  - Bike Share geographic and membership bias.
  - Seasonal one-month sample.
  - Inferred rather than GPS-observed paths.
  - Inconsistent counter timing and coverage.
  - No causal claim.
  - Engineering feasibility, road width, utilities, consultation, and approvals remain outside the MVP.
- **Development commands**
  - Retain the repository’s existing `npm install`, `npm run dev`, `npm run build`, and `npm run lint` workflow.

## Three-Person Git Workflow

Document three isolated workstreams:

| Owner | Branch | Owned files |
|---|---|---|
| Member A | `feature/data-model` | Data ingestion, census/Open Data transformations, feature engineering, model metrics and manifest |
| Member B | `feature/simulation-scoring` | Routing graph, agent simulation, candidates, scoring tiers, portfolio, generated app data |
| Member C | `feature/dashboard-demo` | React interface, map, animations, evidence cards, responsive design and deployment |

Rules:

- Each member uses a separate Git worktree and never switches, rebases, or pulls another member’s shared checkout.
- Freeze the v1 JSON/GeoJSON contracts and sample fixtures before parallel implementation.
- UI development consumes fixtures so it is not blocked by unfinished modelling.
- Root configuration, contracts, lockfiles, README, CI, and deployment files belong to the current integration captain.
- Stage explicit owned paths; never use `git add -A` during parallel work.
- Integrate small PRs every 60–90 minutes in this order: contracts/foundation → data/model → simulation/scoring → dashboard/integration.
- Rebase feature branches immediately after relevant merges.
- Require green checks and one independent review before squash-merging.
- Never push directly to `main`.

## Required Codex Protocol

Include an explicit reusable instruction block:

- Every implementation run must use bounded subagents with non-overlapping ownership on isolated worktrees or feature branches.
- After implementation, use an independent read-only review agent that did not author the change.
- Automatically apply valid review findings, rerun affected checks, commit fixes, push, and create or update the PR.
- Continue the implement–review–fix loop until checks pass and actionable findings are resolved.
- Automatically resolve only mechanical conflicts inside owned files.
- Regenerate lockfiles and generated artifacts from canonical inputs instead of manually merging them.
- Never use wholesale `ours`/`theirs`, `git reset --hard`, a protected-branch force push, or merge with red CI.
- Stop for human direction on semantic conflicts involving schemas, scoring definitions, model features, generated-data contracts, or destructive changes.
- Highlight every problem using:
  - `⚠️ Blocker` for work that cannot proceed.
  - `⚠️ Risk` for unresolved scientific or delivery uncertainty.
  - `⚠️ Deviation` when the requested workflow or scope could not be followed.
- Each warning must state the affected file or command, impact, attempted fix, and required next action.
- Never hide failed validation, fallback activation, unavailable data, stale artifacts, merge conflicts, deployment failures, or unimplemented scope.

README instructions are advisory when merely present in the repository. A later PR should mirror the operational section into `AGENTS.md` if automatic Codex enforcement is desired; that additional file is not part of this documentation-only change.

## Commit, PR, and Verification

- Clone `https://github.com/wajeeh-alam/VeloCity.git` into the workspace.
- Create `docs/hackathon-readme` from current `origin/main`.
- Replace only `README.md`.
- Run `git diff --check`, verify all source links, and ensure the README accurately labels planned versus implemented functionality.
- Use an independent review agent, apply findings automatically, and repeat validation.
- Commit as `docs: define VeloCity MVP and collaboration workflow`.
- Push the feature branch and open a PR titled `Document VeloCity hackathon MVP and team workflow`.
- PR description will include the product summary, three-person branch split, modelling limitations, validation performed, and any `⚠️` warnings.
- Do not merge the PR automatically; leave the final merge to the integration captain after teammate review.
