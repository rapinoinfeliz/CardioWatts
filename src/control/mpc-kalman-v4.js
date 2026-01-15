/**
 * Bio-MPC Controller V4 (The Mastermind)
 * 
 * Features:
 * 1. Asymmetric Kinetics (Hysteresis): Faster rise than fall.
 * 2. Kalman Filter: Estimating hidden metabolic demand.
 * 3. Hill-Climbing Optimizer: 1W precision (Gradient-like).
 * 4. Jerk Penalty: Extreme stability.
 */

export class MPCKalmanV4 {
    constructor(config = {}) {
        this.outputMin = config.outputMin || 50;
        this.outputMax = config.outputMax || 400;

        // Physiological Parameters
        this.params = {
            hrMin: 65,
            hrMax: 195,
            gain: 0.45,
            tauDemand: 20,
            tauHRRise: 25, // Faster acceleration
            tauHRFall: 45, // Slower recovery (realistic)
        };

        // Kalman Filter State [Demand, HR]
        this.kf = {
            x: [65, 65], // State estimate
            P: [[10, 0], [0, 10]], // Covariance
            Q: [[0.1, 0], [0, 0.01]], // Process noise
            R: 1.0 // Measurement noise (HR sensor)
        };

        this.state = {
            lastPower: 100,
            initialized: false
        };

        console.log("[Bio-MPC V4] Mastermind Initialized.");
    }

    reset() {
        this.state.initialized = false;
        console.log("[Bio-MPC V4] Reset.");
    }

    /**
     * Internal Prediction with Asymmetric Kinetics
     */
    predict(startHR, startDemand, power, horizonSecs) {
        let hr = startHR;
        let demand = startDemand;
        const dt = 2.0; // 2s steps for sim speed

        for (let t = 0; t < horizonSecs; t += dt) {
            const target = (power * this.params.gain) + this.params.hrMin;

            // Demand Kinetics
            demand += (target - demand) / this.params.tauDemand * dt;

            // Asymmetric HR Kinetics
            const tau = (demand > hr) ? this.params.tauHRRise : this.params.tauHRFall;
            hr += (demand - hr) / tau * dt;
        }

        return { hr, demand };
    }

    /**
     * Cost Function for Optimizer
     */
    calculateCost(testPower, targetHR, currentHR, currentDemand, currentPower) {
        const horizon = 45;
        const pred = this.predict(currentHR, currentDemand, testPower, horizon);

        const error = targetHR - pred.hr;
        const costError = Math.pow(error, 2);

        // Strict Overshoot Penalty
        const overshoot = (pred.hr > targetHR + 0.5) ? Math.pow(pred.hr - targetHR, 2) * 200 : 0;

        // Jerk Penalty (Stability)
        const jerk = Math.pow(testPower - currentPower, 2) * 0.2;

        return costError + overshoot + jerk;
    }

    update(targetHR, currentHR, currentPower) {
        if (!this.state.initialized) {
            this.kf.x = [currentHR, currentHR];
            this.state.lastPower = currentPower;
            this.state.initialized = true;
            return currentPower;
        }

        // --- 1. KALMAN FILTER UPDATE (Demand Estimation) ---
        // Predict
        const dt = 2.0;
        const u = currentPower;
        const target = (u * this.params.gain) + this.params.hrMin;

        // A transition matrix (simplified)
        // D_new = D + (target - D)/tau_d * dt
        // HR_new = HR + (D - HR)/tau_hr * dt
        const tauHR = (this.kf.x[0] > this.kf.x[1]) ? this.params.tauHRRise : this.params.tauHRFall;

        const d_next = this.kf.x[0] + (target - this.kf.x[0]) / this.params.tauDemand * dt;
        const hr_next = this.kf.x[1] + (this.kf.x[0] - this.kf.x[1]) / tauHR * dt;

        this.kf.x = [d_next, hr_next];
        // Note: For simplicity in JS, we update P with a base growth
        this.kf.P[0][0] += this.kf.Q[0][0];
        this.kf.P[1][1] += this.kf.Q[1][1];

        // Measurement Update (Correction)
        const z = currentHR;
        const y = z - this.kf.x[1]; // Innovation
        const S = this.kf.P[1][1] + this.kf.R;
        const K = [this.kf.P[0][1] / S, this.kf.P[1][1] / S]; // Gain

        this.kf.x[0] += K[0] * y;
        this.kf.x[1] += K[1] * y;

        this.kf.P[0][0] *= (1 - K[0]);
        this.kf.P[1][1] *= (1 - K[1]);

        // --- 2. HILL-CLIMBING OPTIMIZER ---
        let bestPower = currentPower;
        let minCost = this.calculateCost(bestPower, targetHR, this.kf.x[1], this.kf.x[0], currentPower);

        // Search in steps of 10W then 1W
        const searchSteps = [10, 5, 1];
        for (const step of searchSteps) {
            let improving = true;
            while (improving) {
                improving = false;
                for (const delta of [-step, step]) {
                    const testP = Math.max(this.outputMin, Math.min(this.outputMax, bestPower + delta));
                    const cost = this.calculateCost(testP, targetHR, this.kf.x[1], this.kf.x[0], currentPower);
                    if (cost < minCost) {
                        minCost = cost;
                        bestPower = testP;
                        improving = true;
                    }
                }
            }
        }

        this.state.lastPower = bestPower;
        return bestPower;
    }
}
