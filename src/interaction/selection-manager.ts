/**
 * Selection manager — tracks which PieceGroups the user has selected
 * via the multi-select tool.
 *
 * "Selection" here is a user-created grouping for batch movement,
 * completely separate from PieceGroup (which represents physically
 * connected/merged pieces). The user taps individual pieces to add
 * their PieceGroup to the selection, then drags any selected piece
 * to move all selected groups together.
 */

export type SelectionChangeCallback = (selectedGroupIds: ReadonlySet<number>) => void;
export type ToolActiveChangeCallback = (toolActive: boolean) => void;

export class SelectionManager {
    private selected = new Set<number>();
    private listeners: SelectionChangeCallback[] = [];
    private toolActiveListeners: ToolActiveChangeCallback[] = [];

    /** Whether the multi-select tool is currently active. */
    private _toolActive = false;

    /** Whether the marquee (drag-box) gesture is currently armed. */
    private _marqueeActive = false;
    private marqueeActiveListeners: ToolActiveChangeCallback[] = [];

    get toolActive(): boolean {
        return this._toolActive;
    }

    set toolActive(active: boolean) {
        if (this._toolActive === active) return;
        this._toolActive = active;
        if (!active) {
            this.clearAll();
            // Invariant: the marquee can only be armed while the multi-select
            // tool is on (a marquee builds a multi-select selection). Turning
            // the tool off therefore disarms the marquee too.
            this.setMarqueeActive(false);
        }
        for (const listener of this.toolActiveListeners) {
            listener(active);
        }
    }

    /** Toggle the tool on/off. Returns the new state. */
    toggleTool(): boolean {
        this.toolActive = !this._toolActive;
        return this._toolActive;
    }

    /** Register a listener for tool-active changes. */
    onToolActiveChange(callback: ToolActiveChangeCallback): () => void {
        this.toolActiveListeners.push(callback);
        return () => {
            const idx = this.toolActiveListeners.indexOf(callback);
            if (idx >= 0) this.toolActiveListeners.splice(idx, 1);
        };
    }

    /** Whether the marquee gesture is currently armed. */
    get marqueeActive(): boolean {
        return this._marqueeActive;
    }

    /**
     * Toggle the marquee gesture on/off. Returns the new state.
     *
     * Enabling the marquee also enables the multi-select tool — a marquee
     * can only build a selection while the tool is on (the invariant
     * "marquee implies tool"). Disabling the marquee leaves the current
     * selection intact; only the gesture is turned off.
     */
    toggleMarquee(): boolean {
        if (this._marqueeActive) {
            this.setMarqueeActive(false);
        } else {
            this.toolActive = true; // invariant: marquee implies tool
            this.setMarqueeActive(true);
        }
        return this._marqueeActive;
    }

    /** Register a listener for marquee-active changes. */
    onMarqueeActiveChange(callback: ToolActiveChangeCallback): () => void {
        this.marqueeActiveListeners.push(callback);
        return () => {
            const idx = this.marqueeActiveListeners.indexOf(callback);
            if (idx >= 0) this.marqueeActiveListeners.splice(idx, 1);
        };
    }

    private setMarqueeActive(active: boolean): void {
        if (this._marqueeActive === active) return;
        this._marqueeActive = active;
        for (const listener of this.marqueeActiveListeners) {
            listener(active);
        }
    }

    /** The set of currently selected group IDs. */
    get selectedGroupIds(): ReadonlySet<number> {
        return this.selected;
    }

    /** Whether a specific group is selected. */
    isSelected(groupId: number): boolean {
        return this.selected.has(groupId);
    }

    /** Toggle selection of a group. Returns true if now selected. */
    toggle(groupId: number): boolean {
        if (this.selected.has(groupId)) {
            this.selected.delete(groupId);
            this.notify();
            return false;
        } else {
            this.selected.add(groupId);
            this.notify();
            return true;
        }
    }

    /** Select a group (no-op if already selected). */
    select(groupId: number): void {
        if (!this.selected.has(groupId)) {
            this.selected.add(groupId);
            this.notify();
        }
    }

    /** Deselect a group (no-op if not selected). */
    deselect(groupId: number): void {
        if (this.selected.has(groupId)) {
            this.selected.delete(groupId);
            this.notify();
        }
    }

    /** Clear the entire selection. */
    clearAll(): void {
        if (this.selected.size > 0) {
            this.selected.clear();
            this.notify();
        }
    }

    /** Whether anything is selected. */
    get hasSelection(): boolean {
        return this.selected.size > 0;
    }

    /**
     * Expand a single group ID to all selected IDs when the multi-select
     * tool is active and the given ID is part of the selection; otherwise
     * return just `[id]`. Used by drag handlers to fan out a single-group
     * operation to every selected group. The given `id` is always first.
     */
    expandToSelectionIfActive(id: number): readonly number[] {
        if (!this._toolActive || !this.selected.has(id)) return [id];
        const others = [...this.selected].filter((other) => other !== id);
        return [id, ...others];
    }

    /**
     * Update selection after a merge: oldGroupId was absorbed into newGroupId.
     * If the old group was selected, the new group inherits the selection.
     */
    handleMerge(oldGroupId: number, newGroupId: number): void {
        if (this.selected.has(oldGroupId)) {
            this.selected.delete(oldGroupId);
            this.selected.add(newGroupId);
            this.notify();
        }
    }

    /**
     * Remove any group IDs from the selection that no longer exist in the game.
     * Call after major state changes (new game, etc.).
     */
    pruneStale(validGroupIds: Set<number>): void {
        let changed = false;
        for (const id of this.selected) {
            if (!validGroupIds.has(id)) {
                this.selected.delete(id);
                changed = true;
            }
        }
        if (changed) this.notify();
    }

    /** Register a listener for selection changes. */
    onChange(callback: SelectionChangeCallback): () => void {
        this.listeners.push(callback);
        return () => {
            const idx = this.listeners.indexOf(callback);
            if (idx >= 0) this.listeners.splice(idx, 1);
        };
    }

    private notify(): void {
        // Snapshot so listeners that retain the reference don't observe
        // future mutations — the ReadonlySet type is compile-time only.
        const snapshot: ReadonlySet<number> = new Set(this.selected);
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
}
