# Desktop canvas performance — 2026-09-25

Panning subscribed the entire canvas to viewport coordinates. Zooming and moving
nodes also measured every card with `getBoundingClientRect` in a layout effect,
then rendered again to update relationship bounds. The persistence debounce
delayed localStorage writes but still projected and serialized every saved board
on each store action.

## Changes

- Isolated the grid and world transform into a viewport subscriber. Event handlers
  read current viewport coordinates directly for placement and cursor-anchored zoom.
- Memoized cards and applied zoom readability through inherited CSS variables.
  Panning and zooming no longer render card components; edits and movement render
  only changed cards.
- Calculated card bounds from explicit dimensions and the CSS transform origin.
  Edges and marquee selection no longer need per-card DOM measurements.
- Batched pointer samples per animation frame, flushing the final sample on
  release or blur and cancelling gestures when switching boards.
- Moved projection and JSON serialization inside the persistence debounce, with
  a 900 ms maximum scheduling delay and the existing lifecycle flushes.
- Preserved order and selection references when upserting existing cards and used
  sets for linear-time selection/order deduplication.
- Removed a conflicting `relative` class from absolutely positioned cards.
  Chrome confirmed it was adding a normal-flow vertical offset to each later
  card, causing neighbors to shift when a card was created or deleted.

## Browser comparison

Compared HEAD `00ed05184` with the changed canvas in headless Chrome, using the
same Vite development server and 300 chat cards arranged in a 20-column grid.
The fixture had no relationship edges or active messages. Each operation ran 60
times, once per animation frame, with `flushSync` around the store action.
Times below measure synchronous JavaScript/React updates, including forced
layout when requested by the code. They exclude deferred paint/compositing and
are not desktop FPS measurements. GPU acceleration was disabled.

| Operation | Before median / p95 | After median / p95 |
| --- | --- | --- |
| Pan | 6.9 / 11.9 ms | 0.6 / 0.8 ms |
| Zoom through 0.55–0.786 | 27.8 / 41.5 ms | 2.9 / 6.3 ms |
| Move one card | 14.4 / 21.2 ms | 3.6 / 5.3 ms |

Across the 60 updates, card render counts fell from 18,000 to zero for pan,
36,000 to zero for zoom, and 36,000 to 60 for movement. Per-card layout reads
fell from 18,000 to zero for both zoom and movement.

A separate Chrome check compared all 300 actual card rectangles against the
calculated bounds at scales 0.5, 0.786, 1, and 2. Maximum error was below 0.001 px.
Label sizes and padding followed zoom readability, and removing the first card
caused zero displacement of the next card.

## Validation

The focused canvas/geometry suite passes 44 tests, including the new 100-card
render/interaction regression, persistence scheduling, and stable upserts.
Typechecking, the production build, and generated CSS checks pass.

The full hub suite has 1,790 passing tests and 25 failures. An untouched detached
checkout of `00ed05184` has the same 25 failures, with identical failure names
(1,786 passing tests). No additional full-suite failures remain.
