# Offset drag for single multi-piece groups — design

**Date:** 2026-07-03
**Status:** Approved

## Problem

The "offset drag" setting shifts the grabbed piece 50 screen px upward at
drag start so the user's finger doesn't block the view on touch devices.
Today it only applies when the dragged group contains exactly one piece.
Dragging a single multi-piece group gets no offset, even though the
finger-occlusion problem is the same.

## Desired behavior

Offset drag applies whenever **exactly one group** is being moved,
regardless of how many pieces that group contains:

- Single 1-piece group → offset applies (unchanged).
- Single multi-piece group → offset applies (**new**).
- Multi-select drag moving 2+ groups → no offset (unchanged).
- Multi-select tool active but only one group selected → offset applies
  (unchanged, now regardless of piece count).

The offset stays a fixed 50 screen px upward (`OFFSET_DRAG_SCREEN_PX`),
applied once at drag promote, converted to world space, never reversed on
drop. A configurable offset distance, or gating on the group's on-screen
size, may become settings later; both are explicitly out of scope here.

## Change

All in `src/interaction/setup-interaction.ts`:

- `applyOffsetDragIfSinglePiece` → rename to
  `applyOffsetDragIfSingleGroup` (update its one call site).
- Delete the `group.pieces.size !== 1` guard. Keep the
  `expandToSelection(groupId).length > 1` guard (multi-select exclusion),
  the missing-group guard, and the preference check.

Text corrections (repo convention: help text must stay correct):

- `src/ui/info-modal.ts` offset-drag description: "Shift single pieces
  upward when dragging, so your finger doesn't block the view." →
  "Shift the dragged piece or group upward, so your finger doesn't block
  the view."
- `src/ui/offset-drag.ts` header comment: same correction ("single
  pieces" → the dragged piece or group).

## Testing

In the existing `offset drag` describe block of
`src/interaction/setup-interaction.test.ts`:

- Keep: "does NOT apply when dragging a multi-selection".
- Keep: "still applies when the multi-select tool has only one group
  selected".
- Add: "applies when dragging a single multi-piece group" — a group with
  2+ pieces, no selection manager involvement needed; drag past the
  promote threshold and expect the group's `position.y` to be `-50`.

## Error handling

Nothing new. Existing guards (group not found, preference disabled)
are untouched.

## Out of scope

- Configurable offset distance setting.
- Gating on the group's on-screen size/side.
- Any change to drop/merge behavior or to when the offset is applied.
