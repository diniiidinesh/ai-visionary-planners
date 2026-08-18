import { chunkText, isHeadingLine, CHUNK_SIZE, CHUNK_OVERLAP } from './chunker.mjs';

// Content modeled on the user's real corpus (PM PRD-style docs, per the
// retrieval-debug screenshots: bullet lists, metrics, pricing tiers, tables).
const doc = `PM Knowledge Search Platform (MVP)

Prototype:- https://glean-for-pm.lovable.app/

Problem For PM in Knowledge base

Executive, sales, and customer-success feedback appear in Slack, emails, meeting notes, and isn't collated or attributed. Conflicting direction, missed commitments, or overlooked stakeholder asks.

Key user signals

Confusing onboarding flow (52 mentions)

Missing bulk export (41 mentions)

Slow dashboard load times (+40% vs. last month)

Pricing / GTM

Free beta (Months 1-3)

Pro $29/month

Team $49/user/month

Target $5K MRR by Month 6

Success metrics

recruit 50 beta users by Month 3, 60% weekly retention, 20+ searches/user/week, 80% relevance in top-3 results, and prove ~50%+ time savings. These are the launch assumptions we agreed on in the kickoff meeting, and they should be revisited once we have real usage data from the beta cohort rather than treated as fixed targets for the full year.

| Quarter | Revenue | Growth |
|---------|---------|--------|
| Q3      | $4.2M   | 14%    |
| Q4      | $4.8M   | 16%    |
`;

const chunks = chunkText(doc);

console.log('=== CHUNKS:', chunks.length, '===\n');
for (const c of chunks) {
  console.log(`--- chunk ${c.index} | len=${c.content.length} | heading=${JSON.stringify(c.heading)}`);
  console.log(c.content.replace(/\n/g, '\\n').slice(0, 260));
  console.log();
}

console.log('=== isHeadingLine misfire check ===');
const probes = [
  'Problem Statement',                       // true heading
  '## Pricing',                              // true heading
  'Confusing onboarding flow (52 mentions)', // bullet/data line
  'Missing bulk export (41 mentions)',       // bullet/data line
  'Pro $29/month',                           // pricing datum
  'Target $5K MRR by Month 6',               // metric datum
  'Q3      | $4.2M   | 14%',                 // table row w/o pipes at edges
  'recruit 50 beta users by Month 3',        // lowercase start
];
for (const p of probes) {
  console.log(String(isHeadingLine(p)).padEnd(6), JSON.stringify(p));
}

console.log('\n=== size distribution ===');
const lens = chunks.map(c => c.content.length);
console.log('min', Math.min(...lens), 'max', Math.max(...lens), 'over CHUNK_SIZE:', lens.filter(l => l > CHUNK_SIZE).length);
