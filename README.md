# Pyodide Minimal Console

Client-only Python console with input/output. A tiny server echoes a message whenever code is executed.

## Run
```bash
npm install
npm start
# open http://localhost:3000
```

## Switch worker
Use the dropdown:
- **cdn** (default): loads Pyodide from jsDelivr.
- **local**: self-host Pyodide under `public/pyodide/` with at least:
  - pyodide.js
  - pyodide.asm.wasm
  - python_stdlib.zip