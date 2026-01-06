# Frame Checker - AI Coding Agent Instructions

## Project Overview
Real-time web application for detecting picture frame tilt using WebRTC, OpenCV.js, and device sensors. Uses sensor fusion to combine camera-based computer vision with gyroscope/accelerometer data for accurate, stable tilt measurements.

## Architecture

### Core Components (4 modules)
- **app.js** - Main orchestrator, coordinates all modules and UI
- **camera.js** - CameraManager class, handles WebRTC video streams
- **detector.js** - FrameDetector class, OpenCV.js-based computer vision
- **sensor.js** - SensorManager class, device orientation sensors

### Data Flow
1. Camera → video element → detector processes frames with OpenCV.js
2. Sensors → SensorManager → smoothed orientation data
3. Detector combines both via sensor fusion (70% sensor / 30% camera)
4. app.js displays results and manages UI state

### Key Design Patterns
- **Module Pattern**: Each component is a standalone class with clear API
- **Singleton Instances**: `cameraManager`, `frameDetector`, `sensorManager` instantiated once in app.js
- **Graceful Degradation**: Sensors optional, falls back to camera-only mode
- **Multi-Stage Smoothing**: See anti-shake implementation below

## Critical Implementation Details

### Sensor Fusion Algorithm
Located in [detector.js](detector.js#L80-L95):
```javascript
this.fusedTilt = this.deviceTilt * 0.7 + this.cameraTilt * 0.3;
```
Device sensors (70%) prioritized for device orientation. Camera detection (30%) for environmental features.

### Anti-Shake Technology (Multi-Stage Smoothing)
1. **Sensor Smoothing** [sensor.js](sensor.js): Rolling average buffer (10 readings) + EMA + deadband (0.5°)
2. **Frame Stability Tracking** [detector.js](detector.js): Assumes frames don't move, maintains history per frame (frameId), weighted average of up to 10 measurements
3. **Adjustable Smoothing**: `setSmoothingLevel(1-10)` in both sensor.js and detector.js

### Frame Tracking with IDs
Detector uses `frameStabilityBuffer` (Map) with generated frameIds based on position/size to track same frame across frames and average tilt measurements over time.

### iOS Sensor Permission
iOS 13+ requires explicit permission via `DeviceOrientationEvent.requestPermission()`. Button shown conditionally, handled in [app.js](app.js#L50-L60).

## Development Workflow

### Running Locally
**PowerShell Server** (Windows preferred):
```powershell
.\server.ps1
```
Starts HTTP server on port 8000 with port conflict detection.

**Alternative methods** (Python/Node.js documented in README):
```bash
python -m http.server 8000
```

### Testing Pages
- `index.html` - Main application
- `camera-test.html` - Camera enumeration test
- `sensor-test.html` - Sensor debugging (shows raw/smoothed orientation)

### OpenCV.js Dependency
Loaded via CDN in index.html. Check `openCvReady` flag before processing. No local build required.

## Project Conventions

### File Naming
- Lowercase with hyphens: `sensor-test.html`
- Single-purpose modules: `camera.js`, `detector.js`, `sensor.js`

### Code Structure
- Classes use PascalCase: `CameraManager`, `FrameDetector`, `SensorManager`
- Global instances use camelCase: `cameraManager`, `frameDetector`
- Methods have JSDoc comments with description

### UI Patterns
- Color-coded feedback: GREEN (±2°), YELLOW (2°-5°), RED (>5°)
- Sliders with live value display
- Buttons disabled/enabled based on state (e.g., Stop button disabled until camera starts)

### Error Handling
- Try-catch blocks in async camera/sensor operations
- `updateStatus(message, type)` for user-facing errors
- Graceful fallbacks (e.g., sensor fusion → camera-only)

## Common Tasks

### Adding New Detection Features
1. Modify `detectFrames()` in [detector.js](detector.js)
2. OpenCV operations: Use cv.Mat lifecycle (create → process → delete)
3. Update `drawResults()` for visualization
4. Cleanup: Always call `.delete()` on cv.Mat objects to prevent memory leaks

### Adjusting Smoothing Parameters
- Sensor: `smoothingFactor`, `bufferSize`, `deadbandSize` in [sensor.js](sensor.js#L24-L34)
- Frame: `frameStabilityWindow` in [detector.js](detector.js#L23)
- Both exposed via `setSmoothingLevel()` methods

### UI Changes
- Update controls in [index.html](index.html)
- Style in [styles.css](styles.css)
- Wire up event listeners in `setupEventListeners()` in [app.js](app.js)

## Important Notes

- **Browser Compatibility**: Requires WebRTC (camera) and potentially DeviceOrientationEvent (sensors)
- **OpenCV Memory**: Always `.delete()` cv.Mat objects after use
- **Frame Processing**: Throttled to ~30fps via MIN_PROCESS_INTERVAL
- **Snapshot Feature**: Uses canvas.toBlob() to download PNG with annotations
- **Documentation**: Update [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for significant changes, not README