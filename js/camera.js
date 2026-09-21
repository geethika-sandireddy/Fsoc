/**
 * Virtual Camera & Sensor Projection Engine — ISRO PS-26169.
 * Models 640x480 Monochrome FPA, 4°x3° FOV, and Pan/Tilt gimbal orientation.
 */

import { SimulationState } from './state.js';

export class CameraEngine {
  constructor() {
    this.depthDistance = 1400; // World pixels depth for FOV cone rendering
  }

  reset() {
    const cam = SimulationState.camera;
    cam.pan = 0.0;
    cam.tilt = 0.0;
    cam.lastControlTime = 0;
  }

  /**
   * Projects a world coordinate (Xw, Yw) onto the 640x480 camera sensor plane (Xcam, Ycam).
   * Returns { inFOV: boolean, x: number, y: number, azimuthOffsetDeg: number, elevationOffsetDeg: number }
   */
  projectWorldToSensor(worldX, worldY) {
    const cam = SimulationState.camera;
    const W = cam.resolutionWidth;  // 640
    const H = cam.resolutionHeight; // 480

    const dx = worldX - cam.stationX;
    const dy = worldY - cam.stationY;

    // Azimuth angle in degrees from vertical optical boresight (90 deg = straight up)
    // Positive dx -> positive azimuth (pan to right)
    const targetAzimuthDeg = Math.atan2(dx, dy) * (180 / Math.PI);
    const targetElevationDistance = Math.sqrt(dx * dx + dy * dy);

    // Angular offset from current camera Pan angle
    const azimuthOffsetDeg = targetAzimuthDeg - cam.pan;

    // Elevation / distance tilt mapping:
    // Nominal reference distance is 1000 px along optical axis
    // Tilt angle offset alters vertical positioning
    const nominalDistance = 1000.0;

// Camera boresight points along +Y.
// Vertical sensor displacement should depend on forward Y distance,
// not Euclidean range, so lateral target motion does not create
// artificial vertical FOV error.
const forwardDistance = worldY - cam.stationY;
const deltaDistance = forwardDistance - nominalDistance;

const elevationOffsetDeg =
  (deltaDistance / nominalDistance) * (cam.fovV * 1.5) - cam.tilt;

    // Sensor coordinates (boresight is at W/2 = 320, H/2 = 240)
    // Pan: positive azimuth offset shifts target to right (+X) on sensor
    // Tilt: positive elevation/tilt offset shifts target up or down
    const sensorX = (W / 2) + (azimuthOffsetDeg / cam.fovH) * W;
    const sensorY = (H / 2) - (elevationOffsetDeg / cam.fovV) * H;

    const inFOV = (sensorX >= 0 && sensorX <= W && sensorY >= 0 && sensorY <= H);

    return {
      inFOV,
      sensorX,
      sensorY,
      azimuthOffsetDeg,
      elevationOffsetDeg
    };
  }

  /**
   * Computes the polygon vertices of the camera FOV cone in 2000x2000 world coordinates.
   * Useful for rendering the blue FOV cone from the camera station towards the scene.
   */
  getFOVConePolygon() {
    const cam = SimulationState.camera;
    const sx = cam.stationX;
    const sy = cam.stationY;
    const depth = this.depthDistance;

    // Boresight base angle is straight up (90 deg in standard math, or -pi/2 in canvas coords where +Y is down)
    // In our coordinate space, +Y is up (or down in canvas, we handle transformation in renderer)
    // Using angle where 0 is along optical axis:
    const panRad = (cam.pan * Math.PI) / 180;
    const halfFovHRad = ((cam.fovH / 2) * Math.PI) / 180;

    const leftAngle = -Math.PI / 2 + panRad - halfFovHRad;
    const rightAngle = -Math.PI / 2 + panRad + halfFovHRad;
    const centerAngle = -Math.PI / 2 + panRad;

    // Left ray tip
    const leftX = sx + depth * Math.cos(leftAngle);
    const leftY = sy - depth * Math.sin(leftAngle); // Canvas Y inverted

    // Right ray tip
    const rightX = sx + depth * Math.cos(rightAngle);
    const rightY = sy - depth * Math.sin(rightAngle);

    // Center boresight tip
    const centerX = sx + depth * Math.cos(centerAngle);
    const centerY = sy - depth * Math.sin(centerAngle);

    return {
      apex: { x: sx, y: sy },
      left: { x: leftX, y: leftY },
      right: { x: rightX, y: rightY },
      center: { x: centerX, y: centerY }
    };
  }
}
