# hoard — reference collection boards

A tauri app for collecting, organising, tagging and arranging reference images and videos.

Small, fast, local.

- **Workspaces** linked to a real folder on your computer

![workspace selection](references/dashboard.png)

- **Folders** are real folders; click one to see its images in a masonry feed.

![folder feed](references/folderfeed.png)

- **Canvases** (`*.hoard-canvas`) are infinite boards: drag/drop/paste images, sticky notes, text, shapes, arrows, freehand sketches, crop, flip, colour adjustments, undo/redo, copy/paste, layering, PNG export. Images placed on a canvas are copied into its `<name>.hoard-assets` folder.

![canvas feed](references/canvas.png)

- **Tagging**
 manual tags, auto tags, source link, creator, notes, rating, favourite.
 search along a graph to find inspiration that matches what you're looking for, semantically.

![tag search](references/tagsearch.png)

Intended Users: Artists, Character designers, Game devs, UI developers, and more.

## Current Features
- [ ] separate your references into profiles and workspaces
- [ ] fully open-source: no credit cards, accounts, or telemetry here
- [ ] view your images and videos like you would on pinterest.
- [ ] bring your files into a canvas, where you can arrange, draw and brainstorm your designs.
- [ ] automatic image tagging using open-source locally run AI models.
- [ ] use semantic proximity to find content that is related to a tag.
- [ ] export your canvas as a png.


note: You can add your own models from HuggingFace, but this is very experimental. Use at your own risk.


## Roadmap
- [ ] overlay canvases over other apps
- [ ] better keyboard shortcuts for canvas
- [ ] embed youtube, twitter, etc
- [ ] plugin support

If you have suggestions, make a pull request!


# Releases
- 

---
# Run locally

```
npm install
npm run dev
```

For a standalone static build: `npm run build` and host the `dist/` folder.

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
expressive art-reference concepts such as clothing styles (for example, casual wear,
gothic fashion, and streetwear), color treatments (such as monochrome), mood,
aesthetic, medium, and motifs. These are curated candidate labels rather than tags
predicted from an open-ended vocabulary, so suggestions remain limited to the
listed concepts. The vocabulary can be edited in Tag Graph for CLIP models, allowing
you to add or remove the concepts most useful to your collection.
WD ViT Tagger is a Danbooru-trained illustration tagger with its own ONNX
inference path and general-tag vocabulary. Custom ONNX models use the labels
provided by their own model and may vary in how specific their results are.
The model selector explains these differences in plain language. All models are
downloaded on demand, cached locally, and run without uploading images.
