/**
 * Frame Detector - Detects picture frames and analyzes their alignment
 * Uses OpenCV.js for computer vision processing
 */

class FrameDetector {
    constructor() {
        this.isProcessing = false;
        this.sensitivity = 5; // 1-10 scale
        this.minContourArea = 5000; // Minimum area for a valid frame
        this.lastDetectedFrames = [];
        this.cameraTilt = 0; // Detected camera tilt compensation
        this.environmentalVerticals = []; // Reference vertical lines from environment
        
        // Sensor fusion
        this.sensorManager = null;
        this.useSensorFusion = false;
        this.deviceTilt = 0; // Device tilt from sensors
        this.fusedTilt = 0; // Combined camera + sensor tilt
        
        // Frame stability tracking (to smooth frame tilt measurements)
        this.frameStabilityBuffer = new Map(); // frameId -> tilt history
        this.frameStabilityWindow = 10; // Number of measurements to average
    }

    /**
     * Enable sensor fusion with device orientation
     */
    enableSensorFusion(sensorManager) {
        this.sensorManager = sensorManager;
        this.useSensorFusion = true;
        console.log('Sensor fusion enabled');
    }

    /**
     * Disable sensor fusion
     */
    disableSensorFusion() {
        this.useSensorFusion = false;
        this.sensorManager = null;
        console.log('Sensor fusion disabled');
    }

    /**
     * Process video frame to detect picture frames
     */
    detectFrames(videoElement, canvasElement) {
        if (this.isProcessing || typeof cv === 'undefined') {
            return this.lastDetectedFrames;
        }

        // Check if video has valid dimensions
        if (!videoElement.videoWidth || !videoElement.videoHeight || 
            videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
            return this.lastDetectedFrames;
        }

        this.isProcessing = true;
        const detectedFrames = [];

        try {
            // Capture frame directly to canvas first
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = videoElement.videoWidth;
            tempCanvas.height = videoElement.videoHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(videoElement, 0, 0, tempCanvas.width, tempCanvas.height);
            
            // Create OpenCV mat from canvas
            const src = cv.imread(tempCanvas);

            // First, detect environmental reference lines (walls, door frames, etc.)
            this.detectEnvironmentalVerticals(src);
            
            // Get device orientation if available
            if (this.useSensorFusion && this.sensorManager && this.sensorManager.isActiveAndReady()) {
                this.deviceTilt = this.sensorManager.getDeviceTilt();
                // Combine camera tilt detection with sensor data
                // Sensor data is more reliable for overall device orientation
                // Camera detection is better for detecting wall verticals
                this.fusedTilt = this.deviceTilt * 0.7 + this.cameraTilt * 0.3;
            } else {
                // No sensor data - use camera detection only
                this.fusedTilt = this.cameraTilt;
            }

            // Convert to grayscale
            const gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Apply Gaussian blur to reduce noise
            const blurred = new cv.Mat();
            const ksize = new cv.Size(5, 5);
            cv.GaussianBlur(gray, blurred, ksize, 0);

            // Edge detection using Canny
            const edges = new cv.Mat();
            const threshold1 = 50 - (this.sensitivity * 3);
            const threshold2 = 150 - (this.sensitivity * 5);
            cv.Canny(blurred, edges, threshold1, threshold2);

            // Dilate edges to close gaps
            const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
            const dilated = new cv.Mat();
            cv.dilate(edges, dilated, kernel);

            // Find contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            // Process each contour
            for (let i = 0; i < contours.size(); i++) {
                const contour = contours.get(i);
                const area = cv.contourArea(contour);

                // Filter by area (adjust minimum based on sensitivity)
                const minArea = this.minContourArea / (this.sensitivity / 5);
                if (area < minArea) {
                    continue;
                }

                // Approximate contour to polygon
                const approx = new cv.Mat();
                const peri = cv.arcLength(contour, true);
                cv.approxPolyDP(contour, approx, 0.02 * peri, true);

                // Look for quadrilaterals (4 corners)
                if (approx.rows >= 4) {
                    // Get the 4 corner points
                    const corners = this.getCorners(approx);
                    
                    if (corners.length >= 4) {
                        // Get bounding rectangle
                        const rect = cv.boundingRect(approx);
                        
                        // Calculate aspect ratio to filter out unlikely frames
                        const aspectRatio = rect.width / rect.height;
                        if (aspectRatio > 0.3 && aspectRatio < 3.0) {
                            // Calculate tilt by analyzing the vertical edges
                            const rawTilt = this.calculateFrameTilt(corners);
                            
                            // Apply compensation using fused tilt (camera + sensors)
                            const compensatedTilt = rawTilt - this.fusedTilt;
                            
                            // Create a frame ID based on position for stability tracking
                            const frameId = `${Math.round(rect.x / 50)}_${Math.round(rect.y / 50)}`;
                            
                            // Apply temporal smoothing to frame tilt
                            const stabilizedTilt = this.stabilizeFrameTilt(frameId, compensatedTilt);
                            
                            detectedFrames.push({
                                rect: rect,
                                tilt: stabilizedTilt,
                                rawTilt: rawTilt,
                                compensatedTilt: compensatedTilt,
                                area: area,
                                corners: corners,
                                frameId: frameId
                            });
                        }
                    }
                }

                approx.delete();
            }

            // Draw results on canvas
            this.drawResults(src, detectedFrames, canvasElement);

            // Cleanup
            src.delete();
            gray.delete();
            blurred.delete();
            edges.delete();
            dilated.delete();
            kernel.delete();
            contours.delete();
            hierarchy.delete();

            this.lastDetectedFrames = detectedFrames;
        } catch (error) {
            console.error('Error in frame detection:', error);
        } finally {
            this.isProcessing = false;
        }

        return detectedFrames;
    }

    /**
     * Get corner points from contour
     */
    getCorners(approx) {
        const corners = [];
        for (let i = 0; i < Math.min(approx.rows, 10); i++) {
            corners.push({
                x: approx.data32S[i * 2],
                y: approx.data32S[i * 2 + 1]
            });
        }
        return corners;
    }

    /**
     * Calculate frame tilt by analyzing vertical edges
     * This works even when viewing the wall at an angle (perspective)
     */
    calculateFrameTilt(corners) {
        if (corners.length < 4) return 0;

        // Sort corners to identify them: top-left, top-right, bottom-right, bottom-left
        const sorted = this.sortCorners(corners.slice(0, 4));
        
        // Calculate angles of the left and right edges relative to vertical
        const leftEdgeAngle = this.calculateEdgeAngle(sorted.topLeft, sorted.bottomLeft);
        const rightEdgeAngle = this.calculateEdgeAngle(sorted.topRight, sorted.bottomRight);
        
        // Average the two edge angles to get overall tilt
        // If frame is tilted, both edges should show similar deviation from vertical
        const avgTilt = (leftEdgeAngle + rightEdgeAngle) / 2;
        
        // Also check if edges are parallel (difference should be small for a flat frame)
        const parallelDiff = Math.abs(leftEdgeAngle - rightEdgeAngle);
        
        // If edges aren't parallel, the frame might be viewed at extreme angle
        // In this case, use the more vertical edge
        if (parallelDiff > 5) {
            return Math.abs(leftEdgeAngle) < Math.abs(rightEdgeAngle) ? leftEdgeAngle : rightEdgeAngle;
        }
        
        return avgTilt;
    }

    /**
     * Sort 4 corners into top-left, top-right, bottom-right, bottom-left
     */
    sortCorners(corners) {
        // Find center point
        const centerX = corners.reduce((sum, c) => sum + c.x, 0) / corners.length;
        const centerY = corners.reduce((sum, c) => sum + c.y, 0) / corners.length;
        
        // Classify corners based on position relative to center
        let topLeft = null, topRight = null, bottomLeft = null, bottomRight = null;
        
        corners.forEach(corner => {
            if (corner.x < centerX && corner.y < centerY) {
                topLeft = corner;
            } else if (corner.x >= centerX && corner.y < centerY) {
                topRight = corner;
            } else if (corner.x < centerX && corner.y >= centerY) {
                bottomLeft = corner;
            } else {
                bottomRight = corner;
            }
        });
        
        // Fallback if classification failed
        if (!topLeft || !topRight || !bottomLeft || !bottomRight) {
            const sorted = corners.sort((a, b) => a.y - b.y);
            const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
            const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
            
            return {
                topLeft: top[0],
                topRight: top[1],
                bottomLeft: bottom[0],
                bottomRight: bottom[1]
            };
        }
        
        return { topLeft, topRight, bottomLeft, bottomRight };
    }

    /**
     * Calculate angle of an edge relative to vertical (0° = perfectly vertical)
     * Positive angle = tilted clockwise, Negative = tilted counter-clockwise
     */
    calculateEdgeAngle(topPoint, bottomPoint) {
        const dx = bottomPoint.x - topPoint.x;
        const dy = bottomPoint.y - topPoint.y;
        
        // Calculate angle from vertical (not horizontal)
        // atan2 gives angle from horizontal, so we subtract from 90°
        const angleFromHorizontal = Math.atan2(dy, dx) * (180 / Math.PI);
        
        // Convert to angle from vertical
        // 90° means horizontal, 0° means vertical
        let angleFromVertical = angleFromHorizontal - 90;
        
        // Normalize to -90 to 90 range
        if (angleFromVertical > 90) angleFromVertical -= 180;
        if (angleFromVertical < -90) angleFromVertical += 180;
        
        return angleFromVertical;
    }

    /**
     * Detect environmental vertical lines (walls, door frames, etc.) to establish true vertical
     * This compensates for camera tilt
     */
    detectEnvironmentalVerticals(src) {
        try {
            // Convert to grayscale
            const gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            // Apply Gaussian blur
            const blurred = new cv.Mat();
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

            // Detect edges with Canny
            const edges = new cv.Mat();
            cv.Canny(blurred, edges, 50, 150);

            // Use Hough Line Transform to detect long straight lines
            const lines = new cv.Mat();
            // Parameters: rho, theta, threshold, minLineLength, maxLineGap
            cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 100, src.rows * 0.3, 20);

            // Analyze detected lines to find vertical ones
            const verticalAngles = [];
            
            for (let i = 0; i < lines.rows; i++) {
                const x1 = lines.data32S[i * 4];
                const y1 = lines.data32S[i * 4 + 1];
                const x2 = lines.data32S[i * 4 + 2];
                const y2 = lines.data32S[i * 4 + 3];

                // Calculate line length and angle
                const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
                const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
                
                // Convert to angle from vertical
                let angleFromVertical = angle - 90;
                if (angleFromVertical > 90) angleFromVertical -= 180;
                if (angleFromVertical < -90) angleFromVertical += 180;

                // Keep lines that are mostly vertical (within 30° of vertical)
                // and are reasonably long (likely architectural features)
                if (Math.abs(angleFromVertical) < 30 && length > src.rows * 0.2) {
                    // Weight by length - longer lines are more reliable
                    const weight = length / src.rows;
                    verticalAngles.push({
                        angle: angleFromVertical,
                        weight: weight,
                        length: length
                    });
                }
            }

            // Calculate weighted average of vertical angles to determine camera tilt
            if (verticalAngles.length > 0) {
                // Sort by length and take top candidates
                verticalAngles.sort((a, b) => b.length - a.length);
                const topCandidates = verticalAngles.slice(0, Math.min(5, verticalAngles.length));

                const totalWeight = topCandidates.reduce((sum, v) => sum + v.weight, 0);
                const weightedSum = topCandidates.reduce((sum, v) => sum + v.angle * v.weight, 0);
                
                this.cameraTilt = weightedSum / totalWeight;
                
                // Smooth camera tilt over time to reduce jitter
                // Use exponential moving average
                if (this.lastCameraTilt !== undefined) {
                    this.cameraTilt = this.lastCameraTilt * 0.7 + this.cameraTilt * 0.3;
                }
                this.lastCameraTilt = this.cameraTilt;
            } else {
                // No reliable verticals found, gradually return to no compensation
                if (this.lastCameraTilt !== undefined) {
                    this.cameraTilt = this.lastCameraTilt * 0.9;
                    this.lastCameraTilt = this.cameraTilt;
                }
            }

            // Cleanup
            gray.delete();
            blurred.delete();
            edges.delete();
            lines.delete();

        } catch (error) {
            console.error('Error detecting environmental verticals:', error);
            // On error, keep previous camera tilt value
        }
    }

    /**
     * Stabilize frame tilt measurement over time
     * Frames on walls don't move, so we can heavily smooth the measurements
     */
    stabilizeFrameTilt(frameId, tilt) {
        // Get or create history for this frame
        if (!this.frameStabilityBuffer.has(frameId)) {
            this.frameStabilityBuffer.set(frameId, []);
        }
        
        const history = this.frameStabilityBuffer.get(frameId);
        history.push(tilt);
        
        // Keep only recent measurements
        if (history.length > this.frameStabilityWindow) {
            history.shift();
        }
        
        // Calculate weighted average (recent measurements have more weight)
        let weightedSum = 0;
        let totalWeight = 0;
        
        for (let i = 0; i < history.length; i++) {
            // More recent measurements get higher weight
            const weight = (i + 1) / history.length;
            weightedSum += history[i] * weight;
            totalWeight += weight;
        }
        
        const stabilizedTilt = weightedSum / totalWeight;
        
        // Clean up old frame buffers (if we have too many)
        if (this.frameStabilityBuffer.size > 50) {
            // Remove oldest entries
            const entries = Array.from(this.frameStabilityBuffer.entries());
            entries.sort((a, b) => b[1].length - a[1].length);
            
            // Keep only the 20 most active frames
            const toKeep = entries.slice(0, 20);
            this.frameStabilityBuffer.clear();
            toKeep.forEach(([id, hist]) => this.frameStabilityBuffer.set(id, hist));
        }
        
        return stabilizedTilt;
    }

    /**
     * Get current camera tilt compensation value
     */
    getCameraTilt() {
        return this.cameraTilt;
    }

    /**
     * Get fused tilt (camera + sensor)
     */
    getFusedTilt() {
        return this.fusedTilt;
    }

    /**
     * Check if sensor fusion is active
     */
    isSensorFusionActive() {
        return this.useSensorFusion && 
               this.sensorManager && 
               this.sensorManager.isActiveAndReady();
    }

    /**
     * Draw detection results on canvas
     */
    drawResults(src, frames, canvasElement) {
        const ctx = canvasElement.getContext('2d');
        
        // Set canvas size to match source image dimensions
        if (canvasElement.width !== src.cols || canvasElement.height !== src.rows) {
            canvasElement.width = src.cols;
            canvasElement.height = src.rows;
        }

        // Draw the source image
        cv.imshow(canvasElement, src);

        // Draw each detected frame
        frames.forEach((frame, index) => {
            const { rect, tilt, rawTilt } = frame;
            
            // Determine color based on tilt angle (compensated tilt)
            let color, status;
            const absTilt = Math.abs(tilt);
            
            if (absTilt <= 2) {
                color = '#00ff00'; // Green - perfect
                status = 'Perfect';
            } else if (absTilt <= 5) {
                color = '#ffff00'; // Yellow - slight tilt
                status = 'Slight tilt';
            } else {
                color = '#ff0000'; // Red - significant tilt
                status = 'Tilted';
            }

            // Draw polygon around frame using actual corners for proper perspective
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            
            if (frame.corners && frame.corners.length >= 4) {
                // Sort corners to draw them in proper order
                const sorted = this.sortCorners(frame.corners.slice(0, 4));
                
                // Draw polygon connecting the corners
                ctx.beginPath();
                ctx.moveTo(sorted.topLeft.x, sorted.topLeft.y);
                ctx.lineTo(sorted.topRight.x, sorted.topRight.y);
                ctx.lineTo(sorted.bottomRight.x, sorted.bottomRight.y);
                ctx.lineTo(sorted.bottomLeft.x, sorted.bottomLeft.y);
                ctx.closePath();
                ctx.stroke();
                
                // Also fill with semi-transparent color for better visibility
                ctx.fillStyle = color + '20'; // Add alpha for transparency
                ctx.fill();
            } else {
                // Fallback to rectangle if corners not available
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
            }

            // Draw tilt information
            ctx.fillStyle = color;
            ctx.font = 'bold 16px Arial';
            const tiltText = `${status}: ${tilt.toFixed(1)}°`;
            const textY = rect.y - 10;
            
            // Draw text background
            const textMetrics = ctx.measureText(tiltText);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(rect.x, textY - 20, textMetrics.width + 10, 25);
            
            // Draw text
            ctx.fillStyle = color;
            ctx.fillText(tiltText, rect.x + 5, textY - 3);

            // Draw direction indicator
            if (absTilt > 1) {
                const direction = tilt > 0 ? '↻' : '↺';
                ctx.font = 'bold 24px Arial';
                ctx.fillText(direction, rect.x + rect.width - 30, rect.y + 30);
            }

            // Draw corner points
            if (frame.corners) {
                frame.corners.forEach(corner => {
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(corner.x, corner.y, 5, 0, 2 * Math.PI);
                    ctx.fill();
                });
            }
        });

        // Draw camera tilt indicator
        if (Math.abs(this.cameraTilt) > 0.5 || this.isSensorFusionActive()) {
            let indicatorText = '';
            
            if (this.isSensorFusionActive()) {
                indicatorText = `Device: ${this.deviceTilt.toFixed(1)}° | Camera: ${this.cameraTilt.toFixed(1)}° | Combined: ${this.fusedTilt.toFixed(1)}°`;
            } else {
                indicatorText = `Camera Tilt: ${this.cameraTilt.toFixed(1)}° (auto-compensating)`;
            }
            
            ctx.font = 'bold 14px Arial';
            
            // Draw background
            const textMetrics = ctx.measureText(indicatorText);
            const bgColor = this.isSensorFusionActive() ? 'rgba(0, 200, 100, 0.8)' : 'rgba(255, 165, 0, 0.8)';
            ctx.fillStyle = bgColor;
            ctx.fillRect(10, 10, textMetrics.width + 20, 30);
            
            // Draw text
            ctx.fillStyle = 'white';
            ctx.fillText(indicatorText, 20, 30);
        }
    }

    /**
     * Set detection sensitivity
     */
    setSensitivity(value) {
        this.sensitivity = Math.max(1, Math.min(10, value));
    }
    
    /**
     * Set smoothing level (1-10 scale, user-friendly)
     * Adjusts frame stability tracking window
     * 1 = maximum smoothing (most stable, slower to update)
     * 10 = minimum smoothing (most responsive, faster updates)
     */
    setSmoothingLevel(level) {
        level = Math.max(1, Math.min(10, level));
        
        // Convert 1-10 scale to stability window size
        // Level 1 (max smoothing): window=20 measurements
        // Level 5 (balanced): window=10 measurements
        // Level 10 (min smoothing): window=3 measurements
        
        this.frameStabilityWindow = Math.round(22 - (level - 1) * 2.1); // 20 to 3
        
        console.log(`Frame smoothing level ${level}: stability window=${this.frameStabilityWindow} measurements`);
    }

    /**
     * Set minimum contour area
     */
    setMinContourArea(area) {
        this.minContourArea = area;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrameDetector;
}
