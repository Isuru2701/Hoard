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

Image tagging is explicit: select an image, choose a model in the right sidebar,
download/prepare it, and then run **Tag this image**. Models run locally and
generated suggestions are stored separately from manual tags.

The included options are:

- [WD14 ViT v2](https://huggingface.co/SmilingWolf/wd-v1-4-vit-tagger-v2) —
  approximately 373 MB, art-focused vocabulary, best for anime, illustration
  and character references.
- [MobileCLIP-S2](https://huggingface.co/Xenova/mobileclip_s2) — smaller semantic
  model for broad visual concepts.

The model picker shows the estimated size and links to the model files and
license. The custom model field accepts a Hugging Face model ID or a
Transformers.js-compatible model URL. Custom models must remain below 500 MB
and provide an image-classification ONNX model compatible with the selected
runtime.
