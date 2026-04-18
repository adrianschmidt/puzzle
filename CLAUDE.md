# Repo conventions for Claude

## Keep the in-app help text in sync with features

The info modal (`src/ui/info-modal.ts`) is the only in-app place where the
player learns how the app works — there is no separate README shown in the
UI. When you add, remove, or change a user-visible feature, update the
modal's **How to Play**, **Cut Styles**, and/or **Settings** sections in the
same PR so the help text stays accurate.

Triggers for a help-text update include:

- New or removed toolbar button (icon + what it does).
- New or changed interaction (gesture, keyboard shortcut, drag behaviour).
- New cut style, or a new option on an existing cut style (e.g. a checkbox
  in the new-game dialog).
- New or renamed setting in the info modal itself.
- Behaviour change that a returning player would need to be told about
  (e.g. multi-select now being on by default for rotation puzzles).

If the change is purely internal (refactor, perf, bug fix with no visible
behaviour change), no help-text update is needed.
