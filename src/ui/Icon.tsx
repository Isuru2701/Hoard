const paths = {
    home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    images: (
        <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-5-5L5 21" />
        </>
    ),
    heart: <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />,
    trash: <path d="M3 6h18M8 6V4h8v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    sparkles: <path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />,
    tag: (
        <>
            <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
            <circle cx="7.5" cy="7.5" r="1" />
        </>
    ),
    folder: <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
    folderPlus: <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2ZM12 10v6M9 13h6" />,
    canvas: (
        <>
            <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3" />
            <circle cx="12" cy="12" r="2.5" />
        </>
    ),
    chevronRight: <path d="m9 18 6-6-6-6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    chevronLeft: <path d="m15 18-6-6 6-6" />,
    arrowLeft: <path d="M19 12H5m7 7-7-7 7-7" />,
    arrowRight: <path d="M5 12h14m-7-7 7 7-7 7" />,
    refresh: <path d="M21 12a9 9 0 1 1-3-6.7L21 8m0-5v5h-5" />,
    search: (
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
        </>
    ),
    panelLeft: (
        <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
        </>
    ),
    panelRight: (
        <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M15 3v18" />
        </>
    ),
    maximize: <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />,
    minimize: <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />,
    download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" />,
    upload: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7-5-5-5 5m5-5v12" />,
    x: <path d="M18 6 6 18M6 6l12 12" />,
    swap: <path d="m7 4-4 4 4 4M3 8h18m-4 12 4-4-4-4m4 4H3" />,
    more: (
        <>
            <circle cx="5" cy="12" r="1.2" fill="currentColor" />
            <circle cx="12" cy="12" r="1.2" fill="currentColor" />
            <circle cx="19" cy="12" r="1.2" fill="currentColor" />
        </>
    ),
    pointer: <path d="M4 4l7 17 2.5-7.5L21 11z" />,
    hand: <path d="M18 11V6a2 2 0 0 0-4 0v5m0-1V4a2 2 0 0 0-4 0v6m0 .5V6a2 2 0 0 0-4 0v8m12-6a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" />,
    note: <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3ZM15 3v6h6" />,
    markdown: (
        <>
            <rect x="2" y="5" width="20" height="14" rx="2.5" />
            <path d="M6 15.5v-7l3 3.5 3-3.5v7" />
            <path d="M16.5 9v5.5m-2-2.3 2 2.3 2-2.3" />
        </>
    ),
    text: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
    square: <rect x="4" y="4" width="16" height="16" rx="2" />,
    circle: <circle cx="12" cy="12" r="8.5" />,
    line: <path d="M5 19 19 5" />,
    arrow: <path d="M5 19 19 5M9 5h10v10" />,
    pen: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
    eraser: <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21m9 0H7M5 11l9 9" />,
    undo: <path d="M3 7v6h6m12 4a9 9 0 0 0-15-6.7L3 13" />,
    redo: <path d="M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13" />,
    layers: <path d="m12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5" />,
    crop: <path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />,
    copy: (
        <>
            <rect x="8" y="8" width="14" height="14" rx="2" />
            <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
        </>
    ),
    lock: (
        <>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </>
    ),
    unlock: (
        <>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </>
    ),
    flipH: <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3m8-18h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 20v2m0-8v2m0-8v2m0-8v2" />,
    flipV: <path d="M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M4 12H2m8 0H8m8 0h-2m8 0h-2" />,
    video: (
        <>
            <path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11" />
            <rect x="2" y="6" width="14" height="12" rx="2" />
        </>
    ),
    file: <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4" />,
    star: <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1z" />,
    fit: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
    link: <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />,
    external: <path d="M15 3h6v6M10 14 21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
    check: <path d="M20 6 9 17l-5-5" />,
    up: <path d="M12 19V5m-7 7 7-7 7 7" />,
    down: <path d="M12 5v14m7-7-7 7-7-7" />,
    grid: (
        <>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
        </>
    ),
    zoomIn: (
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
        </>
    ),
    zoomOut: (
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5M8 11h6" />
        </>
    ),
    sliders: <path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6" />,
    dropper: <path d="M14 7l3 3M20.5 3.5a2.1 2.1 0 0 0-3 0L14 7l3 3 3.5-3.5a2.1 2.1 0 0 0 0-3ZM12.5 8.5 4 17a2 2 0 0 0-.5.9L3 21l3.1-.5a2 2 0 0 0 .9-.5l8.5-8.5" />,
    pkg: <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />,
    edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
    alignLeft: <path d="M4 3v18M8 7h12M8 12h8M8 17h10" />,
    alignTop: <path d="M3 4h18M7 8v12M12 8v8M17 8v10" />,
    alignH: <path d="M12 3v18M6 7h12M8 12h8M5 17h14" />,
    alignV: <path d="M3 12h18M7 6v12M12 8v8M17 5v14" />,
    group: (
        <>
            <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" />
            <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" stroke="none" />
        </>
    ),
    ungroup: (
        <>
            <rect x="4" y="4" width="11" height="11" rx="2" strokeDasharray="3 3" />
            <rect x="15" y="15" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
        </>
    ),
    overlay: (
        <>
            <rect x="2.5" y="8.5" width="13" height="13" rx="2" />
            <path d="M7.5 5.5V5a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-.5" />
            <path d="M9.5 15v5.5M6.7 17.8l2.8 2.7 2.8-2.7" />
        </>
    ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, className, filled }: { name: IconName; size?: number; className?: string; filled?: boolean }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            {paths[name]}
        </svg>
    );
}
