# Offset Drag for Single Multi-Piece Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the offset-drag setting apply whenever exactly one group is dragged — regardless of piece count — while still excluding multi-select drags of 2+ groups.

**Architecture:** The entire behavior gates on one private function in `src/interaction/setup-interaction.ts` (`applyOffsetDragIfSinglePiece`). We delete its piece-count guard and rename it to match the new semantics. Help text in the info modal and the doc comment in `src/ui/offset-drag.ts` are corrected so they don't describe the old behavior.

**Tech Stack:** TypeScript, Vite app, Vitest (jsdom) for tests.

**Spec:** `docs/superpowers/specs/2026-07-03-offset-drag-multi-piece-group-design.md`

## Global Constraints

- Offset stays a fixed 50 screen px upward (`OFFSET_DRAG_SCREEN_PX = 50`), applied once at drag promote, converted to world space via `deltaToWorld`, never reversed on drop.
- Multi-select drags moving 2+ groups get no offset (the `expandToSelection(groupId).length > 1` guard stays).
- No new settings (configurable distance / on-screen-size gating are explicitly out of scope).
- Code in American English; conventional commit messages.
- Test files live next to the source they test — all test changes go in the existing `src/interaction/setup-interaction.test.ts`.

---

### Task 1: Relax the offset-drag guard to single-group semantics (TDD)

**Files:**
- Modify: `src/interaction/setup-interaction.ts:125-133` (guard function) and `src/interaction/setup-interaction.ts:177` (call site)
- Test: `src/interaction/setup-interaction.test.ts` (existing `describe('offset drag', …)` block, lines 491–555)

**Interfaces:**
- Consumes: existing test helpers in the same file — `makeGroup(id, pieceIds, position)`, `makeState(groups)`, `createFakeContainer()`, `createFakeRenderer()`, `fakePointerEvent(overrides)`; `loadOffsetDragPreference` is already `vi.mock`ed at the top of the file.
- Produces: renamed private function `applyOffsetDragIfSingleGroup(groupId: number): void` inside `setupInteraction` (not exported; Task 2 does not depend on it).

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('offset drag', () => { … })` block in `src/interaction/setup-interaction.test.ts`, after the `'still applies when the multi-select tool has only one group selected'` test:

```ts
        it('applies when dragging a single multi-piece group', () => {
            vi.mocked(loadOffsetDragPreference).mockReturnValue(true);
            const container = createFakeContainer();
            const renderer = createFakeRenderer();

            // One group with two pieces, no multi-select involved. Exactly
            // one group moves, so the offset applies despite the piece count.
            const group7 = makeGroup(7, [3, 4], { x: 0, y: 0 });
            const state = makeState([group7]);

            setupInteraction({
                container: container as unknown as HTMLElement,
                renderer,
                viewportTransform: new ViewportTransform(),
                getState: () => state,
                onStateChanged: vi.fn(),
                onDrop: vi.fn(),
                onViewportChanged: vi.fn(),
            });

            const pieceTarget = { _pieceId: 3 };
            container.fire('pointerdown', fakePointerEvent({ target: pieceTarget as unknown as EventTarget, pointerId: 1, clientX: 100, clientY: 100 }));
            container.fire('pointermove', fakePointerEvent({ pointerId: 1, clientX: 120, clientY: 100 })); // promote

            // OFFSET_DRAG_SCREEN_PX = 50, shifted upward (negative Y).
            expect(group7.position.y).toBe(-50);
        });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/interaction/setup-interaction.test.ts -t "applies when dragging a single multi-piece group"`
Expected: FAIL with `expected 0 to be -50` (the current `group.pieces.size !== 1` guard returns early for the 2-piece group, so no offset is applied).

- [ ] **Step 3: Implement — delete the piece-count guard and rename**

In `src/interaction/setup-interaction.ts`, replace the guard function (currently lines 125–133):

```ts
    function applyOffsetDragIfSingleGroup(groupId: number): void {
        const group = tryGetGroup(getState(), groupId);
        if (!group) return;
        if (expandToSelection(groupId).length > 1) return;
        if (!loadOffsetDragPreference()) return;
        const offset = deltaToWorld({ x: 0, y: -OFFSET_DRAG_SCREEN_PX });
        moveGroup(group, offset);
        onStateChanged();
    }
```

(The old body had `if (!group || group.pieces.size !== 1) return;` — the piece-count check is the part being removed; the missing-group, multi-select, and preference guards all stay.)

Update the single call site (currently line 177, inside `onPieceDrag.start`):

```ts
                applyOffsetDragIfSingleGroup(drag.groupId);
```

Also fix the now-stale wording in the existing test comment at `src/interaction/setup-interaction.test.ts:499-501` — change:

```ts
            // Two single-piece groups, both selected. Dragging group 7 also
            // moves group 8, so this is not a single-piece drag and the
            // offset must not be applied.
```

to:

```ts
            // Two single-piece groups, both selected. Dragging group 7 also
            // moves group 8, so more than one group moves and the offset
            // must not be applied.
```

- [ ] **Step 4: Run the offset-drag tests and verify all pass**

Run: `npx vitest run src/interaction/setup-interaction.test.ts`
Expected: PASS — the new test plus the two existing offset-drag tests (`does NOT apply when dragging a multi-selection`, `still applies when the multi-select tool has only one group selected`) and the rest of the file, 0 failures.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, 0 failures (the change is local to `setupInteraction`; nothing else consumes the renamed private function).

- [ ] **Step 6: Commit**

```bash
git add src/interaction/setup-interaction.ts src/interaction/setup-interaction.test.ts
git commit -m "feat(interaction): apply offset drag to single multi-piece groups

Offset drag now triggers whenever exactly one group moves, regardless
of its piece count. Multi-select drags of 2+ groups remain excluded."
```

---

### Task 2: Correct the help text and doc comment

**Files:**
- Modify: `src/ui/info-modal.ts:413-414` (offset-drag setting description)
- Modify: `src/ui/offset-drag.ts:1-8` (module doc comment)

**Interfaces:**
- Consumes: nothing from Task 1 (text-only; can be reviewed independently).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Update the info-modal description**

In `src/ui/info-modal.ts`, inside `buildOffsetDragSetting()`, change:

```ts
    desc.textContent =
        "Shift single pieces upward when dragging, so your finger doesn't block the view.";
```

to:

```ts
    desc.textContent =
        "Shift the dragged piece or group upward, so your finger doesn't block the view.";
```

- [ ] **Step 2: Update the offset-drag module doc comment**

In `src/ui/offset-drag.ts`, change the header comment:

```ts
/**
 * Offset drag setting — persistence and defaults.
 *
 * When enabled, single pieces are shifted upward on drag start
 * so the user's finger doesn't block the view on touch devices.
 *
 * Disabled by default. Users can enable it in the info modal.
 */
```

to:

```ts
/**
 * Offset drag setting — persistence and defaults.
 *
 * When enabled, the dragged piece or group is shifted upward on drag
 * start so the user's finger doesn't block the view on touch devices.
 * Only applies when a single group moves — multi-select drags of
 * several groups are excluded.
 *
 * Disabled by default. Users can enable it in the info modal.
 */
```

- [ ] **Step 3: Run the test suite to confirm nothing depended on the copy**

Run: `npx vitest run`
Expected: PASS, 0 failures (no test asserts on this description string; this run is the verification).

- [ ] **Step 4: Commit**

```bash
git add src/ui/info-modal.ts src/ui/offset-drag.ts
git commit -m "docs(ui): update offset drag copy for multi-piece groups"
```
