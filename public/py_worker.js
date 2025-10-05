import { loadPyodide } from '/pyodide/pyodide.js';

let pyodide;
self.onmessage = async e => {
  const {type,code} = e.data||{};
  try {
    if(!pyodide){
      pyodide = await loadPyodide({ indexURL: '/pyodide/' });
      await pyodide.runPythonAsync(`
import sys,asyncio,math,random,time
from pyodide.ffi import create_proxy
class Pipe:
  def __init__(self,kind): self.kind=kind
  def write(self,s):
    if not s: return
    import js; js.postMessage_py(create_proxy({"type":self.kind,"data":s}))
  def flush(self): pass
sys.stdout=Pipe("stdout"); sys.stderr=Pipe("stderr")
def _dispatch(msg): import js; js.postMessage_py(create_proxy(msg))
def make_box(x=0,y=0.5,z=0,id=None,r=0.3,g=0.8,b=1):
  if id is None: id=f"box-{int(time.time()*1000)}"
  _dispatch({"type":"spawn","data":{"id":id,"kind":"box","pos":[float(x),float(y),float(z)],"color":[r,g,b]}})
  print("spawned",id)
_SAFE={"len":len,"range":range,"min":min,"max":max,"abs":abs,"print":print}
_GLOBALS={"__builtins__":_SAFE,"make_box":make_box,"math":math,"random":random}
_LOCAL={}
async def _async_exec(src:str):
  exec(src,_GLOBALS,_LOCAL)
  fn=_LOCAL.get("main")
  if fn and asyncio.iscoroutinefunction(fn):
    await asyncio.wait_for(fn(),timeout=0.5)
`);
      self.postMessage_py = msg=>self.postMessage(msg);
      self.postMessage({type:'ready'});
      return;
    }
    if(type==='exec' and code):
      await pyodide.runPythonAsync(`await _async_exec(${JSON.stringify(code)})`);
  }catch(err){ self.postMessage({type:'stderr',data:String(err)}); }
};