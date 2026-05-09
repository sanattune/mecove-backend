# L1 canonicalizer stays pure; L2 partitions

**Context.** The redesigned SessionBridge needs three distinct repetition-based sections: Observed Themes (topical), Signals Worth Attention (internal states), Moments of Variation (positive-affect). The L1 canonicalizer currently emits a single mixed `repeatCandidates` array and a flat `explicitEmotions` list per day. A reasonable alternative would be to extend L1 with `topicalRepeats` / `stateRepeats` and per-day positive-affect labels, so L2 has less work to do.

**Decision.** Keep L1 pure (extraction only) and let each L2 stage partition. SessionBridge's L2 prompt classifies repeats topical vs internal-state, and selects positive-affect emotions for Moments of Variation. L1's "no interpretation" guarantee is the contract that lets us trust the canonical layer; tagging valence or splitting topical-vs-state is interpretation, even when it looks mechanical.

**Consequences.** L2 prompts are heavier — they carry the partition logic. L1 schema is stable across both report types and reusable for future reports without re-categorising. If a third report ever needs the same topical/internal split, the partition logic should be hoisted to a shared helper (prompt fragment or post-L1 stage), not pushed into L1.
