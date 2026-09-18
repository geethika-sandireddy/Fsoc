# FSOC Coarse PAT Console — SIH PS 26169 (ISRO)

Desktop mission-control application for virtual camera tracking / coarse alignment of mobile FSOC terminals.

## Run

```powershell
cd C:\Users\cse\Fsoc
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python src\main.py
```

## Operator surfaces

- Camera: world size, FPA type, resolution, FOV, ≥30 Hz, centre pose
- Target: beacon, count, shape, 5–20 px, init location, 7 motion profiles
- PTZ: pan/tilt 5–10 °/s, ≥20 Hz control, auto slew / manual
- Disturbances: salt-pepper, Gaussian, Poisson, jitter, atmosphere, platform motion
- Modes: simulation and MP4 video bypass
- Live KPIs + centroid error plot + performance log export
