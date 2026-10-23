/** Tiny bus so open canvas document cards refresh after a DocView save. */
type Listener = (path: string) => void;

const listeners = new Set<Listener>();

export function subscribeDocChanges(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function notifyDocChanged(path: string): void {
    for (const listener of listeners) listener(path);
}
