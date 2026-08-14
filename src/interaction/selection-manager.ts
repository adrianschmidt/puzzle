/**
 * "Selection" is a user-created grouping for batch movement, separate from
 * PieceGroup (physically connected/merged pieces): tapping pieces adds their
 * PieceGroup to the selection, then dragging any one moves them all.
 */

export type SelectionChangeCallback = (selectedGroupIds: ReadonlySet<number>) => void;
export type ToolActiveChangeCallback = (toolActive: boolean) => void;
export type MarqueeActiveChangeCallback = (marqueeActive: boolean) => void;

export class SelectionManager {
    private selected = new Set<number>();
    private listeners: SelectionChangeCallback[] = [];
    private toolActiveListeners: ToolActiveChangeCallback[] = [];

    private _toolActive = false;

    private _marqueeActive = false;
    private marqueeActiveListeners: MarqueeActiveChangeCallback[] = [];

    get toolActive(): boolean {
        return this._toolActive;
    }

    set toolActive(active: boolean) {
        if (this._toolActive === active) return;
        this._toolActive = active;
        if (!active) {
            this.clearAll();
            // Invariant "marquee implies tool": disabling the tool disarms the marquee.
            this.setMarqueeActive(false);
        }
        for (const listener of this.toolActiveListeners) {
            listener(active);
        }
    }

    /** Returns the new state. */
    toggleTool(): boolean {
        this.toolActive = !this._toolActive;
        return this._toolActive;
    }

    onToolActiveChange(callback: ToolActiveChangeCallback): () => void {
        this.toolActiveListeners.push(callback);
        return () => {
            const idx = this.toolActiveListeners.indexOf(callback);
            if (idx >= 0) this.toolActiveListeners.splice(idx, 1);
        };
    }

    get marqueeActive(): boolean {
        return this._marqueeActive;
    }

    /**
     * Returns the new state. Enabling also enables the tool ("marquee implies
     * tool"); disabling leaves the selection intact, only turning off the gesture.
     */
    toggleMarquee(): boolean {
        if (this._marqueeActive) {
            this.setMarqueeActive(false);
        } else {
            this.toolActive = true;
            this.setMarqueeActive(true);
        }
        return this._marqueeActive;
    }

    onMarqueeActiveChange(callback: MarqueeActiveChangeCallback): () => void {
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

    get selectedGroupIds(): ReadonlySet<number> {
        return this.selected;
    }

    isSelected(groupId: number): boolean {
        return this.selected.has(groupId);
    }

    /** Returns true if now selected. */
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

    select(groupId: number): void {
        if (!this.selected.has(groupId)) {
            this.selected.add(groupId);
            this.notify();
        }
    }

    /**
     * Add many groups, firing onChange once for the batch (only if ≥1 was new);
     * returns whether the selection grew. Used by the marquee — per-group adds
     * would fan out the listener's all-groups visual re-apply once per match.
     */
    selectMany(groupIds: Iterable<number>): boolean {
        let changed = false;
        for (const id of groupIds) {
            if (!this.selected.has(id)) {
                this.selected.add(id);
                changed = true;
            }
        }
        if (changed) this.notify();
        return changed;
    }

    deselect(groupId: number): void {
        if (this.selected.has(groupId)) {
            this.selected.delete(groupId);
            this.notify();
        }
    }

    clearAll(): void {
        if (this.selected.size > 0) {
            this.selected.clear();
            this.notify();
        }
    }

    get hasSelection(): boolean {
        return this.selected.size > 0;
    }

    /**
     * When the tool is active and `id` is selected, return all selected IDs with
     * `id` first; otherwise just `[id]`. Lets drag handlers fan out to the whole
     * selection. `id` is always first.
     */
    expandToSelectionIfActive(id: number): readonly number[] {
        if (!this._toolActive || !this.selected.has(id)) return [id];
        const others = [...this.selected].filter((other) => other !== id);
        return [id, ...others];
    }

    /** After a merge: oldGroupId was absorbed into newGroupId. */
    handleMerge(oldGroupId: number, newGroupId: number): void {
        if (this.selected.has(oldGroupId)) {
            this.selected.delete(oldGroupId);
            this.selected.add(newGroupId);
            this.notify();
        }
    }

    /** Call after major state changes (new game, etc.). */
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

    onChange(callback: SelectionChangeCallback): () => void {
        this.listeners.push(callback);
        return () => {
            const idx = this.listeners.indexOf(callback);
            if (idx >= 0) this.listeners.splice(idx, 1);
        };
    }

    private notify(): void {
        // Snapshot — ReadonlySet is compile-time only, so retained refs must not see later mutations.
        const snapshot: ReadonlySet<number> = new Set(this.selected);
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
}
