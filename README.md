# hoard — reference collection boards

A web app for collecting, organising, tagging and arranging reference images and videos.

- **Workspaces** linked to a real folder on your computer (Chrome/Edge desktop) or stored inside the browser.
- **Folders** are real folders; click one to see its images in a masonry feed.
- **Canvases** (`*.hoard-canvas`) are infinite boards: drag/drop/paste images, sticky notes, text, shapes, arrows, freehand sketches, crop, flip, colour adjustments, undo/redo, copy/paste, layering, PNG export. Images placed on a canvas are copied into its `<name>.hoard-assets` folder.
- **Metadata** (tags, auto tags, source link, creator, notes, rating, favourite, colour label) lives in `.hoard/meta.json`; deleted items go to `.hoard/trash`.

## Run locally

```
npm install
npm run dev
```

For a standalone static build (outside RUN.world): `npm run build:bundled` and host the `dist/` folder.
