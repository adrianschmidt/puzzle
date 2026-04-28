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

    get toolActive(): boolean {
        return this._toolActive;
    }

    set toolActive(active: boolean) {
        if (this._toolActive === active) return;
        this._toolActive = active;
        if (!active) {
            this.clearAll();
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
