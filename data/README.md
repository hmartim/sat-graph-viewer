# SAT-Graph Viewer — Sample Datasets

This directory contains JSON datasets in the **SAT-Graph** format, used as input for the SAT-Graph Viewer. The viewer renders any valid SAT-Graph JSON, visualizing the version timeline, causal action graph, and validity intervals of legal items.

For the full model specification, see the API project: https://github.com/hmartim/sat-graph-api

## Key Concept: Overlaying vs. Superseding

- **Superseding** (Legislative model): New version TERMINATES old version → only 1 version active at any time (`|V_valid| = 1`)
- **Overlaying** (Judicial model): New interpretation COEXISTS with statutory text → both versions active simultaneously (`|V_valid| = 2`)

This is reflected through `Action.terminatesVersionIds`:

- Judicial Interpretation: `[]` (doesn't terminate S-TV)
- Judicial Overruling: `[previous I-TV ID]` (terminates previous I-TV, not S-TV)
- Legislative Amendment: `[previous S-TV ID]` (terminates previous S-TV)

## License

Datasets are released under **CC0 1.0 Universal (Public Domain)**.
