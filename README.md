# Caustic Lens Preview

Interactive WebGL2 caustic renderer — preview how a resin lens block projects light patterns onto a surface below. Refactored from vanilla HTML/JS into React + Vite + TypeScript.

**[→ Original repo](https://github.com/bkmashiro/caustic-preview)**

## What it does

- Real-time caustic rendering via WebGL2 (per-pixel backward ray tracing)
- Adjust refractive index, lens geometry, light direction, surface profile
- Generate printable lens meshes from images using a WASM backend
- Load custom OBJ surfaces

## Stack

- **React + Vite + TypeScript**
- **WebGL2** — shader logic ported directly from original
- **WASM** — caustic mesh generator (`wasm/caustic.wasm`)

## Project structure

```
src/
  App.tsx                  — top-level layout
  renderer/
    CausticRenderer.ts     — WebGL2 renderer class
    types.ts               — RenderParams interface
  components/
    ControlPanel.tsx       — sidebar container
    SliderRow.tsx          — labelled slider with value display
    ColorRow.tsx           — color picker row
    SectionBlock.tsx       — collapsible section
    GeneratePanel.tsx      — WASM generate + download flow
    ViewControls.tsx       — camera preset buttons
    HemisphereCanvas.tsx   — light direction picker
  hooks/
    useCausticRenderer.ts  — canvas ref + renderer lifecycle
```

## Dev

```bash
npm install
npm run dev
```

```bash
npm run build
```
