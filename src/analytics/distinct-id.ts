export const DISTINCT_ID_KEY = 'puzzle-analytics-userid';

const QUERY_PARAM = 'userid';
const VALID_ID = /^[a-z0-9-]{1,32}$/;

export function resolveDistinctId(): string | undefined {
    const param = takeQueryParam();

    if (param === '' || param === 'off') {
        writeStoredId(null);
        return undefined;
    }
    if (param !== null && VALID_ID.test(param)) {
        writeStoredId(param);
        return param;
    }

    const stored = readStoredId();
    return stored !== null && VALID_ID.test(stored) ? stored : undefined;
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

function readStoredId(): string | null {
    try {
        return localStorage.getItem(DISTINCT_ID_KEY);
    } catch {
        return null;
    }
}

function writeStoredId(id: string | null): void {
    try {
        if (id === null) {
            localStorage.removeItem(DISTINCT_ID_KEY);
        } else {
            localStorage.setItem(DISTINCT_ID_KEY, id);
        }
    } catch {}
}
