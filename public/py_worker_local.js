import { loadPyodide } from '/pyodide/pyodide.js';

let pyodide;
self.postMessage({ type: 'stdout', data: '[worker] boot (local)' });

self.onmessage = async (e) => {
  const { type, code } = e.data || {};
  try {
    if (!pyodide) {
      self.postMessage({ type: 'stdout', data: '[py] loading runtime… (local)' });
      pyodide = await loadPyodide({ indexURL: '/pyodide/' });
      await pyodide.runPythonAsync(`
import sys
from pyodide.ffi import create_proxy
class _Pipe:
  def __init__(self, k): self.k=k
  def write(self, s):
    if not s: return
    import js; js.postMessage_py(create_proxy({"type": self.k, "data": s}))
  def flush(self): pass
sys.stdout=_Pipe("stdout"); sys.stderr=_Pipe("stderr")
print("hello from Python (local)")
`);
      self.postMessage_py = (msg) => self.postMessage(msg);
      self.postMessage({ type: 'ready' });
      self.postMessage({ type: 'hello' });
      return;
    }
    if (type === 'exec' && code) {
      await pyodide.runPythonAsync(code);
    }
  } catch (err) {
    self.postMessage({ type: 'stderr', data: String(err) });
  }
};