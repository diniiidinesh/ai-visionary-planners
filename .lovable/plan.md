# Reconcile Live run and Embedding A/B stages

## Goal
Make the route decision visible as the shared first layer, then use one consistent lookup pipeline in both Live run and the Embedding A/B lab.

## Changes
- Show the query planner’s route filter clearly: every question is classified as either `corpus_overview` or `lookup` before embedding retrieval starts.
- Clarify that Live run follows either the catalog branch or embedding branch, while the A/B lab deliberately forces `lookup` so both embedding spaces can be compared.
- Standardize the lookup sequence and labels in both sections: understand/classify, standalone query, query embedding, semantic search, keyword search, RRF fusion, reranking/capping, prompt excerpts, and generated answer.
- Rebuild each OpenAI/Voyage result column with the same expandable stage rows and status visuals used by Live run.
- Keep the existing conversation history, side-by-side agreement measure, timing/model indicators, and separate histories for each embedding space.

## Validation
- Confirm the page builds without errors.
- Check desktop and mobile layouts for readable aligned stages and no overlap.
- Verify the A/B request still forces `lookup` and each model receives its own follow-up history.
