Motion Recovery v1

Purpose
-------
Return to the pre-physical-orientation-normalization idea for camera motion, while keeping the useful camera-control arbitration and symbolic diagnostics.

Camera path
-----------
- Full DeviceOrientation quaternion reconstructs physical phone attitude.
- Pitch is derived from the quaternion forward vector, not raw beta.
- Pitch sign is mapped so top edge toward user = look UP, away = look DOWN.
- webkitCompassHeading drives yaw on iPhone.
- Roll is intentionally ignored during this calibration pass.
- No physical portrait/landscape auto-basis normalization gates camera motion.

Symbols
-------
- GOLD sphere: +6m directly above camera.
- CYAN sphere: -6m directly below camera.
- CYAN ring/triangle: ~2m directly below camera (local ME/down reference).
- Normal network/player marker remains in the world.

Expected test
-------------
1. Straight ahead: horizon level; neither +/-6m sphere centered.
2. Tip top edge toward you: GOLD sphere should enter view smoothly.
3. Return neutral.
4. Tip top edge away from you: CYAN sphere should enter view smoothly.
5. Left/right should continue to follow compass yaw.

Deploy
------
Replace public/main.js and public/motionLab.js. gestureLab.js is included for matching camera-control behavior.
