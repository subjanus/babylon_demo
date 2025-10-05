// public/py_worker.js  (module worker)
import { loadPyodide } from '/pyodide/pyodide.js';

let pyodide;
self.onmessage = async (e) => {
  const { type, code } = e.data || {};
  if (!pyodide) {
    // indexURL is the folder where pyodide.js lives; loader finds the wasm/stdlib relative to this
    pyodide = await loadPyodide({ indexURL: '/pyodide/' });
    // ... run your Python bootstrap here ...
    self.postMessage({ type: 'ready' });
    return;
  }
  if (type === 'exec') {
    await pyodide.runPythonAsync(`await _async_exec(${JSON.stringify(code)})`);
  }
};
