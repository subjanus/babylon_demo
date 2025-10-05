# Babylon + Pyodide + Socket.IO — Local Pyodide Demo

## Setup
1. Place Pyodide distribution under `public/pyodide/`. You need:
   - pyodide.js
   - pyodide.asm.wasm
   - python_stdlib.zip

2. Deploy to Render (uses .render.yaml).

3. Open the app: type Python in the bottom box. Example:
```
make_box(0,0.5,0)
```

## Notes
- Shapes are synced across clients via Socket.IO.
- The interpreter runs in-browser via Pyodide loaded locally.