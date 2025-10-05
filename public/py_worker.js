// Module worker version
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js';

let pyodide;
self.postMessage({ type: 'stdout', data: '[worker] boot' });

self.onmessage = async (e) => {
  const { type, code } = e.data || {};
  try {
    if (!pyodide) {
      self.postMessage({ type: 'stdout', data: '[py] loading runtime…' });
      pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' });
      self.postMessage({ type: 'stdout', data: '[py] runtime loaded, initializing…' });

      await pyodide.runPythonAsync(`
import sys, asyncio, math, random, time
from pyodide.ffi import create_proxy

class _Pipe:
    def __init__(self, kind): self.kind = kind
    def write(self, s):
        if not s: return
        import js
        js.postMessage_py(create_proxy({"type": self.kind, "data": s}))
    def flush(self): pass
sys.stdout = _Pipe("stdout")
sys.stderr = _Pipe("stderr")

def _dispatch(msg: dict):
    import js
    js.postMessage_py(create_proxy(msg))

def make_box(x=0.0, y=0.5, z=0.0, id=None, r=0.3, g=0.8, b=1.0):
    if id is None:
        import time, random
        id = f"box-{int(time.time()*1000)}-{int(random.random()*1e6)}"
    _dispatch({"type":"spawn","data":{"id": id, "kind":"box", "pos":[float(x), float(y), float(z)], "color":[float(r), float(g), float(b)]}})
    print(f"spawned box id={id} at ({x},{y},{z})")

_SAFE_BUILTINS = {"len": len, "range": range, "min": min, "max": max, "abs": abs, "print": print}
_GLOBALS = {"__builtins__": _SAFE_BUILTINS, "make_box": make_box, "math": math, "random": random}
_LOCAL = {}

async def _async_exec(src: str):
    exec(src, _GLOBALS, _LOCAL)
    fn = _LOCAL.get("main")
    if fn and asyncio.iscoroutinefunction(fn):
        await asyncio.wait_for(fn(), timeout=0.5)
`);
      self.postMessage_py = (msg) => self.postMessage(msg);
      self.postMessage({ type: 'ready' });
      self.postMessage({ type: 'stdout', data: '[py] ready.' });
      return;
    }

    if (type === 'exec' && code) {
      await pyodide.runPythonAsync(`await _async_exec(${JSON.stringify(code)})`);
    }
  } catch (err) {
    self.postMessage({ type: 'stderr', data: '[boot/exec error] ' + String(err) });
  }
};