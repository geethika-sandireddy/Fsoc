# ISRO PS-26169 · AI-Based Virtual Camera Tracking System
## Coarse Alignment of Mobile Free Space Optical Communication (FSOC) Terminals

[![SIH 2026](https://img.shields.io/badge/SIH-2026-orange.svg)](https://sih.gov.in)
[![Organization: ISRO](https://img.shields.io/badge/Organization-ISRO%20%2F%20DOS-blue.svg)](https://isro.gov.in)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9+-brightgreen.svg)](https://python.org)
[![PySide6](https://img.shields.io/badge/PySide6-GUI-teal.svg)](https://pypi.org/project/PySide6/)
[![License: MIT](https://img.shields.io/badge/License-MIT-lightgrey.svg)](LICENSE)

An engineering-grade mission control console and software-based virtual camera tracking system developed for **Smart India Hackathon (SIH) 2026 Problem Statement 26169** (Indian Space Research Organisation / Department of Space).

The system simulates the coarse alignment stage of mobile Free Space Optical Communication (FSOC) terminals by autonomously detecting, identifying, and continuously tracking a designated optical beacon within a configurable virtual environment using computer vision and closed-loop pan-tilt camera repositioning.

---

## Key Features & PS-26169 Compliance

- **Configurable Virtual Environment**: $\ge 2000 \times 2000$ pixels coordinate space with starfields, grid, axes, and boundary validation.
- **7 Target Motion Models**:
  - *4 Mandatory*: Straight Line, Circular, Figure of 8 (Lemniscate), Random Walk with inertia.
  - *3 Optional*: Spiral, Sinusoidal, User-defined $X(t), Y(t)$.
  - Configurable sizes ($5\text{–}20\text{ px}$, default $10 \times 10$) and shapes (Square default, Circle, Rectangle).
- **Virtual Camera & Pan-Tilt Dynamics**: $640 \times 480$ Monochrome Focal Plane Array (FPA) sensor feed at $\ge 30\text{ Hz}$, $4.0^\circ \times 3.0^\circ$ FOV, slew-rate limited gimbal repositioning ($5\text{–}10^\circ/\text{s}$, update rate $\ge 20\text{ Hz}$).
- **Disturbance & Noise Engine**: Real pixel-level injection of Salt & Pepper noise ($\sim 10\%$), Gaussian noise ($\text{SD} \le 20\text{ px}$), Poisson shot noise, Camera Jitter (max $\pm 20\text{ px/frame}$), Atmospheric attenuation (Clear, Haze, Fog, Rain, Low Light) with contrast/brightness degradation, and Platform Motion ($\pm 20\text{ px/frame}$).
- **Computer Vision & Tracking Pipeline**: Adaptive thresholding, morphological outlier rejection, sub-pixel Intensity-Weighted Center of Gravity (IW-CoG) centroiding, and discrete state machine (`SEARCHING`, `DETECTED`, `ACQUIRING`, `LOCKED`, `LOST`, `RE-ACQUIRING`).
- **Benchmark-1 (Scenario Testing)**: Predefined and evaluator custom scenarios, batch execution, frame-by-frame error logging, and performance reports.
- **Benchmark-2 (External MP4 Video Bypass)**: Evaluator `.mp4` video input @ 30 FPS with physical PTZ bypass, frame extraction, centroiding, and RMSE calculation against reference data.
- **Automated Performance Logging & Reports**: Exports official `PS-26169 Performance Reports` with configuration snapshots, PRNG seeds, measured metrics, CSV telemetry logs, and PDF/Print views.

---

## System Architecture

```text
                  ┌──────────────────────────────────────────────┐
                  │            ENGINEERING WORKSTATION           │
                  │ HTML5 / CSS3 / ES6 (PySide6 WebEngine Shell) │
                  └──────────────────────┬───────────────────────┘
                                         │
                                  SimulationState
                                    (state.js)
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            │                            │                            │
    Virtual Environment            Target Engine                Camera Engine
    (2000×2000 px world)      (4 Req + 3 Opt Motions)      (640×480 Monochrome FPA)
            │                            │                            │
            └────────────────────────────┼────────────────────────────┘
                                         │
                                 Disturbance Engine
                       (S&P, Gaussian, Poisson, Jitter,
                        Atmosphere contrast/brightness,
                               Platform Motion)
                                         │
                                         ▼
                                Camera Sensor Frame
                                         │
                                         ▼
                             Detector Interface
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         Classical CV Detector                           AI Detector
     (Adaptive Threshold + IW-CoG)                    (Extensible Slot)
                 │
                 ▼
          Beacon Centroid (x_det, y_det)
                 │
                 ▼
          Tracking Module & State Machine
        (SEARCHING / DETECTED / ACQUIRING / LOCKED / LOST / RE-ACQUIRING)
                 │
                 ▼
         Error Computation
    ┌────────────┴────────────┐
    ▼                         ▼
Centroiding Error       Pointing Error
(vs Ground Truth)     (vs Camera Center)
    │                         │
    │                         ▼
    │               Pan/Tilt Controller
    │         (Independent Pan/Tilt Slew Limits)
    │                         │
    │                         ▼
    │                  Camera Recenter
    │                         │
    └────────────┬────────────┘
                 ▼
         Telemetry & Metrics
```

---

## Quick Start Guide

### 1. Installation
```bash
git clone https://github.com/geethika-sandireddy/Fsoc.git
cd Fsoc
pip install -r requirements.txt
```

### 2. Launch Desktop Application
- **Windows**: Double-click `run_app.bat` or run:
  ```bash
  python main.py
  ```
- **Browser Mode**:
  ```bash
  python -m http.server 8000
  ```
  Navigate to `http://localhost:8000/index.html`.

---

## Running Verification Tests
Execute the independent mathematical test suite:
```bash
python tests/test_pipeline.py
```

---

## Deliverables & Documentation

- [Technical Report](docs/technical_report.md)
- [User Manual](docs/user_manual.md)
- [Requirements Traceability Matrix](docs/requirements_traceability.md)
