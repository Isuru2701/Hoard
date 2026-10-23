import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { useStore } from '../state/store.ts';
import { getRoot } from '../state/actions.ts';
import { getThumbUrl, type MediaRef } from '../lib/thumbs.ts';

export function IconBtn(props: {
    icon: IconName;
    title: string;
    ev: string;
    onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
    active?: boolean;
    disabled?: boolean;
    danger?: boolean;
    className?: string;
    size?: number;
    filled?: boolean;
    children?: ReactNode;
}) {
    const { icon, title, ev, onClick, active, disabled, danger, className = '', size = 16, filled, children } = props;
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            disabled={disabled}
            className={`ib ${active ? 'ib-on' : ''} ${danger ? 'ib-danger' : ''} ${className}`}
            onClick={(e) => {
                
                onClick?.(e);
            }}
        >
            <Icon name={icon} size={size} filled={filled} />
            {children}
        </button>
    );
}

export function Btn(props: {
    children: ReactNode;
    ev: string;
    onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
    variant?: 'ghost' | 'primary' | 'subtle' | 'danger';
    icon?: IconName;
    className?: string;
    disabled?: boolean;
    title?: string;
}) {
    const { children, ev, onClick, variant = 'ghost', icon, className = '', disabled, title } = props;
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            className={`btn btn-${variant} ${className}`}
            onClick={(e) => {
                
                onClick?.(e);
            }}
        >
            {icon && <Icon name={icon} size={15} />}
            {children}
        </button>
    );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
    return (
        <div className="mb-3 flex min-h-8 items-center justify-between">
            <span className="section-label">{children}</span>
            {right}
        </div>
    );
}

export function ThumbImg({ entry, className = '' }: { entry: MediaRef; className?: string }) {
    const wsId = useStore((s) => s.wsId) ?? '';
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        const root = getRoot();
        if (!root || entry.kind === 'file' || entry.kind === 'markdown') return;
        setUrl(null);
        getThumbUrl(wsId, root, entry).then((u) => {
            if (live) setUrl(u);
        });
        return () => {
            live = false;
        };
    }, [wsId, entry.path, entry.modified, entry.size, entry.kind]);
    if (entry.kind === 'file' || entry.kind === 'markdown')
        return (
            <div className={`grid place-items-center bg-white/5 text-muted ${className}`}>
                <Icon name={entry.kind === 'markdown' ? 'markdown' : 'file'} size={22} />
            </div>
        );
    return url ? <img src={url} className={`object-cover ${className}`} draggable={false} alt="" /> : <div className={`skeleton ${className}`} />;
}

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(t: number): string {
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Empty({ icon = 'images', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-muted">
                <Icon name={icon} size={26} />
            </div>
            <div className="text-base font-semibold">{title}</div>
            {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
        </div>
    );
}
