import { worldToLatLon } from '../geo/projection.js';

export function enableGroundClick(scene, { onDrop }) {
  scene.onPointerObservable.add((pi) => {
    if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
    const pick = scene.pick(scene.pointerX, scene.pointerY);
    if (!pick?.pickedPoint) return;
    const { lat, lon } = worldToLatLon({ x: pick.pickedPoint.x, z: pick.pickedPoint.z });
    onDrop?.({ lat, lon });
  });
}
