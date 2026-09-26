export const DISTINCT_ID_KEY = 'puzzle-analytics-userid';

const QUERY_PARAM = 'userid';
const VALID_ID = /^[a-z0-9-]{1,32}$/;

export function isValidDistinctId(id: string): boolean {
    return id !== 'off' && VALID_ID.test(id);
}

export function resolveDistinctId(): string | undefined {
    const param = takeQueryParam();

    if (param === '' || param === 'off') {
        writeDistinctId(undefined);
        return undefined;
    }
    if (param !== null && isValidDistinctId(param)) {
        writeDistinctId(param);
        return param;
    }

    return readDistinctId();
}

export function readDistinctId(): string | undefined {
    let stored: string | null;
    try {
        stored = localStorage.getItem(DISTINCT_ID_KEY);
    } catch {
        return undefined;
    }
    return stored !== null && isValidDistinctId(stored) ? stored : undefined;
}

export function writeDistinctId(id: string | undefined): void {
    try {
        if (id === undefined) {
            localStorage.removeItem(DISTINCT_ID_KEY);
        } else {
            localStorage.setItem(DISTINCT_ID_KEY, id);
        }
    } catch {}
}

function takeQueryParam(): string | null {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(QUERY_PARAM);
    if (value !== null) {
        url.searchParams.delete(QUERY_PARAM);
        try {
            history.replaceState(history.state, '', url.href);
        } catch {}
    }
    return value;
}
