import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

/** Fire-and-forget analytics event. Never throws (works outside the RUN host). */
export function track(name: string, props: Record<string, unknown> = {}): void {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: unknown = RundotGameAPI.analytics.recordCustomEvent(name, props as Record<string, any>);
        if (r instanceof Promise) r.catch(() => {});
    } catch {
        /* host not available */
    }
}
