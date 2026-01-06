# Quick Start Guide - Frame Checker with Sensor Fusion

## What's New?
Frame Checker now uses your device's built-in sensors (gyroscope/accelerometer) along with the camera to provide more accurate and stable tilt measurements, even when your hands are slightly shaky!

## How to Use

### On Mobile Devices (Recommended)
1. Open `index.html` in your mobile browser (Chrome/Safari)
2. Click **"Start Camera"**
3. On iOS, grant permission for motion sensors when prompted
4. Point camera at a picture frame on the wall
5. You'll see:
   - Green box = Frame is level (±2°)
   - Yellow box = Slight tilt (2-5°)
   - Red box = Significant tilt (>5°)
   - Exact tilt angle displayed on the frame

### Status Indicators
- **Green bar at top**: "Device: X° | Camera: Y° | Combined: Z°"
  - Means sensor fusion is ACTIVE - you're getting the most accurate readings!
  - Readings will be very stable despite hand movement
  
- **Orange bar at top**: "Camera Tilt: X° (auto-compensating)"
  - Means camera-only mode (no sensors available)
  - Still works great, just slightly less stable with hand shake

### Tips for Best Results
- ✅ **Hold phone normally** - natural hand shake is automatically filtered out
- ✅ **Good lighting** - helps camera detect frame edges
- ✅ **Clear view** - make sure the whole frame is visible
- ✅ **1-2 meters away** - optimal distance for detection
- ❌ Don't worry about holding perfectly still - that's the whole point!

## Testing Sensors

### Want to see the sensors in action?
1. Open `sensor-test.html` in your browser
2. Click "Start Sensors"
3. Tilt your device and watch:
   - Raw readings (jittery)
   - Smoothed readings (stable)
   - Visual tilt indicator
   - Real-time smoothing in action

### On Desktop
Desktop computers don't have orientation sensors, so the app runs in camera-only mode. This is normal and expected! The camera-based detection still works great.

## Troubleshooting

### "Sensors not available"
- **Desktop**: Normal! Desktops don't have orientation sensors
- **Mobile**: Check browser support (Chrome/Safari recommended)

### iOS Permission Dialog
- iOS 13+ requires explicit permission for motion sensors
- Click "Allow" when prompted
- If you denied it: Settings > Safari > Motion & Orientation Access

### Readings Still Jumpy
- Try adjusting the sensitivity slider (5 is default)
- Ensure good lighting
- Make sure the frame is clearly visible
- The smoothing takes ~1 second to stabilize after pointing at a new frame

### Green Bar Not Showing (Mobile)
- Sensor fusion might not have activated
- Try refreshing the page and starting again
- Check browser console for errors (F12)
- Some browsers may not support sensors

## How It Works (Simple Explanation)

1. **Camera** detects the frame edges and calculates if it's tilted
2. **Sensors** detect how your phone is tilted
3. **Smart Math** combines both:
   - Subtracts your phone's tilt from what the camera sees
   - Results in the frame's true tilt relative to gravity
4. **Smoothing** filters out hand shake:
   - Assumes frames don't move (correct!)
   - Averages multiple measurements
   - Ignores tiny movements

Result: Accurate frame tilt even with shaky hands! 🎯

## Privacy
- Everything runs locally in your browser
- No data is sent anywhere
- Sensors only provide orientation angles (not location or personal data)
- Camera stream never leaves your device

## Enjoy!
Point, detect, and level those frames! 📐✨
