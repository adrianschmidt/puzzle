export function elapsedMsSince(startedAt: number | undefined, now: number): number | undefined {
    if (startedAt === undefined || now < startedAt) return undefined;
    return now - startedAt;
}
