import { describeValueType, errorName, sanitizeErrorReason } from '../analytics/sanitize-error-reason.js';
import type { PwaRegisterFailedData } from '../analytics/index.js';

function describeRegisterFunction(): PwaRegisterFailedData['registerFunction'] {
    let register: unknown;
    try {
        register = navigator.serviceWorker.register;
    } catch {
        return 'unavailable';
    }
    return typeof register === 'function'
        && Function.prototype.toString.call(register).includes('[native code]')
        ? 'native'
        : 'replaced';
}

export function describeRegisterFailure(error: unknown): PwaRegisterFailedData {
    return {
        reason: sanitizeErrorReason(error),
        valueType: describeValueType(error),
        name: errorName(error),
        registerFunction: describeRegisterFunction(),
        displayMode: matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
        visibilityState: document.visibilityState,
    };
}
