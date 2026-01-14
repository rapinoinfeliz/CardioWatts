
export class BioPIDController {
    constructor({ target, outputMin, outputMax }) {
        this.outputMin = outputMin;
        this.outputMax = outputMax;

        // State
        this.hrBuffer = [];
        this.lastAdjustmentTime = 0;

        // Config
        this.bufferWindow = 10;      // 10 samples (at 1s rate) ~ 10s average
        this.updateInterval = 12000; // 12 seconds between power changes (slower = smoother)

        this.deadbandPercent = 0.02; // 2% tolerance (e.g. +/- 2.5bpm at 125)

        this.stepSize = 3;           // Watts to adjust per step (Standard)
        this.largeStep = 5;          // Watts for larger gaps
        this.safetyDrop = 15;        // Watts to drop immediately if unsafe

        console.log("BioPID: Logic Loaded (Smooth/Slow)");
    }

    reset() {
        this.hrBuffer = [];
        this.lastAdjustmentTime = 0;
    }

    getAverageHR() {
        if (this.hrBuffer.length === 0) return 0;
        const sum = this.hrBuffer.reduce((a, b) => a + b, 0);
        return sum / this.hrBuffer.length;
    }

    update(targetHR, currentHR, currentPower) {
        const now = Date.now();

        // 1. Always collect data (Rolling buffer)
        this.hrBuffer.push(currentHR);
        if (this.hrBuffer.length > this.bufferWindow) {
            this.hrBuffer.shift();
        }

        // 2. Time-Based Dampening (Was Safety Check)
        // Only adjust power every X seconds
        if (now - this.lastAdjustmentTime < this.updateInterval) {
            return currentPower; // Hold
        }

        // 4. Calculate Smoothed Error
        const avgHR = this.getAverageHR();
        const diff = avgHR - targetHR;
        const tolerance = targetHR * this.deadbandPercent; // e.g., 2.5 bpm

        let adjustment = 0;
        let reason = "Hold";

        if (diff > tolerance) {
            // HR Too High (Avg > Target + 2%)
            // e.g. Target 130, Avg 134
            adjustment = -this.stepSize;
            reason = "High (>2%)";
        }
        else if (diff < -tolerance) {
            // HR Too Low (Avg < Target - 2%)
            // e.g. Target 130, Avg 126

            // Check for large gap
            if (diff < -10) {
                adjustment = this.largeStep;
                reason = "Very Low (Boost)";
            } else {
                adjustment = this.stepSize;
                reason = "Low (<2%)";
            }
        }

        this.lastAdjustmentTime = now;

        const newPower = Math.min(this.outputMax, Math.max(this.outputMin, currentPower + adjustment));

        if (adjustment !== 0) {
            console.log(`BioPID: AvgHR ${Math.round(avgHR)} (T:${targetHR}) -> ${reason} -> Power ${currentPower} => ${newPower}`);
        }

        return newPower;
    }
}
