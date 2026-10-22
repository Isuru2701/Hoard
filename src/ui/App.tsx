import { useStore } from '../state/store.ts';
import WorkspacePicker from './WorkspacePicker.tsx';
import WorkspaceShell from './WorkspaceShell.tsx';
import Overlays from './Overlays.tsx';

export default function App() {
    const booted = useStore((s) => s.booted);
    const screen = useStore((s) => s.screen);
    return (
        <div className="h-full w-full select-none bg-bg text-fg">
            {!booted ? (
                <div className="grid h-full place-items-center">
                    <div className="logo animate-pulse">h.</div>
                </div>
            ) : screen === 'picker' ? (
                <WorkspacePicker />
            ) : (
                <WorkspaceShell />
            )}
            <Overlays />
        </div>
    );
}
