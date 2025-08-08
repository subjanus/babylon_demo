export function createEngine(canvas) {
  return new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
}
