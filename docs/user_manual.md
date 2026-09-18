# User Manual & Operating Guide: ISRO PS-26169
## AI-Based Virtual Camera Tracking System for Coarse Alignment of Mobile FSOC Terminals

### 1. Introduction & Overview
This software application implements the complete coarse alignment process of Free Space Optical Communication (FSOC) terminals for Indian Space Research Organisation (ISRO) Problem Statement 26169. It autonomously generates a configurable virtual environment, moves an optical beacon target along defined trajectories, captures frames via a virtual movable pan-tilt camera, injects atmospheric and sensor disturbances, automatically detects and tracks the beacon, and controls the camera gimbal to maintain lock within the field-of-view (FOV).

---

### 2. System Requirements & Installation

#### Prerequisites
- Windows 10/11, Linux, or macOS
- Python 3.9 or higher

#### Quick Installation
1. Clone or extract the repository:
   ```bash
   git clone https://github.com/geethika-sandireddy/Fsoc.git
   cd Fsoc
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

#### Launching the Application
- **Windows (1-Click)**: Double-click `run_app.bat`.
- **Python Desktop Mode**:
  ```bash
  python main.py
  ```
- **Browser Mode**:
  ```bash
  python -m http.server 8000
  ```
  Open `http://localhost:8000/index.html` in Chrome, Edge, or Firefox.

---

### 3. Graphical User Interface (GUI) Navigation

The application is structured into **14 navigation sections** accessible from the left sidebar:

#### OPERATE
1. **Home / Mission**: Operational master overview displaying the Virtual Environment top-view, Live Camera viewport, Tracking Status, Simulation Controls, Target Configuration, Camera/Gimbal specs, and Real-Time Telemetry Sparklines.
2. **Virtual Environment**: Configuration for virtual screen dimensions (≥ 2000 x 2000 px), grid spacing, and background star density.
3. **Targets**: Configuration of Target ID, shapes (Square default, Circle, Rectangle), sizes (5–20 px), and motion trajectories (Straight Line, Circular, Figure of 8, Random, Spiral, Sinusoidal, User-defined).
4. **Camera & Pan-Tilt**: Specifications of the 640x480 Monochrome FPA sensor, 4°x3° FOV, update rate (≥ 30 Hz), and pan/tilt dynamic limits (5–10 °/s).
5. **Disturbances & Noise**: Live control of Salt & Pepper (nominal 10%), Gaussian (SD ≤ 20 px), Poisson noise, Camera Jitter (±20 px/frame), Atmospheric conditions (Clear, Haze, Fog, Rain, Low Light) with contrast/brightness attenuation, and Platform Motion (±20 px/frame).
6. **Simulation Control**: Scenario selection, frame-by-frame stepper, duration controls, and PRNG seeds.
7. **Detection & Tracking**: Active detector selection (Classical CV Adaptive Threshold + IW-CoG, pluggable AI slot), threshold offsets, and state machine transition rules.
8. **Live Tracking**: Focused tracking cockpit displaying the Camera Boresight Center (`+`), Target Centroid (`●`), and connecting **Error Vector** being driven to zero by the servo controller.

#### ANALYZE
9. **Performance Dashboard**: Real-time graphs for Tracking Error, Acquisition Time, Re-acquisition Time, Lock Retention, and Processing Speed vs PS reference criteria.
10. **Centroid Error Log**: Tabular streaming log with separate Centroid Error and Pointing Error columns, summary statistics (Avg, Max, RMSE), and CSV export.
11. **Reports & Export**: Generates official `PS-26169 Performance Reports` with configuration snapshots, PRNG seeds, measured metrics, and PDF/Print export.

#### VALIDATE
12. **Benchmark-1**: Batch test execution suite for evaluator scenarios, calculating RMSE, lock retention, and generating performance logs.
13. **Benchmark-2**: External `.mp4` video upload mode (@ 30 FPS) with physical PTZ bypass, frame-by-frame centroid tracking, and error comparison.

#### SUPPORT
14. **Help / About**: Problem statement documentation, quick start guide, and deliverable links.

---

### 4. Running Benchmarks

#### Benchmark-1 (Scenario Testing)
1. Navigate to **Benchmark-1** in the sidebar.
2. Select **Built-in Test Scenario** (or choose **Evaluator Scenario** to configure custom noise, motion, and jitter).
3. Click **Run Benchmark-1**.
4. The system executes the scenario deterministically, calculates all metrics, and displays a summary table.

#### Benchmark-2 (External MP4 Video Bypass Mode)
1. Navigate to **Benchmark-2** in the sidebar.
2. Click **Browse** or select an `.mp4` video file (recorded @ 30 FPS).
3. The interface confirms: **PTZ BYPASS ACTIVE** (camera gimbal is bypassed).
4. Click **Process Benchmark Video**.
5. The system decodes each video frame, estimates beacon centroids, tracks lock state, and computes RMSE.
