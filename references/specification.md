# name: hoard
reference collection and management app

# spec sheet:

- built with rust, tauri, sqlite
- idea: image reference collection board. lets you organize, sort, tag, arrange in a canvas, images and videos you add to collection.

- use cases:
	- artist collecting env designs
	- game dev brainstorming aesthetic
	- character designer collecting inspiration

- hierarchy (really just folders in the OS):
	- workspaces (1 user can have multiple)
	- workspaces contain folders (directly reflected on the file explorer)
	- folders contain data files (images, videos), and a canvases
- canvases are where user can arrange data files. can also add notes, sketch, crop added images etc.
- clicking on a folder displays the data files stored inside it in a feed format, like pinterest.



## NEED:
- hierarchy
- each workspace when clicked will have
	- home page (recents and counts here)
	- left sidebar folder hierarchy
	- right sidebar will 
- importing images and saving them in folders
- create canvas file (infinite btw)
- drag and drop files into canvas file (canvases have an associated created folder. redundancy is fine: if same image in 2 canvases, copy to both folders)
- move files inside canvas file
- add notes and sketches onto canvas
- canvas navigation as if it were excalidraw
- canvas undo, redo, copy, cut, paste, duplicate, delete, z-index for layering, etc for files added.

## WANT:
- auto tagging using locally run AI models (small classification models, not LLM)
- crop images
- draw shapes (rectangle, ellipses lines, arrows, etc)
- reveal in file explorer
- collapsible sidebars
- fullscreen canvas
- each image added can following metadata that can be edited in the right sidebar
	- tags (auto tags show up here too)
	- source (paste link)
- deleted images and canvases go to a trash. each workspace has separate trash. can be perma del from here.

## NICE:
- extension for clipping directly from website into folder
- use semantics to create tag relationship graph
- selected images or canvas can be exported as png with ctrl+shift+c or similar.
- embed youtube, x, etc videos and images
- always on top and overlay selected images over another app like Pureref does.


# Design principles:
- keep design sleek and modern. think Notion, Obsidian.
- ease of use comes first. needs to fire in record time. thus rust.
- best to use vector logic, specially for drawing on canvas.
- should be able to handle potentially 1000s of images. in both canvases and feeds.