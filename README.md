# Babylon + Pyodide + Socket.IO — Python Console Demo

Type Python in the bottom console and hit **Enter** to execute on the client via Pyodide. Your code can call `make_box(x,y,z, id=None, r=0.3, g=0.8, b=1.0)`. Box spawns are applied locally and broadcast to other clients.

## Pages
- `/` — Client scene + console
- `/admin.html` — Admin peer table

## Run
```bash
npm install
npm start
# http://localhost:3000/
```

## Examples
```
make_box(0,0.5,0)
```
```
def main():
    for i in range(5):
        make_box(i*1.5, 0.5, 0, r=1, g=0.6, b=0.2)
```