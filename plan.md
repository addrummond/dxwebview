# Deus Ex Web Viewer Plan

## Goal

Build a browser-based viewer for Deus Ex / Unreal Engine 1 levels. The first useful target is a read-only level explorer that can load an extracted Deus Ex GOTY install, open a `.dx` map, render level geometry in Three.js, and inspect the Unreal objects that define the scene.

This is not a game runtime. We should optimize for asset visibility, inspection, and iteration rather than gameplay parity.

## Starting Assumptions

- Use Three.js for rendering.
- Use TypeScript for our new application, scene, and renderer code.
- Reuse existing JavaScript parser work where practical instead of starting from a blank binary parser.
- Do not fully type third-party or vendored parser code up front. Wrap it behind narrow TypeScript interfaces.
- Start with already-extracted game files, such as the GOG installer output at `/private/tmp/deus_ex_goty_51757`.
- Treat installer extraction as a later convenience feature, not part of the first viewer milestone.

## Likely Architecture

```text
packages/
  unreal-package/
    Typed adapter around existing UE1 package parsing code.

  unreal-scene/
    Stable intermediate model for maps, textures, materials, actors, BSP, lights,
    zones, and dependencies.

  web-viewer/
    Three.js app, file loading, asset browser, map viewport, object inspector,
    debug overlays.
```

If this stays small, we can collapse this into a single app package initially and split packages only when boundaries become useful.

## Parser Strategy

Primary lead: UTPackage.js, because it is JavaScript, browser-oriented, and already has relevant UE1/Deus Ex behavior.

Initial approach:

1. Vendor or fork UTPackage.js in a way that keeps upstream origin clear.
2. Build small TypeScript adapter modules around the parts we actually need:
   - package loading
   - name/import/export tables
   - object properties
   - texture extraction
   - brush/BSP geometry
   - package dependencies
3. Keep unknown parser shapes contained at the adapter boundary.
4. Add fixtures from the extracted Deus Ex install for smoke tests.

Avoid a large up-front rewrite. Port or type parser internals only after the viewer proves which surfaces matter.

## Scene Model

The scene model should be independent from parser internals. It should answer viewer-oriented questions:

- What packages are available?
- What map is open?
- What geometry should be rendered?
- Which texture/material does each surface reference?
- Which actors exist, where are they, and what class/property data do they expose?
- Which packages are missing for this map?

Initial scene concepts:

```text
GameInstall
PackageIndex
UnrealPackage
LevelScene
SceneSurface
SceneMaterial
SceneTexture
SceneActor
SceneLight
SceneZone
```

## Rendering Strategy

First renderer milestone:

- Fly camera.
- Render BSP/brush surfaces as Three.js buffer geometry.
- Use flat color fallback for missing textures.
- Resolve and upload extracted textures where possible.
- Basic alpha/masked material support.
- Click/select surfaces and actors.
- Object inspector panel for selected item metadata.

Later renderer improvements:

- Texture coordinate fidelity.
- Lightmap or approximate lighting support.
- Skyboxes.
- Zone/portal visualization.
- Movers in placed state.
- Animated/panning/fire/water textures.
- Actor icons and class-specific debug overlays.

## UI Scope

The first screen should be the tool itself, not a landing page.

Core UI:

- Folder/package source selector.
- Map list.
- Main 3D viewport.
- Left or top asset browser.
- Right inspector panel.
- Toggles for geometry, actors, lights, path nodes, zones, triggers, and collision.
- Search/filter for actors and packages.

Keep the interface utilitarian and dense enough for repeated inspection work.

## Milestones

### Milestone 1: Project Skeleton

- Create Vite-based TypeScript app.
- Add Three.js.
- Add basic layout and viewport.
- Add file/folder loading path.
- Confirm app can run locally.

Acceptance:

- Dev server starts.
- Browser shows an interactive empty Three.js scene.
- Basic UI panels render without overlap on desktop and mobile widths.

### Milestone 2: Package Indexing

- Let user choose an extracted Deus Ex directory.
- Scan known folders: `Maps`, `Textures`, `System`, `Sounds`, `Music`.
- Build package index by basename and extension.
- List `.dx` maps.
- Load one selected map as a binary package.

Acceptance:

- `/private/tmp/deus_ex_goty_51757` can be selected during local testing.
- Map list includes files such as `01_NYC_UNATCOIsland.dx`.
- Selected map loads far enough to show basic package metadata.

### Milestone 3: Parser Adapter

- Integrate UTPackage.js or equivalent parser.
- Expose narrow typed APIs for the viewer.
- Show package name table, import table, export table, and dependencies in debug UI.
- Add smoke tests for selected Deus Ex packages.

Acceptance:

- At least one `.dx`, `.utx`, and `.u` file can be parsed without crashing.
- Tests cover package header/table parsing through the adapter boundary.

### Milestone 4: First Geometry

- Extract map brush/BSP geometry.
- Convert surfaces to Three.js buffer geometry.
- Render with fallback materials.
- Add fly controls and frame the loaded map.

Acceptance:

- A Deus Ex map renders recognizable world geometry.
- Missing textures do not prevent geometry from displaying.
- User can orbit/fly through the level.

### Milestone 5: Textures

- Resolve texture dependencies through the package index.
- Extract texture bitmaps from `.utx` packages.
- Map textures onto surfaces.
- Implement basic masked/translucent handling.

Acceptance:

- Common map textures display on level surfaces.
- Missing dependencies are reported clearly.
- Texture loading failures degrade to visible fallback materials.

### Milestone 6: Actors And Inspection

- Parse actor list and common transform/properties.
- Render actors as icons/placeholders.
- Add click selection for surfaces and actors.
- Add inspector panel showing class, package, transform, and raw properties.

Acceptance:

- Items, NPCs, triggers, lights, path nodes, and decorations are visible or searchable.
- Selecting an actor reveals useful Unreal properties.

### Milestone 7: Debug Overlays

- Actor category toggles.
- Light icons/radius hints.
- Path node graph.
- Trigger volumes and event/tag relationships.
- Zone and portal overlays where available.

Acceptance:

- Viewer is useful for understanding level structure, not just looking at geometry.

### Milestone 8: Polish And Compatibility

- Improve texture coordinate fidelity.
- Add map thumbnails or quick previews.
- Add persistent settings.
- Improve large-map performance.
- Add compatibility notes for maps that fail or render oddly.

Acceptance:

- Core Deus Ex GOTY maps load reliably enough for normal exploration.
- Known limitations are documented.

## Testing Plan

- Unit tests for binary reader helpers and parser adapters.
- Fixture-based smoke tests against a small set of real packages from Deus Ex GOTY.
- Renderer tests for scene conversion where practical.
- Browser verification with screenshots after major UI/rendering changes.
- No time-dependent assertions unless time is mocked.

Suggested initial fixtures:

```text
Maps/00_Training.dx
Maps/01_NYC_UNATCOIsland.dx
Textures/CoreTexConcrete.utx
Textures/UNATCO.utx
System/DeusEx.u
System/Engine.u
```

Avoid committing copyrighted game assets. Tests that require local Deus Ex files should either:

- look for an environment variable such as `DEUS_EX_PATH`, or
- run only when fixtures are explicitly provided outside the repo.

## Risks

- Existing parsers may expose unstable or incomplete shapes.
- BSP and texture coordinate reconstruction may need significant compatibility work.
- Deus Ex classes and properties may differ from generic Unreal Tournament assumptions.
- Browser folder access APIs vary by environment.
- Full installer extraction in browser is possible but not a good first milestone.

## Near-Term Next Steps

1. Create the Vite/TypeScript/Three.js skeleton.
2. Decide whether to vendor UTPackage.js directly or use a fork/submodule/package.
3. Add a package indexer that can scan an extracted Deus Ex directory.
4. Load one map and display metadata before attempting rendering.
5. Build the first geometry path with fallback materials.
