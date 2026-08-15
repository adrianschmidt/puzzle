# Move `unsplash-display-image` from `app/` to `images/`

Closes #509.

## Problem

`src/ui/` and `src/app/` import each other. `ui` is a lower layer than `app`
(`app` composes `ui`, not the reverse), so the three upward imports are a
layering inversion and, together with the many downward `app → ui` imports,
form a module-group cycle. All three upward imports point at one file,
`src/app/unsplash-display-image.ts`:

- `src/ui/image-picker.ts` — `CANDIDATE_COUNT`, `CandidateImage`
- `src/ui/new-game-dialog.ts` — `CandidateImage`
- `src/ui/image-picker.test.ts` — `CandidateImage`

The inversion predates #505; the cycle is inert today but should be removed
before anything else in `ui/` starts reaching upward.

## Approach

Move the whole file `src/app/unsplash-display-image.ts` (and its test) into
`src/images/`, and re-export its public symbols from `src/images/index.ts`.

The file is "Unsplash-result → display-model mapping" and already depends only
on `../images/` (`UnsplashImageResult`), which is a clean leaf layer. Its four
public symbols travel together because `CandidateImage extends DisplayImage` —
splitting them would only relocate the inversion (a moved `CandidateImage`
would have to import `DisplayImage` back up from `app/`).

After the move every dependency is one-way and downward: `ui → images` and
`app → images`. The cycle is gone.

`model/` was rejected as a destination: it is puzzle-geometry, and these are
Unsplash display types that need `UnsplashImageResult`, so it would manufacture
a `model → images` dependency for no semantic gain.

## Changes

1. `git mv src/app/unsplash-display-image.ts src/images/unsplash-display-image.ts`
   and the same for its `.test.ts`.
2. In the moved file, change the `UnsplashImageResult` import from
   `../images/index.js` to `./unsplash.js` (same-layer, direct — avoids a
   within-layer barrel cycle).
3. In `src/images/index.ts`, re-export `DisplayImage`, `CandidateImage`,
   `CANDIDATE_COUNT`, `toDisplayImage` from `./unsplash-display-image.js`.
4. Repoint importers:
   - `ui/`: `image-picker.ts`, `new-game-dialog.ts`, `image-picker.test.ts` →
     `../images/index.js`.
   - `app/`: `resolve-image.ts`, `fetch-candidate-images.ts`,
     `start-new-game.ts`, `new-game-payload.ts` → `../images/index.js`,
     merging into each file's existing `../images/index.js` import line where
     one exists.

## Verification

No behavior change. `tsc`, `oxlint`, and the existing `unsplash-display-image`,
`image-picker`, `resolve-image`, `fetch-candidate-images`, and
`start-new-game` tests must stay green. Grep confirms zero remaining imports of
`app/unsplash-display-image` and zero `ui/*` imports from `../app/`.
