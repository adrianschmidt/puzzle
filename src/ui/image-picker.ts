/**
 * Image picker — the start group of the new-game dialog. Shows four
 * candidate photos (tap one to start a game with it), a refresh control
 * that swaps the candidates, and Surprise me / Blank puzzle actions.
 *
 * Unlike the other dialog sections, this one is the game-start trigger:
 * every tile and action button fires `onPick`, and the dialog dismisses
 * itself in response. There is no selected state.
 */

/** A candidate photo the player can pick, pre-scaled for the puzzle. */
export interface CandidateImage {
    /** Full-quality URL used as the puzzle image (Unsplash `regular`). */
    imageUrl: string;
    /** Small URL hotlinked as the grid thumbnail (Unsplash `small`). */
    thumbUrl: string;
    /** Display size of the puzzle image (1080px wide, aspect-scaled). */
    imageSize: { width: number; height: number };
    attribution: {
        photographerName: string;
        photographerUrl: string;
        photoUrl: string;
    };
    /** Unsplash download-reporting endpoint, triggered when the game starts. */
    downloadLocation: string;
    /** Alt text, when Unsplash provides one. */
    description?: string;
}

/** What the player clicked to start the game. */
export type NewGameImageChoice =
    | { kind: 'photo'; photo: CandidateImage }
    | { kind: 'surprise' }
    | { kind: 'blank' };

export interface ImagePickerOptions {
    /**
     * Fetch a fresh candidate set. Absent when no Unsplash access key is
     * configured — the grid and refresh button are then hidden and only
     * Surprise me / Blank puzzle remain.
     */
    fetchCandidates?: () => Promise<CandidateImage[] | null>;
    /** Called when the player picks a photo, surprise, or blank. */
    onPick: (choice: NewGameImageChoice) => void;
}

export interface ImagePicker {
    element: HTMLElement;
    /** Re-fetch the candidate set (used when category/vibrant change). */
    refresh(): void;
}

/** Number of candidate photos requested and displayed. */
export const CANDIDATE_COUNT = 4;

export function createImagePicker(options: ImagePickerOptions): ImagePicker {
    const section = document.createElement('div');
    section.className = 'image-picker';

    const header = document.createElement('div');
    header.className = 'image-picker-header';

    const heading = document.createElement('h3');
    heading.className = 'size-picker-subtitle';
    heading.textContent = 'Pick an image to start';
    header.appendChild(heading);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'image-picker-refresh';
    refreshButton.dataset.testid = 'image-picker-refresh';
    refreshButton.title = 'Show different images';
    refreshButton.setAttribute('aria-label', 'Show different images');
    refreshButton.textContent = '↻';
    refreshButton.addEventListener('click', () => refresh());
    header.appendChild(refreshButton);

    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'image-picker-grid';
    const tiles: HTMLButtonElement[] = [];
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'image-picker-tile';
        tile.dataset.testid = 'image-picker-tile';
        tile.disabled = true;
        tiles.push(tile);
        grid.appendChild(tile);
    }
    section.appendChild(grid);

    const error = document.createElement('p');
    error.className = 'image-picker-error';
    error.textContent = "Couldn't load images — tap ↻ to try again.";
    error.hidden = true;
    section.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'image-picker-actions';

    const surpriseButton = document.createElement('button');
    surpriseButton.type = 'button';
    surpriseButton.className = 'image-picker-action';
    surpriseButton.dataset.testid = 'image-picker-surprise';
    surpriseButton.textContent = '🎲 Surprise me';
    surpriseButton.addEventListener('click', () => options.onPick({ kind: 'surprise' }));
    actions.appendChild(surpriseButton);

    const blankButton = document.createElement('button');
    blankButton.type = 'button';
    blankButton.className = 'image-picker-action';
    blankButton.dataset.testid = 'image-picker-blank';
    blankButton.textContent = 'Blank puzzle';
    blankButton.addEventListener('click', () => options.onPick({ kind: 'blank' }));
    actions.appendChild(blankButton);

    section.appendChild(actions);

    // Stale-response guard: each refresh bumps the token, and only the
    // newest in-flight fetch may apply its result. A slow response from a
    // superseded fetch (earlier category, earlier refresh) is dropped.
    let fetchToken = 0;

    function setLoading(): void {
        error.hidden = true;
        for (const tile of tiles) {
            tile.replaceChildren();
            tile.hidden = false;
            tile.disabled = true;
            tile.classList.add('image-picker-tile--loading');
        }
    }

    function showCandidates(candidates: CandidateImage[]): void {
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i];
            const candidate = candidates[i];
            tile.replaceChildren();
            tile.classList.remove('image-picker-tile--loading');

            // Unsplash may return fewer photos than requested for narrow
            // queries; hide the tiles that have nothing to show.
            if (!candidate) {
                tile.hidden = true;
                tile.disabled = true;
                continue;
            }

            tile.hidden = false;
            tile.disabled = false;

            const img = document.createElement('img');
            img.className = 'image-picker-thumb';
            img.src = candidate.thumbUrl;
            img.alt = candidate.description ?? 'Puzzle image';
            img.draggable = false;
            tile.appendChild(img);

            // Property assignment (not addEventListener) so each refresh
            // replaces the previous candidate's handler.
            tile.onclick = () => options.onPick({ kind: 'photo', photo: candidate });
        }
    }

    function showError(): void {
        error.hidden = false;
        for (const tile of tiles) {
            tile.replaceChildren();
            tile.classList.remove('image-picker-tile--loading');
            tile.disabled = true;
        }
    }

    function refresh(): void {
        const fetchCandidates = options.fetchCandidates;
        if (!fetchCandidates) return;

        const token = ++fetchToken;
        setLoading();
        fetchCandidates().then(
            (candidates) => {
                if (token !== fetchToken) return;
                if (!candidates || candidates.length === 0) {
                    showError();
                    return;
                }
                showCandidates(candidates);
            },
            () => {
                if (token === fetchToken) showError();
            },
        );
    }

    if (options.fetchCandidates) {
        refresh();
    } else {
        grid.hidden = true;
        refreshButton.hidden = true;
    }

    return { element: section, refresh };
}
