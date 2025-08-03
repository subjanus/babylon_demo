import { initScene } from './initScene.js';
import { initCamera } from './initCamera.js';
import { requestDevicePermissions } from './requestPermissions.js';

const canvas = document.getElementById('renderCanvas');
const hud = document.getElementById('hud');
const socket = io();

const { engine, scene } = initScene(canvas);
const camera = initCamera(scene, canvas);

window.addEventListener('click', requestDevicePermissions, { once: true });

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener('resize', () => {
  engine.resize();
});