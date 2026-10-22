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

## Windows desktop app

The desktop build uses Tauri 2. It keeps the React interface but uses native Rust
filesystem commands for linked workspaces, so selected folders are available
through the normal Windows filesystem instead of the browser File System Access API.

Install the Windows prerequisites once:

1. WebView2 (normally already installed on Windows 10/11).
2. Rust using the MSVC toolchain.
3. Visual Studio Build Tools with **Desktop development with C++**, including
   the Windows SDK.

Then run the development app:

```
npm install
npm run desktop:dev
```

Create the Windows installers:

```
npm run desktop:build
```

The generated `.msi` and NSIS `.exe` installer are placed under
`src-tauri/target/release/bundle/`.

GitHub Actions builds the same Windows artifacts automatically on pushes and
pull requests. You can also run it manually from the Actions tab using
**Build Windows desktop app**. The workflow uploads the installers and the
portable executable as downloadable workflow artifacts.

Desktop workspaces store their selected absolute folder path in the workspace
registry. Images, videos, canvases, and `.hoard` metadata remain in that folder.

## Local model tagging

Image tagging is explicit and local. Open **Tag Graph** to download the included
model once, choose the number of generated tags (5 by default), and auto-tag all
images in the workspace. The same model can tag one selected image from the
folder feed or canvas through the right sidebar. Generated suggestions are
stored separately from manual tags.

The included models are [Xenova/clip-vit-base-patch32](https://huggingface.co/Xenova/clip-vit-base-patch32),
approximately 354 MB in its quantized Transformers.js variant, and
[SmilingWolf/wd-vit-tagger-v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3),
approximately 379 MB. CLIP is a zero-shot image classifier prompted with
art-reference concepts such as subject, mood, aesthetic, medium, and motifs.
WD ViT Tagger is a Danbooru-trained illustration tagger with its own ONNX
inference path and general-tag vocabulary. Both models are downloaded on
demand, cached locally, and run without uploading images.
