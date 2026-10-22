import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import { useStore } from '../state/store.ts';
import WorkspacePicker from './WorkspacePicker.tsx';
import WorkspaceShell from './WorkspaceShell.tsx';
import Overlays from './Overlays.tsx';

// Lifecycle telemetry — registered once at module scope.
try {
    RundotGameAPI.lifecycles.onPause(() => RundotGameAPI.analytics.recordCustomEvent('game_paused'));
    RundotGameAPI.lifecycles.onResume(() => RundotGameAPI.analytics.recordCustomEvent('game_resumed'));
    RundotGameAPI.lifecycles.onSleep(() => RundotGameAPI.analytics.recordCustomEvent('game_sleep'));
    RundotGameAPI.lifecycles.onQuit(() => RundotGameAPI.analytics.recordCustomEvent('game_quit'));
} catch (err) {
    console.warn('[App] lifecycle telemetry unavailable', err);
}

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
