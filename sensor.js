/**
 * Sensor Manager - Handles device orientation/gyroscope sensors
 * Provides smoothed device orientation data for tilt compensation
 */

class SensorManager {
    constructor() {
        this.isSupported = false;
        this.isPermissionGranted = false;
        this.isActive = false;
        
        // Raw sensor data
        this.deviceOrientation = {
            alpha: 0,  // Z-axis rotation (compass direction)
            beta: 0,   // X-axis rotation (front-to-back tilt)
            gamma: 0   // Y-axis rotation (left-to-right tilt)
        };
        
        // Smoothed sensor data using exponential moving average
        this.smoothedOrientation = {
            beta: 0,
            gamma: 0
        };
        
        // Smoothing configuration
        this.smoothingFactor = 0.15; // Lower = more smoothing, less responsive
        this.stabilizationThreshold = 0.3; // Minimum change to register (degrees)
        
        // Circular buffer for additional smoothing (rolling average)
        this.orientationBuffer = {
            beta: [],
            gamma: []
        };
        this.bufferSize = 10; // Number of readings to average
        
        // Deadband for stable reading (helps with minor hand shake)
        this.deadbandSize = 0.5; // degrees
        this.lastStableOrientation = { beta: 0, gamma: 0 };
        
        // Check support
        this.checkSupport();
    }

    /**
     * Check if device orientation sensors are supported
     */
    checkSupport() {
        // Check if DeviceOrientationEvent exists
        if (window.DeviceOrientationEvent) {
            this.isSupported = true;
            
            // iOS 13+ requires permission request
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                console.log('iOS device detected - permission required');
            } else {
                // Android and older iOS don't require permission
                this.isPermissionGranted = true;
            }
        } else {
            console.log('Device orientation API not supported');
        }
        
        return this.isSupported;
    }

    /**
     * Request permission for sensor access (required on iOS 13+)
     */
    async requestPermission() {
        if (!this.isSupported) {
            throw new Error('Device orientation sensors not supported');
        }

        // Check if permission is required (iOS 13+)
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                this.isPermissionGranted = (permissionState === 'granted');
                
                if (!this.isPermissionGranted) {
                    throw new Error('Device orientation permission denied');
                }
                
                console.log('Device orientation permission granted');
            } catch (error) {
                console.error('Error requesting orientation permission:', error);
                throw new Error(`Failed to get sensor permission: ${error.message}`);
            }
        } else {
            // No permission needed
            this.isPermissionGranted = true;
        }
        
        return this.isPermissionGranted;
    }

    /**
     * Start listening to device orientation events
     */
    async start() {
        if (!this.isSupported) {
            console.warn('Sensors not supported - skipping sensor initialization');
            return false;
        }

        if (!this.isPermissionGranted) {
            await this.requestPermission();
        }

        if (!this.isPermissionGranted) {
            return false;
        }

        // Start listening to orientation changes
        window.addEventListener('deviceorientation', this.handleOrientation.bind(this), true);
        this.isActive = true;
        
        console.log('Sensor manager started');
        return true;
    }

    /**
     * Stop listening to device orientation events
     */
    stop() {
        if (this.isActive) {
            window.removeEventListener('deviceorientation', this.handleOrientation.bind(this), true);
            this.isActive = false;
            console.log('Sensor manager stopped');
        }
    }

    /**
     * Handle device orientation event
     */
    handleOrientation(event) {
        if (!event || event.alpha === null) {
            return; // No valid data
        }

        // Store raw sensor data
        this.deviceOrientation = {
            alpha: event.alpha || 0,
            beta: event.beta || 0,
            gamma: event.gamma || 0
        };

        // Apply multi-stage smoothing
        this.applySmoothing();
    }

    /**
     * Apply multiple smoothing techniques to reduce jitter
     */
    applySmoothing() {
        const { beta, gamma } = this.deviceOrientation;

        // Stage 1: Add to circular buffer
        this.orientationBuffer.beta.push(beta);
        this.orientationBuffer.gamma.push(gamma);
        
        if (this.orientationBuffer.beta.length > this.bufferSize) {
            this.orientationBuffer.beta.shift();
            this.orientationBuffer.gamma.shift();
        }

        // Stage 2: Calculate rolling average
        const avgBeta = this.orientationBuffer.beta.reduce((a, b) => a + b, 0) / 
                       this.orientationBuffer.beta.length;
        const avgGamma = this.orientationBuffer.gamma.reduce((a, b) => a + b, 0) / 
                        this.orientationBuffer.gamma.length;

        // Stage 3: Apply exponential moving average
        if (this.smoothedOrientation.beta === 0 && this.smoothedOrientation.gamma === 0) {
            // First reading - initialize
            this.smoothedOrientation.beta = avgBeta;
            this.smoothedOrientation.gamma = avgGamma;
        } else {
            // EMA: smoothed = (alpha * new) + ((1 - alpha) * old)
            this.smoothedOrientation.beta = 
                (this.smoothingFactor * avgBeta) + 
                ((1 - this.smoothingFactor) * this.smoothedOrientation.beta);
            
            this.smoothedOrientation.gamma = 
                (this.smoothingFactor * avgGamma) + 
                ((1 - this.smoothingFactor) * this.smoothedOrientation.gamma);
        }

        // Stage 4: Apply deadband to create stable zones
        this.applyDeadband();
    }

    /**
     * Apply deadband to prevent micro-movements from causing updates
     */
    applyDeadband() {
        const betaDiff = Math.abs(this.smoothedOrientation.beta - this.lastStableOrientation.beta);
        const gammaDiff = Math.abs(this.smoothedOrientation.gamma - this.lastStableOrientation.gamma);

        // Only update stable orientation if change exceeds deadband
        if (betaDiff > this.deadbandSize) {
            this.lastStableOrientation.beta = this.smoothedOrientation.beta;
        }
        
        if (gammaDiff > this.deadbandSize) {
            this.lastStableOrientation.gamma = this.smoothedOrientation.gamma;
        }
    }

    /**
     * Get device tilt relative to gravity (combines beta and gamma)
     * Returns the tilt angle that affects how we see vertical lines
     */
    getDeviceTilt() {
        if (!this.isActive || !this.isPermissionGranted) {
            return 0;
        }

        // Use stable (deadbanded) orientation
        const { beta, gamma } = this.lastStableOrientation;

        // For most camera viewing angles, gamma (left-right tilt) is what matters
        // When holding phone in portrait mode to view a wall:
        // - gamma represents the phone's roll (rotation around viewing axis)
        // - This directly affects how vertical lines appear
        
        // Normalize gamma to -90 to 90 range (typical holding range)
        let normalizedGamma = gamma;
        
        // Handle different phone orientations
        // When phone is held vertically (portrait), gamma is primary
        // When phone is tilted forward/back significantly, beta matters more
        
        if (Math.abs(beta) < 45) {
            // Phone mostly upright - use gamma
            return normalizedGamma;
        } else {
            // Phone tilted forward/back significantly
            // Use a combination weighted by how vertical the phone is
            const verticalFactor = Math.abs(Math.cos(beta * Math.PI / 180));
            return gamma * verticalFactor;
        }
    }

    /**
     * Get raw orientation data (for debugging)
     */
    getRawOrientation() {
        return { ...this.deviceOrientation };
    }

    /**
     * Get smoothed orientation data (for debugging)
     */
    getSmoothedOrientation() {
        return { ...this.smoothedOrientation };
    }

    /**
     * Get stable (deadbanded) orientation data
     */
    getStableOrientation() {
        return { ...this.lastStableOrientation };
    }

    /**
     * Check if sensors are actively providing data
     */
    isActiveAndReady() {
        return this.isActive && this.isPermissionGranted;
    }

    /**
     * Set smoothing factor (0.0 to 1.0)
     * Lower = more smoothing, higher = more responsive
     */
    setSmoothingFactor(factor) {
        this.smoothingFactor = Math.max(0.01, Math.min(1.0, factor));
    }
    
    /**
     * Set smoothing level (1-10 scale, user-friendly)
     * 1 = maximum smoothing (most stable, less responsive)
     * 10 = minimum smoothing (most responsive, less stable)
     */
    setSmoothingLevel(level) {
        level = Math.max(1, Math.min(10, level));
        
        // Convert 1-10 scale to appropriate parameters
        // Level 1 (max smoothing): factor=0.05, buffer=15, deadband=1.0
        // Level 5 (balanced): factor=0.15, buffer=10, deadband=0.5
        // Level 10 (min smoothing): factor=0.4, buffer=5, deadband=0.2
        
        this.smoothingFactor = 0.05 + (level - 1) * 0.039; // 0.05 to 0.4
        this.bufferSize = Math.round(20 - (level - 1) * 1.67); // 20 to 5
        this.deadbandSize = 1.2 - (level - 1) * 0.11; // 1.2 to 0.2
        
        console.log(`Smoothing level ${level}: factor=${this.smoothingFactor.toFixed(3)}, buffer=${this.bufferSize}, deadband=${this.deadbandSize.toFixed(2)}`);
    }

    /**
     * Set deadband size in degrees
     */
    setDeadbandSize(size) {
        this.deadbandSize = Math.max(0, size);
    }

    /**
     * Reset all smoothing buffers (useful when restarting)
     */
    reset() {
        this.orientationBuffer.beta = [];
        this.orientationBuffer.gamma = [];
        this.smoothedOrientation = { beta: 0, gamma: 0 };
        this.lastStableOrientation = { beta: 0, gamma: 0 };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SensorManager;
}
