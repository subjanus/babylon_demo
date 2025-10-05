import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js';

let pyodide;
self.postMessage({ type: 'stdout', data: '[worker] boot (cdn)' });

self.onmessage = async (e) => {
  const { type, code } = e.data || {};
  try {
    if (!pyodide) {
      self.postMessage({ type: 'stdout', data: '[py] loading runtime… (cdn)' });
      pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' });
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
print("hello from Python (CDN)")
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