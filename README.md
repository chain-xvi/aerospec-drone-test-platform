# AEROSPEC — Drone Manufacturing Test Platform

An industrial-HMI web console for drone certification: an open-jet wind-tunnel
test bay rendered in Three.js with four selectable airframes, four scripted
test programs, live telemetry, and a fleet operations dashboard.

## Run

Static site — no build step, no CDN dependencies at runtime (Three.js is vendored).

```bash
# after cloning, restore the 1.3 MB vendored three.module.js once:
bash scripts/fetch-vendor.sh

# then serve the repo root with any static server, e.g.
python3 -m http.server 8080
# open http://localhost:8080/
```

## Features

- **4 procedural airframes** — QX-4 Hornet (quad X), HX-6 Titan (hex),
  VX-8 Atlas (coaxial X8), FW-2 Dart (fixed-wing VTOL). Carbon twill,
  shaped 2-blade props with high-RPM blur discs, coaxial counter-rotation,
  nav LEDs, gimbals, decals. All geometry generated in code.
- **Wind tunnel** — particle flow field with jet shear layer, potential-flow
  deflection around the airframe, propwash churn, sin-curl turbulence and a
  travelling gust front. Measures drag, trim throttle and stability margin.
- **Speed stress** — full-throttle acceleration to target/VNE; motor
  temperature, bus sag and vibration envelope tracked against limits.
- **Structural load** — payload ramp with a live per-vertex stress heat-map
  (blue → chartreuse → amber → red), arm flex, strong-point markers and a
  slung payload rig.
- **Endurance** — accelerated hover draw-down with pack voltage sag,
  thermal rise and projected flight time.
- **Dashboard** — KPI cards with sparklines, peak-airspeed history,
  per-airframe structural margins, verdict donut, run register (CSV export).
  Run history persists in `localStorage` **of this browser only** — clearing
  browser data resets it (seeded baseline is restored).
- **Console** — E-STOP interlock, day/night lighting, playback time control
  (play / pause / step / scrub), units switching, particle density, camera
  presets, precision overlay.

## Structure

```
index.html        shell + panels
style.css         industrial HMI theme (dark, chartreuse accent)
main.js           bootstrap, UI wiring, render loop
js/data.js        airframe specs, physics model, run store
js/scene.js       renderer, test-bay / wind-tunnel geometry, materials
js/drones.js      procedural airframe factory + stress mapping
js/particles.js   wind-tunnel flow field
js/sims.js        test-program director (source of truth)
js/hud.js         gauges, channel chart, terminal
js/dashboard.js   dashboard rendering + CSV export
vendor/           three.module.js + helpers (MIT, threejs.org)
```

## License / credits

Three.js © three.js authors, MIT license (vendored in `vendor/`).
Everything else generated for this project; no external assets.
