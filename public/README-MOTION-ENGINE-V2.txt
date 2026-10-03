Motion Engine v2.1 hotfix

Fixes camera not moving after Motion Enabled on iPhone.
The quaternion vector rotation no longer depends on BABYLON.Matrix.FromQuaternion, and the camera Euler rotation is no longer reset after assigning rotationQuaternion.

Deploy public/main.js. Other files are included for completeness.

MOTION ENGINE v2 / MOTION LAB v2

Deploy to public/:
  main.js
  motionLab.js

Keep gestureLab.js from the previous build (included here for convenience).
No server changes are required.

What changed
------------
1. Camera orientation is now driven by a quaternion instead of assigning
   alpha/beta/gamma directly to camera Euler x/y/z.
2. Only the iOS-friendly `deviceorientation` stream drives the camera.
   `deviceorientationabsolute` is no longer allowed to race it.
3. webkitCompassHeading corrects the quaternion around world Y, preserving
   pitch and roll while giving a stable horizontal heading.
4. The blue horizon helper is a true world-horizontal ring; it is no longer
   counter-rotated using camera Euler roll.
5. Motion Lab v2 understands camera.rotationQuaternion and shows quaternion,
   quaternion-derived camera Euler values, forward/up basis vectors, and raw
   sensor readings side-by-side.

Validation pass
---------------
Enable Motion, then Motion Lab. Repeat the same P1-P9 sequence:
 P1 ahead
 P2 45 left
 P3 90 left
 P4 ahead
 P5 45 right
 P6 90 right
 P7 top toward you
 P8 top away from you
 P9 roll like a steering wheel

Expected improvement:
- P1-P6: the blue horizon remains level while yaw changes.
- P7/P8: pitch changes without introducing large false roll.
- P9: deliberate roll visibly tilts the world/horizon.
