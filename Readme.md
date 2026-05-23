# dxwebview

A browser-based Deus Ex GOTY map viewer for inspecting UE1 `.dx` maps, BSP geometry, decoded textures, actor markers, and rendered actor meshes.

## Run

```sh
npm install
npm run dev
```

Open the Vite URL in a Chromium-based browser. The viewer uses the File System Access API, so Safari and Firefox will not expose the folder picker.

## Load Deus Ex

Click **Choose Folder** and select the root of an extracted Deus Ex GOTY install.
The folder should contain the usual `Maps`, `Textures`, and `System` directories. After indexing, choose a map from the left-hand map list.

## Navigate

- Click the viewport to enter freelook.
- Move with `W`/`A`/`S`/`D`.
- Move up with `Space` or `E`.
- Move down with `Ctrl` or `Q`.
- Hold `Shift` to move faster.
- Press `Esc` to leave freelook or clear the current actor selection.
- Click **Reset** to frame the current map again.

The last selected map, camera position, and camera orientation are saved locally and restored on refresh when folder permission is still available.

## Inspect Maps

Viewport toggles control the rendered layers:

- **Geometry**: normal BSP level geometry.
- **Backdrops**: fake-backdrop surfaces.
- **Invisible**: invisible BSP surfaces and outlines.
- **Actors**: actor position markers. Actor brush and mesh geometry remains visible.
- **Non-visible actors**: always-on-top actor marker overlays.

Click an actor marker in the viewport or an actor row in the inspector to select it. Selected actors are highlighted in the viewport and scrolled into view in the inspector.

## Checks

```sh
npm test
npm run build
```

## Deploy

The GitHub Actions workflow in `.github/workflows/cloudflare-pages.yml` builds and deploys `dist` to a standalone Cloudflare Pages project on pushes to `main` and on manual workflow dispatch.

Configure these repository secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with Pages write/edit access.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID for the Pages project.

By default, the workflow creates and deploys to a Pages project named after the GitHub repository, which gives a `dxwebview.pages.dev` deployment URL. To use a different Pages project or subdomain name, set the repository variable `CLOUDFLARE_PAGES_PROJECT_NAME`.

Attach a custom subdomain in the Cloudflare Pages project settings. Do not point this workflow at an existing Pages project that is built by another site unless replacing that project's deployed output is intended.
