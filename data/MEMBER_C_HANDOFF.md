# Member C handoff

Load `public/data/corridor-opportunities.json`. It is the joined, display-ready contract; no client-side join or score calculation is required.

## Required presentation rules

- Show `evidence.status` as **Trained demand evidence**.
- Show `comparison.status` as **Illustrative scenario**, never as a model forecast.
- Display `evidence.prediction` with its uncertainty interval and the observation dates.
- Display `comparison.warnings` beside before/after values, not only in an About screen.
- Draw `record.geometry` only for the route whose `geometryRef` is `record.geometry`. A null existing-condition reference means no route was generated.
- Use `priority.rolloutYear` as illustrative Year 1–3 placement and show `portfolio.disclaimer`.
- Use `representativeAgents[].weight`; one dot is not one cyclist.
- Do not rename `dangerousSegments` as crashes prevented. It is an illustrative high-stress segment count.
- Use `scenarioModel.metricDefinitions` for labels, units and improvement direction.

The browser helper is `src/data/opportunities.ts`:

```ts
import { loadOpportunityArtifact } from './data/opportunities'

const artifact = await loadOpportunityArtifact()
```

The authoritative schema is `data/contracts/corridor-opportunities.v1.schema.json`. Run `npm run handoff:check` before merging the dashboard.
