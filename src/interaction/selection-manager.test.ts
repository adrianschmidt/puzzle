import { describe, it, expect, vi } from 'vitest';
import { SelectionManager } from './selection-manager.js';

describe('SelectionManager', () => {
    describe('toggle', () => {
        it('adds the ID and fires onChange exactly once when not selected', () => {
            const mgr = new SelectionManager();
            const listener = vi.fn();
            mgr.onChange(listener);

            const result = mgr.toggle(7);

            expect(result).toBe(true);
            expect(mgr.isSelected(7)).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('removes the ID and fires onChange exactly once when already selected', () => {
            const mgr = new SelectionManager();
            mgr.select(7);
            const listener = vi.fn();
            mgr.onChange(listener);

            const result = mgr.toggle(7);

            expect(result).toBe(false);
            expect(mgr.isSelected(7)).toBe(false);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('passes the current selection set to listeners', () => {
            const mgr = new SelectionManager();
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.toggle(1);
            mgr.toggle(2);

            const lastArg = listener.mock.calls.at(-1)?.[0] as ReadonlySet<number>;
            expect(lastArg.has(1)).toBe(true);
            expect(lastArg.has(2)).toBe(true);
        });
    });

    describe('select / deselect', () => {
        it('select fires onChange when ID is newly added', () => {
            const mgr = new SelectionManager();
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.select(3);

            expect(mgr.isSelected(3)).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('select is a no-op (no listener fired) when ID already selected', () => {
            const mgr = new SelectionManager();
            mgr.select(3);
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.select(3);

            expect(listener).not.toHaveBeenCalled();
        });

        it('deselect fires onChange when ID is removed', () => {
            const mgr = new SelectionManager();
            mgr.select(3);
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.deselect(3);

            expect(mgr.isSelected(3)).toBe(false);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('deselect is a no-op (no listener fired) when ID not selected', () => {
            const mgr = new SelectionManager();
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.deselect(3);

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('clearAll', () => {
        it('clears the selection and fires onChange when something is selected', () => {
            const mgr = new SelectionManager();
            mgr.select(1);
            mgr.select(2);
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.clearAll();

            expect(mgr.hasSelection).toBe(false);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('is a no-op when nothing is selected', () => {
            const mgr = new SelectionManager();
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.clearAll();

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('toolActive setter', () => {
        it('does nothing when set to current value', () => {
            const mgr = new SelectionManager();
            const toolListener = vi.fn();
            mgr.onToolActiveChange(toolListener);

            mgr.toolActive = false;

            expect(toolListener).not.toHaveBeenCalled();
        });

        it('fires onToolActiveChange when toggled on', () => {
            const mgr = new SelectionManager();
            const toolListener = vi.fn();
            mgr.onToolActiveChange(toolListener);

            mgr.toolActive = true;

            expect(mgr.toolActive).toBe(true);
            expect(toolListener).toHaveBeenCalledTimes(1);
            expect(toolListener).toHaveBeenCalledWith(true);
        });

        it('clears the selection AND fires both listener channels in order when toggled off', () => {
            const mgr = new SelectionManager();
            mgr.toolActive = true;
            mgr.select(1);
            mgr.select(2);

            const calls: string[] = [];
            mgr.onChange(() => calls.push('change'));
            mgr.onToolActiveChange(() => calls.push('toolActive'));

            mgr.toolActive = false;

            expect(mgr.toolActive).toBe(false);
            expect(mgr.hasSelection).toBe(false);
            // onChange fires first (from clearAll), then onToolActiveChange
            expect(calls).toEqual(['change', 'toolActive']);
        });

        it('does not fire onChange when toggled off with empty selection', () => {
            const mgr = new SelectionManager();
            mgr.toolActive = true;
            const changeListener = vi.fn();
            const toolListener = vi.fn();
            mgr.onChange(changeListener);
            mgr.onToolActiveChange(toolListener);

            mgr.toolActive = false;

            expect(changeListener).not.toHaveBeenCalled();
            expect(toolListener).toHaveBeenCalledTimes(1);
        });
    });

    describe('toggleTool', () => {
        it('returns the new state and fires onToolActiveChange', () => {
            const mgr = new SelectionManager();
            const toolListener = vi.fn();
            mgr.onToolActiveChange(toolListener);

            const onResult = mgr.toggleTool();
            expect(onResult).toBe(true);
            expect(mgr.toolActive).toBe(true);
            expect(toolListener).toHaveBeenLastCalledWith(true);

            const offResult = mgr.toggleTool();
            expect(offResult).toBe(false);
            expect(mgr.toolActive).toBe(false);
            expect(toolListener).toHaveBeenLastCalledWith(false);
            expect(toolListener).toHaveBeenCalledTimes(2);
        });
    });

    describe('handleMerge', () => {
        it('rebinds selection from old to new group ID and fires once', () => {
            const mgr = new SelectionManager();
            mgr.select(10);
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.handleMerge(10, 20);

            expect(mgr.isSelected(10)).toBe(false);
            expect(mgr.isSelected(20)).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('does nothing when oldGroupId is not selected', () => {
            const mgr = new SelectionManager();
            mgr.select(99);
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.handleMerge(10, 20);

            expect(mgr.isSelected(99)).toBe(true);
            expect(mgr.isSelected(10)).toBe(false);
            expect(mgr.isSelected(20)).toBe(false);
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('pruneStale', () => {
        it('removes only IDs not in the valid set', () => {
            const mgr = new SelectionManager();
            mgr.select(1);
            mgr.select(2);
            mgr.select(3);

            mgr.pruneStale(new Set([2]));

            expect(mgr.isSelected(1)).toBe(false);
            expect(mgr.isSelected(2)).toBe(true);
            expect(mgr.isSelected(3)).toBe(false);
        });

        it('fires onChange exactly once even when multiple IDs are removed', () => {
            const mgr = new SelectionManager();
            mgr.select(1);
            mgr.select(2);
            mgr.select(3);
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.pruneStale(new Set<number>());

            expect(mgr.hasSelection).toBe(false);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('does not fire onChange when nothing is removed', () => {
            const mgr = new SelectionManager();
            mgr.select(1);
            mgr.select(2);
            const listener = vi.fn();
            mgr.onChange(listener);

            mgr.pruneStale(new Set([1, 2, 3]));

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('listener argument is a snapshot', () => {
        it('does not reflect mutations made after the listener returns', () => {
            const mgr = new SelectionManager();
            let firstCaptured: ReadonlySet<number> | undefined;
            const unsubscribe = mgr.onChange((ids) => {
                firstCaptured = ids;
                unsubscribe();
            });

            mgr.select(1);
            mgr.select(2);
            mgr.select(3);

            expect(firstCaptured).toBeDefined();
            expect(new Set(firstCaptured)).toEqual(new Set([1]));
        });

        it('passes a fresh snapshot to every listener invocation', () => {
            const mgr = new SelectionManager();
            const captures: ReadonlySet<number>[] = [];
            mgr.onChange((ids) => {
                captures.push(ids);
            });

            mgr.select(1);
            mgr.select(2);

            expect(captures).toHaveLength(2);
            expect(captures[0]).not.toBe(captures[1]);
            expect(new Set(captures[0])).toEqual(new Set([1]));
            expect(new Set(captures[1])).toEqual(new Set([1, 2]));
        });
    });

    describe('unsubscribe', () => {
        it('onChange unsubscribe stops the listener from being called', () => {
            const mgr = new SelectionManager();
            const listener = vi.fn();
            const unsubscribe = mgr.onChange(listener);

            mgr.select(1);
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();
            mgr.select(2);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('onChange unsubscribe leaves other listeners intact', () => {
            const mgr = new SelectionManager();
            const a = vi.fn();
            const b = vi.fn();
            const unsubA = mgr.onChange(a);
            mgr.onChange(b);

            unsubA();
            mgr.select(1);

            expect(a).not.toHaveBeenCalled();
            expect(b).toHaveBeenCalledTimes(1);
        });

        it('onToolActiveChange unsubscribe stops the listener from being called', () => {
            const mgr = new SelectionManager();
            const listener = vi.fn();
            const unsubscribe = mgr.onToolActiveChange(listener);

            mgr.toolActive = true;
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();
            mgr.toolActive = false;
            expect(listener).toHaveBeenCalledTimes(1);
        });
    });
});
