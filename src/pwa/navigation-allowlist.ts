export function appNavigationAllowlist(base: string): RegExp {
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escapedBase}(?:\\?|$)`);
}
