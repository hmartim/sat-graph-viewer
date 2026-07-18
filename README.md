# SAT-Graph Viewer

A browser-based visualizer for **SAT-Graph** JSON datasets. Renders the version timeline, causal action graph, and validity intervals of legal items encoded in the SAT-Graph format.

For the full model specification, see the API project: https://github.com/hmartim/sat-graph-api

## Usage

Open `index.html` in a browser and load any SAT-Graph JSON file from the `data/` directory.

## License

Released under **CC0 1.0 Universal (Public Domain)**.

## Temporal contract & testing

- **Query instant (`at`)**: an RFC 3339 timestamp with an explicit offset (`Z` or `±hh:mm`). Offset-less date-times are rejected — ECMAScript parses them as local time, which would make resolution environment-dependent. `YYYY-MM-DD` is accepted as shorthand for `T00:00:00Z`; this normalization is a convention of this corpus, whose interval boundaries are normalized to UTC-day precision, not a claim that legal effectiveness universally begins at UTC midnight.
- **Intervals** are half-open `[start, end)`. A Version and its directly superseding successor are never simultaneously active at the transition instant; concurrent Versions remain possible where the graph explicitly represents overlays (S-TV + I-TV) or interpretive branches (e.g. the panel divergence in CL003).
- **Ordering**: `getValidVersions` returns a set (order is not part of the contract); `getItemHistory` is ordered by `(eventTime, id)`.
- **Tests**: `python3 validate.py data/` checks corpus structure, referential integrity, interval well-formedness and fixtures; `node test_engine.js data/` exercises `engine.js` — the same file `index.html` loads — with the fixtures plus automatic boundary probes at every transition (exact instant, ±1s/1ms, equivalent offset representations).
