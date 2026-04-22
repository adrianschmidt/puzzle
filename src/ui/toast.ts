/**
 * showToast — tiny glassmorphism notification shown at the bottom of the
 * viewport. Auto-dismisses; only one toast at a time.
 */

const DEFAULT_DURATION_MS = 2000;

export function showToast(message: string, durationMs = DEFAULT_DURATION_MS): void {
    document.querySelectorAll('.app-toast').forEach((el) => el.remove());

    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.textContent = message;
    toast.setAttribute('role', 'status');

    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), durationMs);
}
