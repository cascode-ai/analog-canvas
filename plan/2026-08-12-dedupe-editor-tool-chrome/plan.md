---
status: completed
experience: none
---

# Deduplicate editor tool chrome

## Goal

Remove duplicated drawing tools from the top toolbar so each action has one
primary chrome home: left rail for draw tools, top strip for edit actions,
Shapes for quick-place, Draw menu for secondary/e2e access.

## Work

1. Removed Insert/Wire/Text/Arrow/Line/Rect from the top toolbar row.
2. Kept hierarchy nav + Undo/Redo/Delete/Rotate on top.
3. Left tool rail + Draw menu + Shapes quick-place unchanged as intentional
   layered access (rail primary, menu secondary, shapes for components).
4. Updated interaction contract to v1.9 and help copy.

## Validation

- App Vitest 11/11
- Playwright e2e 73/73
- Prettier + `git diff --check`

## Outcome

Drawing tools no longer appear twice in the main chrome. Top strip is edit-only;
left rail is the primary Draw home.
