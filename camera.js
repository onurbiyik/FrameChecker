/**
 * Camera Manager - Handles camera access and device enumeration
 */

class CameraManager {
    constructor() {
        this.videoElement = null;
        this.currentStream = null;
        this.availableCameras = [];
    }

    /**
     * Initialize camera manager with video element
     */
    async init(videoElement) {
        this.videoElement = videoElement;
        await this.enumerateCameras();
        return this.availableCameras;
    }

    /**
     * Get list of all available video input devices
     */
    async enumerateCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.availableCameras = devices.filter(device => device.kind === 'videoinput');
            return this.availableCameras;
        } catch (error) {
            console.error('Error enumerating cameras:', error);
            throw new Error('Failed to enumerate cameras. Please ensure camera permissions are granted.');
        }
    }

    /**
     * Start camera with specified device ID or facing mode
     */
    async startCamera(deviceId = null, facingMode = null) {
        try {
            // Stop any existing stream
            this.stopCamera();

            const constraints = {
                video: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    facingMode: facingMode ? { ideal: facingMode } : undefined,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };
            
            // If no deviceId specified but facingMode is requested, remove deviceId constraint
            if (!deviceId && facingMode) {
                delete constraints.video.deviceId;
            }
            // If deviceId is specified, remove facingMode to avoid conflicts
            if (deviceId) {
                delete constraints.video.facingMode;
            }

            this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.currentStream;

            // Wait for video to be ready
            return new Promise((resolve, reject) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play();
                    resolve(this.currentStream);
                };
                this.videoElement.onerror = reject;
            });
        } catch (error) {
            console.error('Error starting camera:', error);
            throw new Error(`Failed to start camera: ${error.message}`);
        }
    }

    /**
     * Stop current camera stream
     */
    stopCamera() {
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => track.stop());
            this.currentStream = null;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
    }

    /**
     * Switch to a different camera
     */
    async switchCamera(deviceId) {
        return await this.startCamera(deviceId);
    }

    /**
     * Get current camera device info
     */
    getCurrentCamera() {
        if (!this.currentStream) return null;
        const track = this.currentStream.getVideoTracks()[0];
        return track ? track.getSettings() : null;
    }

    /**
     * Check if camera access is supported
     */
    static isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CameraManager;
}
