# PS-26169 Requirements Traceability Matrix
## AI-Based Virtual Camera Tracking System for Coarse Alignment of Mobile FSOC Terminals

| Sr. | PS-26169 Specification | Reference Value / Requirement | Implementation in System | Verification Status |
|:---:|:---|:---|:---|:---:|
| 1 | **Screen Size (min.)** | 2000 x 2000 pixels (User-defined) | Configurable in `SimulationState.environment` (default: 2000x2000 px, boundary validation active) | **Compliant** |
| 2 | **Camera Type** | Monochrome, Focal Plane Array (FPA) | Simulated Monochrome FPA sensor feed (8-bit grayscale intensity buffer) | **Compliant** |
| 3 | **Camera Resolution** | 640 x 480 pixels (User-defined) | Native 640x480 pixel offscreen sensor buffer | **Compliant** |
| 4 | **Camera FOV** | 4.0° x 3.0° (User-defined) | Configurable in `SimulationState.camera` (default: 4.0° x 3.0°) | **Compliant** |
| 5 | **Camera Update Rate** | ≥ 30 Hz (min.) | 30 Hz sensor capture and frame processing loop | **Compliant** |
| 6 | **Initial Camera Position**| Center of the Screen | Positioned at screen center / base station (1000, 480) pointing upwards | **Compliant** |
| 7 | **Target Type** | Beacon Spot | Optical spot with intense peak core and Gaussian bloom | **Compliant** |
| 8 | **Number of Targets** | 1 mandatory, multiple optional | Primary designated target `T1` | **Compliant** |
| 9 | **Target Shape** | User-defined, Default: Square | Built-in presets: Square (default), Circle, Rectangle | **Compliant** |
| 10| **Target Size** | 5–20 x 5–20 pixels (Default: 10 x 10) | Slider 5–20 px in `SimulationState.target.size` | **Compliant** |
| 11| **Initial Target Location**| User-defined, Default: Random | Presets: Random, Center, Custom (X, Y) | **Compliant** |
| 12| **Target Motion Modes** | 4 Mandatory: Straight Line, Circular, Figure of 8, Random. Optional: Spiral, Sinusoidal, User-defined | All 7 modes fully implemented in `target.js` | **Compliant** |
| 13| **Max. Pan Speed** | 5–10 °/s (Default: 5 °/s) | Slew-rate limiter caps pan step to &le; (speed / freq) | **Compliant** |
| 14| **Max. Tilt Speed** | 5–10 °/s (Default: 5 °/s) | Slew-rate limiter caps tilt step to &le; (speed / freq) | **Compliant** |
| 15| **Update Interval** | ≥ 20 Hz | Pan/Tilt servo controller update rate: 20 Hz (50 ms) | **Compliant** |
| 16| **Acquisition Time** | ≤ 2.0 sec | Measured time until 5 consecutive valid frames; compared vs 2.0 s reference | **Compliant** |
| 17| **Tracking Error** | ≤ 10.0 pixels | Measured Euclidean centroiding error vs ground truth; compared vs 10.0 px | **Compliant** |
| 18| **Target Loss Rate** | < 5.0 % | Computed as (Lost frames / Total frames) * 100; compared vs 5.0% | **Compliant** |
| 19| **Re-acquisition Time** | ≤ 1.0 sec | Measured elapsed time from target loss until re-locking; compared vs 1.0 s | **Compliant** |
| 20| **Processing Speed** | ≥ 20.0 FPS | Real-time computation time per frame measured; compared vs 20.0 FPS | **Compliant** |
| 21| **Image Noise** | Salt & Pepper (~10%), Gaussian (SD ≤ 20 px), Poisson | In-place pixel buffer degradation in `disturbance.js` | **Compliant** |
| 22| **Camera Jitter** | Max ±20 pixels/frame | Sensor translation offset up to ±20 px/frame | **Compliant** |
| 23| **Atmospheric Disturbance**| Clear, Haze, Fog, Rain, Low Light + Contrast/Brightness reduction | 5 condition models with contrast and brightness attenuation | **Compliant** |
| 24| **Platform Motion** | Linear (mandatory), Circular, Random, Spiral, Figure of 8 (max ±20 px/frame) | Motion modes implemented in `disturbance.js` | **Compliant** |
| 25| **Benchmark-1** | Evaluator scenarios, centroid error log, automated performance report | Automated runner in `benchmarks.js` with Built-in & Evaluator inputs | **Compliant** |
| 26| **Benchmark-2** | External .mp4 @ 30 FPS, PTZ bypass, centroiding vs reference error | Video decoder in `benchmarks.js` with PTZ bypass & RMSE scoring | **Compliant** |
| 27| **Standalone Executable** | Executable application implementing complete system | PySide6 desktop standalone application (`main.py` / `run_app.bat`) | **Compliant** |
