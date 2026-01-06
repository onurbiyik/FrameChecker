/**
 * Main Application Script - Coordinates camera and frame detection
 */

let cameraManager;
let frameDetector;
let sensorManager;
let isRunning = false;
let animationFrameId = null;
let openCvReady = false;
let lastProcessTime = 0;
const MIN_PROCESS_INTERVAL = 33; // Minimum 33ms between frames (~30fps max)

// DOM elements
const videoElement = document.getElementById('videoElement');
const canvasOutput = document.getElementById('canvasOutput');
const cameraSelect = document.getElementById('cameraSelect');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const enableSensorsBtn = document.getElementById('enableSensorsBtn');
const useBackCameraCheckbox = document.getElementById('useBackCamera');
const sensitivitySlider = document.getElementById('sensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');
const statusText = document.getElementById('statusText');
const framesDetectedText = document.getElementById('framesDetected');

/**
 * Initialize the application
 */
async function initApp() {
    // Check camera support
    if (!CameraManager.isSupported()) {
        updateStatus('Camera access is not supported in this browser.', 'error');
        startBtn.disabled = true;
        return;
    }

    // Initialize camera manager
    cameraManager = new CameraManager();
    frameDetector = new FrameDetector();
    sensorManager = new SensorManager();

    // Check sensor support and show info
    if (sensorManager.isSupported) {
        console.log('Device sensors supported');
        
        // On iOS 13+, show enable sensors button
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            enableSensorsBtn.style.display = 'inline-block';
            updateStatus('Ready. Click "Enable Sensors" for enhanced accuracy (iOS).', 'success');
        } else {
            updateStatus('Ready. Device sensors available for enhanced accuracy.', 'success');
        }
    } else {
        console.log('Device sensors not supported - using camera-only detection');
    }

    try {
        // Get available cameras
        const cameras = await cameraManager.init(videoElement);
        populateCameraSelect(cameras);
        
        updateStatus('Ready to start. Click "Start Camera" to begin.', 'success');
    } catch (error) {
        updateStatus(`Error initializing: ${error.message}`, 'error');
        console.error('Initialization error:', error);
    }

    // Set up event listeners
    setupEventListeners();
}

/**
 * Populate camera select dropdown
 */
function populateCameraSelect(cameras) {
    cameraSelect.innerHTML = '';
    
    if (cameras.length === 0) {
        cameraSelect.innerHTML = '<option value="">No cameras found</option>';
        startBtn.disabled = true;
        return;
    }

    cameras.forEach((camera, index) => {
        const option = document.createElement('option');
        option.value = camera.deviceId;
        option.textContent = camera.label || `Camera ${index + 1}`;
        cameraSelect.appendChild(option);
    });

    startBtn.disabled = false;
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    startBtn.addEventListener('click', startDetection);
    stopBtn.addEventListener('click', stopDetection);
    enableSensorsBtn.addEventListener('click', requestSensorPermission);
    
    cameraSelect.addEventListener('change', async (e) => {
        if (isRunning) {
            try {
                const facingMode = useBackCameraCheckbox.checked ? 'environment' : 'user';
                await cameraManager.switchCamera(e.target.value);
                updateStatus('Camera switched successfully.', 'success');
            } catch (error) {
                updateStatus(`Error switching camera: ${error.message}`, 'error');
            }
        }
    });
    
    useBackCameraCheckbox.addEventListener('change', async (e) => {
        if (isRunning) {
            // Restart camera with new facing mode
            try {
                await cameraManager.stopCamera();
                const facingMode = e.target.checked ? 'environment' : 'user';
                await cameraManager.startCamera(null, facingMode);
                await waitForVideoReady();
                updateStatus('Camera switched successfully.', 'success');
            } catch (error) {
                updateStatus(`Error switching camera: ${error.message}`, 'error');
            }
        }
    });

    sensitivitySlider.addEventListener('input', (e) => {
        const value = e.target.value;
        sensitivityValue.textContent = value;
        frameDetector.setSensitivity(parseInt(value));
    });
}

/**
 * Request sensor permission (iOS 13+)
 */
async function requestSensorPermission() {
    try {
        updateStatus('Requesting sensor permission...', 'info');
        const granted = await sensorManager.requestPermission();
        
        if (granted) {
            enableSensorsBtn.style.display = 'none';
            updateStatus('Sensor permission granted! Sensors will activate when camera starts.', 'success');
        } else {
            updateStatus('Sensor permission denied. App will work in camera-only mode.', 'info');
        }
    } catch (error) {
        updateStatus(`Sensor permission error: ${error.message}`, 'error');
        console.error('Sensor permission error:', error);
    }
}

/**
 * Start camera and detection
 */
async function startDetection() {
    try {
        updateStatus('Starting camera...', 'info');
        
        // Determine camera to use
        const deviceId = cameraSelect.value;
        const facingMode = useBackCameraCheckbox.checked ? 'environment' : 'user';
        
        // Start camera with facing mode preference
        if (deviceId) {
            await cameraManager.startCamera(deviceId);
        } else {
            await cameraManager.startCamera(null, facingMode);
        }
        
        // Try to start sensors if supported and not already started
        if (sensorManager.isSupported && !sensorManager.isActiveAndReady()) {
            try {
                const sensorStarted = await sensorManager.start();
                if (sensorStarted) {
                    console.log('Device sensors activated');
                    frameDetector.enableSensorFusion(sensorManager);
                    updateStatus('Camera and sensors active!', 'success');
                    if (enableSensorsBtn) {
                        enableSensorsBtn.style.display = 'none';
                    }
                } else {
                    console.log('Sensors not available - using camera-only mode');
                }
            } catch (error) {
                console.warn('Could not start sensors:', error.message);
                // Show enable button for iOS if permission issue
                if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                    enableSensorsBtn.style.display = 'inline-block';
                    updateStatus('Camera started. Click "Enable Sensors" for enhanced accuracy.', 'info');
                }
            }
        } else if (sensorManager.isActiveAndReady()) {
            // Sensors already active
            frameDetector.enableSensorFusion(sensorManager);
            console.log('Using existing sensor connection');
        }
        
        // Wait for video to have valid dimensions
        await waitForVideoReady();
        
        isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        cameraSelect.disabled = false;
        
        updateStatus('Detection running. Point camera at picture frames.', 'success');
        
        // Start detection loop
        processFrame();
    } catch (error) {
        updateStatus(`Error starting: ${error.message}`, 'error');
        console.error('Start error:', error);
    }
}

/**
 * Wait for video to be ready with valid dimensions
 */
function waitForVideoReady() {
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
            if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
                clearInterval(checkInterval);
                console.log(`Video ready: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                resolve();
            }
        }, 50);
        
        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(checkInterval);
            reject(new Error('Video failed to initialize properly'));
        }, 5000);
    });
}

/**
 * Stop camera and detection
 */
function stopDetection() {
    isRunning = false;
    
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    cameraManager.stopCamera();
    
    // Stop sensors
    if (sensorManager) {
        sensorManager.stop();
    }
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    cameraSelect.disabled = false;
    
    // Clear canvas
    const ctx = canvasOutput.getContext('2d');
    ctx.clearRect(0, 0, canvasOutput.width, canvasOutput.height);
    
    updateStatus('Detection stopped.', 'info');
    updateFrameCount(0);
}

/**
 * Process each video frame
 */
function processFrame() {
    if (!isRunning || !openCvReady) {
        return;
    }

    // Throttle processing to avoid performance issues
    const now = performance.now();
    if (now - lastProcessTime < MIN_PROCESS_INTERVAL) {
        animationFrameId = requestAnimationFrame(processFrame);
        return;
    }
    lastProcessTime = now;

    try {
        // Detect frames in current video frame
        const detectedFrames = frameDetector.detectFrames(videoElement, canvasOutput);
        
        // Update frame count and camera tilt info
        updateFrameCount(detectedFrames.length);
        updateCameraTiltInfo();
        updateSensorInfo();
        
    } catch (error) {
        console.error('Frame processing error:', error);
    }

    // Schedule next frame
    animationFrameId = requestAnimationFrame(processFrame);
}

/**
 * Update status text
 */
function updateStatus(message, type = 'info') {
    statusText.textContent = message;
    statusText.className = type;
}

/**
 * Update detected frames count
 */
function updateFrameCount(count) {
    framesDetectedText.textContent = `Frames detected: ${count}`;
}

/**
 * Update camera tilt compensation info
 */
function updateCameraTiltInfo() {
    const cameraTilt = frameDetector.getCameraTilt();
    if (Math.abs(cameraTilt) > 0.5) {
        const tiltInfo = ` | Camera: ${cameraTilt.toFixed(1)}° ${cameraTilt > 0 ? '↻' : '↺'}`;
        if (!framesDetectedText.textContent.includes('Camera:')) {
            framesDetectedText.textContent += tiltInfo;
        } else {
            // Update existing tilt info
            framesDetectedText.textContent = framesDetectedText.textContent.replace(
                /\| Camera:.*$/,
                tiltInfo
            );
        }
    }
}

/**
 * Update sensor fusion info
 */
function updateSensorInfo() {
    if (sensorManager && sensorManager.isActiveAndReady()) {
        const deviceTilt = sensorManager.getDeviceTilt();
        if (Math.abs(deviceTilt) > 0.5) {
            const sensorInfo = ` | Device: ${deviceTilt.toFixed(1)}°`;
            if (!framesDetectedText.textContent.includes('Device:')) {
                framesDetectedText.textContent += sensorInfo;
            } else {
                // Update existing sensor info
                framesDetectedText.textContent = framesDetectedText.textContent.replace(
                    /\| Device:.*?(\||$)/,
                    sensorInfo + '$1'
                );
            }
        }
    }
}

/**
 * Called when OpenCV.js is ready
 */
function onOpenCvReady() {
    openCvReady = true;
    console.log('OpenCV.js is ready');
    updateStatus('OpenCV loaded. Ready to start detection.', 'success');
}

/**
 * Called when OpenCV.js fails to load
 */
function onOpenCvError() {
    openCvReady = false;
    console.error('Failed to load OpenCV.js');
    updateStatus('Error: Failed to load OpenCV.js. Please refresh the page.', 'error');
    startBtn.disabled = true;
}

/**
 * Wait for OpenCV to load, then initialize
 */
function waitForOpenCV() {
    if (typeof cv !== 'undefined' && cv.Mat) {
        onOpenCvReady();
        initApp();
    } else {
        updateStatus('Loading OpenCV.js...', 'info');
        setTimeout(waitForOpenCV, 100);
    }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForOpenCV);
} else {
    waitForOpenCV();
}
