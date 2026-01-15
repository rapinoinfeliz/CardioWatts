
export class LinearProjectionV2 {
    constructor({ outputMin, outputMax }) {
        this.outputMin = outputMin || 50;
        this.outputMax = outputMax || 400;

        // Tuning Parameters
        this.LOOKAHEAD_TIME = 15.0;   // Seconds to project into future
        this.COOLDOWN_PERIOD = 15.0;  // Patience Timer (Seconds)
        this.BUFFER_WINDOW = 10;      // Seconds of history for Slope

        // Critical Drops
        this.DROP_FAST = 2.0;         // W/s (Critical Overshoot)
        this.DROP_SLOW = 0.5;         // W/s (Minor Overshoot)

        // State variables
        this.lastOutputPower = 100;
        this.lastUpdateTime = 0;
        this.lastIncreaseTime = 0;    // For Patience Logic

        // Data Buffer: Array of { t: time, hr: value }
        this.hrBuff = [];

        this.isInitialized = false;
        console.log("[ProjectedController] Created.");
    }

    reset() {
        this.hrBuff = [];
        this.lastUpdateTime = 0;
        this.lastIncreaseTime = 0;
        this.startTime = 0; // Reset start time
        this.isInitialized = false;
        console.log("[ProjectedController] Reset.");
    }

    calibrate(hr, power) {
        console.log(`[ProjectedController] Manual Calibration ignored.`);
    }

    // --- MATH HELPERS ---

    _calculateSlope() {
        // Linear Regression (Least Squares) over hrBuff
        // Returns slope in beats/second
        const n = this.hrBuff.length;
        if (n < 2) return 0;

        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

        // Normalize time to starts from 0 to avoid massive numbers
        const t0 = this.hrBuff[0].t;

        for (let i = 0; i < n; i++) {
            const x = (this.hrBuff[i].t - t0) / 1000; // Seconds
            const y = this.hrBuff[i].hr;

            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }

        const denominator = (n * sumXX) - (sumX * sumX);
        if (denominator === 0) return 0;

        const slope = ((n * sumXY) - (sumX * sumY)) / denominator;
        return slope; // bpm per second
    }

    update(targetHR, currentHR, currentPower) {
        const now = Date.now();

        // 1. Initialization
        if (!this.isInitialized) {
            this.isInitialized = true;
            this.lastUpdateTime = now;
            this.startTime = now; // Mark Start
            this.lastIncreaseTime = now - (this.COOLDOWN_PERIOD * 1000); // Allow immediate start

            // Fixed Start
            let initialPower = 100;
            this.lastOutputPower = initialPower;
            console.log(`[ProjectedController] Init: Fixed Start @ ${initialPower}W`);
            return initialPower;
        }

        // 2. Timing
        const dt = (now - this.lastUpdateTime) / 1000;
        if (dt < 1.0) { // Run frequently to fill buffer, but act on loop
            return this.lastOutputPower;
        }
        this.lastUpdateTime = now;

        // 3. Update Buffer
        this.hrBuff.push({ t: now, hr: currentHR });
        // Prune old data (> 10s)
        const cutoff = now - (this.BUFFER_WINDOW * 1000);
        while (this.hrBuff.length > 0 && this.hrBuff[0].t < cutoff) {
            this.hrBuff.shift();
        }

        // 4. Calculate Projection
        const slope = this._calculateSlope();
        const projectedHR = currentHR + (slope * this.LOOKAHEAD_TIME);
        const error = targetHR - projectedHR;
        const timeSinceIncrease = (now - this.lastIncreaseTime) / 1000;

        let targetPower = this.lastOutputPower;
        let action = "HOLD";

        // --- STATE MACHINE ---

        if (error < 0) {
            // ZONE: ALERT (Projected HR > Target) -> Negative Error
            // Logic: Drop Power Immediately.
            action = "DROP";

            // How fast? Assymetric Drop.
            // If overshoot is small (< 5 bpm), drop slow.
            // If critical (> 5 bpm), drop fast.
            let dropRate = this.DROP_SLOW;
            if (Math.abs(error) > 5.0) {
                dropRate = this.DROP_FAST;
                action = "DROP_FAST";
            }

            const change = dropRate * dt;
            targetPower -= change;

        } else if (Math.abs(error) < 1.0) {
            // ZONE: SAFE (Within 1 bpm of Target)
            // Logic: Deadband.
            action = "SAFE";

        } else {
            // ZONE: RECOVERY (Projected HR < Target) -> Positive Error
            // Logic: Increase Power using Four-Stage Ramp.

            // 1. Determine Stage
            let stage = "LAND";
            let waitTime = 8.0;  // Default (Precision)
            let stepSize = 0.5;  // Default (0.5W)

            const elapsed = (now - this.startTime) / 1000;

            const rawError = targetHR - currentHR;

            if (rawError > 20.0 && elapsed < 20.0) {
                stage = "START";
                waitTime = 3.0;
                stepSize = 3.0;
            } else if (rawError > 8.0) {
                stage = "SPRINT";
                waitTime = 2.0;
                stepSize = 1.5;
            } else if (rawError > 4.0) {
                stage = "CRUISE";
                waitTime = 4.0;
                stepSize = 1.0;
            }

            // 2. Check Patience
            if (timeSinceIncrease < waitTime) {
                action = `WAIT ${stage}`;
            } else {
                action = `BOOST ${stage}`;
                targetPower += stepSize;
                this.lastIncreaseTime = now; // Reset Timer
            }
        }

        // Limits
        targetPower = Math.min(this.outputMax, Math.max(this.outputMin, targetPower));
        this.lastOutputPower = targetPower;

        console.log(`[Projected] HR:${currentHR} Slope:${slope.toFixed(3)} Proj:${projectedHR.toFixed(1)} Err:${error.toFixed(1)} Action:${action} Pwr:${targetPower.toFixed(1)}`);

        return targetPower;
    }
}
