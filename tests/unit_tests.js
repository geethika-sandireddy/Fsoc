/**
 * JavaScript Unit Test Suite — ISRO PS-26169.
 * Validates State initialization, Target engine, Tracking state machine,
 * Pan/Tilt controller, and Metrics engine.
 */

import { SimulationState, prng } from '../js/state.js';
import { TargetEngine } from '../js/target.js';
import { CameraEngine } from '../js/camera.js';
import { TrackingEngine } from '../js/tracking.js';
import { PanTiltController } from '../js/controller.js';
import { MetricsEngine } from '../js/metrics.js';

export function runJavaScriptUnitTests() {
  console.log('--- STARTING ISRO PS-26169 JS UNIT TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  // Test 1: State Uninitialized Values display null
  assert(SimulationState.metrics.instantaneousCentroidError === null, 'Metrics error starts as null (displays —)');
  assert(SimulationState.metrics.acquisitionTime === null, 'Acquisition time starts as null');
  assert(SimulationState.tracking.state === 'SEARCHING', 'Initial tracking state is SEARCHING');

  // Test 2: Target Engine Boundedness
  const tgtEngine = new TargetEngine();
  tgtEngine.reset();
  for (let t = 0; t < 60; t += 0.05) {
    tgtEngine.update(0.05, t);
    const x = SimulationState.target.worldX;
    const y = SimulationState.target.worldY;
    if (x < 30 || x > 1970 || y < 30 || y > 1970) {
      assert(false, `Target exceeded boundary at t=${t}: (${x}, ${y})`);
      break;
    }
  }
  assert(true, 'Target stays bounded within 2000x2000 world for 60s');

  // Test 3: Camera Projection Math
  const camEngine = new CameraEngine();
  camEngine.reset();
  // Target placed directly on optical axis (1000, 1480)
  const proj = camEngine.projectWorldToSensor(1000, 1480);
  assert(proj.inFOV === true, 'Target on optical axis is in FOV');
  assert(Math.abs(proj.sensorX - 320) < 1.0, 'Target on optical axis projects to sensor center X=320');

  // Test 4: Tracking State Machine Transitions
  const trkEngine = new TrackingEngine();
  trkEngine.reset();
  assert(SimulationState.tracking.state === 'SEARCHING', 'Starts in SEARCHING');

  // Detection 1 -> DETECTED
  trkEngine.update({ detected: true, x: 325, y: 242, confidence: 0.9 }, 0.033, 0.033);
  assert(SimulationState.tracking.state === 'DETECTED', 'Transition to DETECTED after first hit');

  // Detection 2 -> ACQUIRING
  trkEngine.update({ detected: true, x: 325, y: 242, confidence: 0.9 }, 0.033, 0.066);
  assert(SimulationState.tracking.state === 'ACQUIRING', 'Transition to ACQUIRING after second hit');

  // Consecutive detections up to 5 -> LOCKED
  for (let i = 3; i <= 6; i++) {
    trkEngine.update({ detected: true, x: 324, y: 241, confidence: 0.92 }, 0.033, i * 0.033);
  }
  assert(SimulationState.tracking.state === 'LOCKED', 'Transition to LOCKED after 5 consecutive detections');
  assert(SimulationState.metrics.acquisitionTime !== null, 'Acquisition time recorded');

  // Consecutive misses up to 10 -> LOST
  for (let i = 0; i < 11; i++) {
    trkEngine.update({ detected: false }, 0.033, 0.5 + i * 0.033);
  }
  assert(SimulationState.tracking.state === 'LOST', 'Transition to LOST after 10 consecutive misses');

  // Test 5: Pan/Tilt Slew-Rate Limiting
  const ctrl = new PanTiltController();
  ctrl.reset();
  // With target at X=500 (180 px to right of center), commanded pan is large
  const ctrlRes = ctrl.update(500, 240, 0.05);
  // At 5 deg/s and 50ms, max delta is 0.25 deg
  assert(ctrlRes.updated === true, 'Controller updated after 50ms');
  assert(Math.abs(ctrlRes.panDelta) <= 0.2501, 'Pan delta strictly obeys 5 deg/s slew rate limit');

  // Test 6: PS Reference Check Evaluation
  const chkOk = MetricsEngine.checkReference('trackingError', 4.8);
  assert(chkOk.status === 'WITHIN REFERENCE', '4.8 px tracking error is WITHIN REFERENCE (<= 10 px)');
  const chkBad = MetricsEngine.checkReference('trackingError', 14.2);
  assert(chkBad.status === 'EXCEEDS REFERENCE', '14.2 px tracking error EXCEEDS REFERENCE (> 10 px)');

  console.log(`--- FINISHED: ${passed} PASSED, ${failed} FAILED ---`);
  return { passed, failed };
}
