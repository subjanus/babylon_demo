export function initScene(canvas) {
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.createDefaultLight(true);
return { engine, scene };
}