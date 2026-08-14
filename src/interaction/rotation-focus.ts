/**
 * Anchors the floating rotate buttons. Independent of SelectionManager:
 * focus is short-lived and cleared by virtually any non-rotate interaction.
 */

export type RotationFocusChangeCallback = (focusedGroupId: number | null) => void;

export class RotationFocus {
    private _focusedGroupId: number | null = null;
    private listeners: RotationFocusChangeCallback[] = [];

    get focusedGroupId(): number | null {
        return this._focusedGroupId;
    }

    setFocus(groupId: number): void {
        if (this._focusedGroupId === groupId) return;
        this._focusedGroupId = groupId;
        this.notify();
    }

    clearFocus(): void {
        if (this._focusedGroupId === null) return;
        this._focusedGroupId = null;
        this.notify();
    }

    onChange(callback: RotationFocusChangeCallback): () => void {
        this.listeners.push(callback);
        return () => {
            const idx = this.listeners.indexOf(callback);
            if (idx >= 0) this.listeners.splice(idx, 1);
        };
    }

    private notify(): void {
        const value = this._focusedGroupId;
        // Snapshot so a listener that unsubscribes during its callback doesn't shift the in-flight loop.
        for (const listener of this.listeners.slice()) {
            listener(value);
        }
    }
}
