# Roadmap

Where the engine is going, at the level of intent rather than tickets. Nothing
here is a promise with a date on it.

## Being worked on

**Fewer bespoke pages.** Several page types still have hand-shaped rendering that
predates the shared view modules. Folding them onto the common helpers cuts the
generator down and makes the next new page type cheap instead of expensive.

**Translation coverage without translation risk.** The prose overlay currently
covers the pages that carry the most text. Extending it means extending the
checks that sit in front of it — numeric fidelity, markup safety, and detection
of output that quietly stayed in English — because an overlay that can be wrong
silently is worse than one that is missing.

**A leaner first paint.** The baked pages are small, but the largest of them still
ship markup that only a fraction of readers will scroll to. Splitting those along
the same lines the client already enhances would take the heaviest routes down
noticeably.

## Wanted, not yet started

**A second tournament.** Every shape in `data/` is specific to a 48-team, 104-match
format. Making the generator read the tournament structure as data rather than
assuming it would let the same engine render an entirely different competition —
and would flush out the places where the format is baked into code that ought to
be reading it.

**An offline build path.** The ingest scripts need the network; the generator does
not. Making that split explicit, with a checked-in fixture set the generator can
be exercised against, would let someone try the engine end to end without touching
an upstream source.

**Accessibility beyond the audit floor.** Contrast, focus order, and reduced-motion
handling are in place. Screen-reader narration of the bracket and the live score
updates is not yet as good as the visual presentation, and that gap is the next
one worth closing.

## Deliberately not planned

- A framework rewrite. The absence of a dependency tree is the feature.
- A plugin or theme system. There is one site; generality would cost more than it earns.
- Any runtime that has to be operated. Output stays a folder of files.
- User accounts, tracking, or advertising of any kind.

## Contributing

Issues and pull requests are welcome, particularly around correctness of the
datasets and their sources. Please keep changes dependency-free and run
`node --test test/` before opening a request.
