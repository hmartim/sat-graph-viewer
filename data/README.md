# SAT-Graph Viewer — Sample Datasets

This directory contains JSON datasets in the **SAT-Graph** format, used as input for the SAT-Graph Viewer. The viewer renders any valid SAT-Graph JSON, visualizing the version timeline, causal action graph, and validity intervals of legal items.

For the full model specification, see the API project: https://github.com/hmartim/sat-graph-api

## Key Concept: Overlaying vs. Superseding

- **Superseding** (Legislative model): a new statutory version terminates the old statutory version → only one statutory version is active at any time (`|V_valid| = 1` for the target text).
- **Overlaying** (Judicial model): a new interpretation coexists with the statutory text → the statutory version and one or more interpretive versions can be active simultaneously (`|V_valid| >= 2`).
- **Unification / overruling** (Case-law model): a later judicial action may terminate a previous interpretive version, but it does not terminate the underlying statutory version unless the court directly invalidates or reduces the text.

This is reflected through `Action.terminatesVersionIds`:

- Judicial interpretation: usually `[]` when it overlays the statutory text.
- Judicial overruling or unification: `[previous I-TV ID]`; it terminates prior interpretive versions, not the S-TV.
- Legislative amendment: `[previous S-TV ID]`; it terminates the prior statutory version and creates a new S-TV.

## Interval Semantics

Datasets use half-open intervals:

```text
start <= target_date < end
```

A `null` end means open-ended validity. Each terminated version's end equals the start of its successor, so intervals are contiguous with no gap or overlap.

## Datasets

- `001-point-in-time-retrieval.json`: purely legislative amendment chain for Art. 6 of the Brazilian Constitution.
- `CL001-hc-126292-presumption-of-innocence.json`: interpretive mutation of Art. 5, LVII through HC 126.292/SP and ADCs 43, 44, and 54.
- `CL002-adi-4983-vaquejada-dialogue.json`: constitutional dialogue involving ADI 4983, EC 96/2017, ADI 5728, and later animal-welfare safeguards.
- `CL003-ipi-credit-divergence.json`: real STJ jurisprudential split and unification on IPI credits under Law 9.779/1999, Art. 11.
- `CL004-donoghue-v-stevenson-duty-of-care.json`: common-law duty-of-care evolution from Donoghue to Robinson.

## License

Datasets are released under **CC0 1.0 Universal (Public Domain)**.
