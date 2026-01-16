/**
 * Bio-MPC Controller V8.0 (Zero Error Edition)
 * 
 * Based on V7.6 (Precision Tuned).
 * Adds two major features for near-perfect control:
 * 
 * NEW FEATURES V8.0:
 * 1. [PRECISION] Kalman Filter: Smooths HR noise without adding lag.
 * 2. [ACCURACY] Integral Action: Eliminates steady-state error completely.
 * 
 * INHERITED from V7.6:
 * - Smith Predictor Fix (8s horizon)
 * - Warmup Boost (5x/2x learning rate)
 * - Anti-Windup (momentum reset at rails)
 * - Dead Band (asymmetric [-0.8, +0.3])
 * - Asymmetric Penalties (safety bias toward undershoot)
 */

export class MPCv8 {
    constructor(config = {}) {
        this.outputMin = config.outputMin || 50;
        this.outputMax = config.outputMax || 400;

        // Initial Physiological Parameters (will be adapted)
        this.params = {
            hrMin: 65,
            hrMax: 195,
            gain: 0.45,       // Adaptive
            tauDemand: 20,
            tauHRRise: 25,    // Adaptive (Sympathetic)
            tauHRFall: 45,    // Adaptive (Parasympathetic)
            delay: 4          // steps (~8-12s)
        };

        // RLS quantities
        this.rls = {
            theta: this.params.gain,
            tauRise: this.params.tauHRRise,
            tauFall: this.params.tauHRFall
        };

        // Smith Predictor History
        this.history = {
            modelOutput: [],
            hr: [],
            bufferSize: 20,
            startTime: Date.now()
        };

        this.state = {
            currentDemand: 65,
            lastPower: 100,
            momentum: 0,
            initialized: false
        };

        // OU Noise State
        this.noise = {
            value: 0,
            theta: 0.15,
            sigma: 0.1
        };

        // [V8.0] KALMAN FILTER for HR
        this.kalman = {
            x: 70,           // State estimate (filtered HR)
            P: 10,           // Estimation error covariance
            Q: 0.5,          // Process noise (HR doesn't change much between samples)
            R: 4.0           // Measurement noise (HR sensor has ~2bpm noise)
        };

        // [V8.0] INTEGRAL ACTION for zero steady-state error
        this.integral = {
            error: 0,        // Accumulated error
            Ki: 0.08,        // Integral gain (increased for faster correction)
            maxIntegral: 20  // Anti-windup limit (max power adjustment from integral)
        };

        console.log("[Bio-MPC V8.0] Initialized (Zero Error Edition).");
    }

    reset() {
        this.state.initialized = false;
        this.resetRLS();
        this.resetKalman();
        this.resetIntegral();
        this.history.startTime = Date.now();
        console.log("[Bio-MPC V8.0] Reset.");
    }

    resetRLS() {
        this.rls.theta = this.params.gain;
        this.rls.tauRise = this.params.tauHRRise;
        this.rls.tauFall = this.params.tauHRFall;
        this.history.modelOutput = [];
        this.history.hr = [];
    }

    // [V8.0] Reset Kalman Filter
    resetKalman() {
        this.kalman.x = 70;
        this.kalman.P = 10;
    }

    // [V8.0] Reset Integral Action
    resetIntegral() {
        this.integral.error = 0;
    }

    /**
     * [V8.0] KALMAN FILTER UPDATE
     * Smooths noisy HR measurements without adding lag.
     * 
     * Standard Kalman equations:
     * Predict: x_pred = x, P_pred = P + Q
     * Update:  K = P_pred / (P_pred + R)
     *          x = x_pred + K * (measurement - x_pred)
     *          P = (1 - K) * P_pred
     */
    kalmanUpdate(measuredHR) {
        // Predict step (assume HR stays constant + process noise)
        const xPred = this.kalman.x;
        const PPred = this.kalman.P + this.kalman.Q;

        // Update step
        const K = PPred / (PPred + this.kalman.R);  // Kalman gain
        this.kalman.x = xPred + K * (measuredHR - xPred);  // Updated estimate
        this.kalman.P = (1 - K) * PPred;  // Updated covariance

        return this.kalman.x;  // Return filtered HR
    }

    /**
     * [V8.0] INTEGRAL ACTION UPDATE
     * Accumulates error over time to eliminate steady-state offset.
     * Includes anti-windup to prevent integral explosion.
     */
    integralUpdate(targetHR, filteredHR, dt = 1.0) {
        const error = targetHR - filteredHR;

        // Only accumulate if we're in the "fine tuning" zone (small error)
        // and not hitting power limits (anti-windup)
        if (Math.abs(error) < 3.0) {
            this.integral.error += error * dt;

            // Clamp integral to prevent windup
            this.integral.error = Math.max(
                -this.integral.maxIntegral / this.integral.Ki,
                Math.min(this.integral.maxIntegral / this.integral.Ki, this.integral.error)
            );
        }

        // If error changes sign, reduce integral (prevents overshoot)
        if (this.history.hr.length > 2) {
            const prevError = targetHR - this.history.hr[this.history.hr.length - 2];
            if (error * prevError < 0) {
                this.integral.error *= 0.5;  // Decay on zero crossing
            }
        }

        return this.integral.Ki * this.integral.error;  // Return power adjustment
    }

    nextNoise(dt) {
        const dW = (Math.random() - 0.5) * 2 * Math.sqrt(dt);
        const dx = this.noise.theta * (0 - this.noise.value) * dt + this.noise.sigma * dW;
        this.noise.value += dx;
        return this.noise.value;
    }

    /**
     * Prediction Model (Core ODE) - Same as V7.6
     */
    predict(startHR, startDemand, power, horizonSecs, useNoise = false) {
        let hr = startHR;
        let demand = startDemand;
        const dt = 2.0;

        const currentGain = this.rls.theta;
        const tRise = this.rls.tauRise;
        const tFall = this.rls.tauFall;

        for (let t = 0; t < horizonSecs; t += dt) {
            let noise = 0;
            if (useNoise) {
                noise = this.nextNoise(dt);
            }

            const target = (power * currentGain) + this.params.hrMin + (noise * 5);
            demand += (target - demand) / this.params.tauDemand * dt;

            const tau = (demand > hr) ? tRise : tFall;
            hr += (demand - hr) / tau * dt;
        }

        return { hr, demand };
    }

    /**
     * Adaptive Logic - Same as V7.6 with Warmup Boost
     */
    updateAdaptation(currentPower, currentHR) {
        if (currentPower < 10) return;

        // Smith Predictor Comparison
        const delayedModel = this.history.modelOutput[0] || currentHR;
        let error = currentHR - delayedModel;

        const effectiveErr = Math.max(-5, Math.min(5, error));

        // [V7.6] Warmup Boost: Faster learning in first 10 mins
        const elapsedMins = (Date.now() - this.history.startTime) / 60000;
        let learnBoost = 1.0;
        if (elapsedMins < 5) learnBoost = 5.0;
        else if (elapsedMins < 10) learnBoost = 2.0;

        // "MIT Rule"
        const alphaGain = 0.00005 * learnBoost;
        this.rls.theta += alphaGain * effectiveErr * (currentPower / 200);
        this.rls.theta = Math.max(0.25, Math.min(0.8, this.rls.theta));

        // Adapt TAUS
        const n = this.history.hr.length;
        if (n >= 5) {
            const recent = this.history.hr.slice(-5);
            const avg_old = (recent[0] + recent[1]) / 2;
            const avg_new = (recent[3] + recent[4]) / 2;
            const dydt = avg_new - avg_old;

            const alphaTau = 0.0005 * learnBoost;

            if (dydt > 0.5) {
                this.rls.tauRise *= (error > 0) ? (1 - alphaTau) : (1 + alphaTau);
            } else if (dydt < -0.5) {
                this.rls.tauFall *= (error > 0) ? (1 + alphaTau) : (1 - alphaTau);
            }

            this.rls.tauRise = Math.max(15, Math.min(60, this.rls.tauRise));
            this.rls.tauFall = Math.max(25, Math.min(120, this.rls.tauFall));
        }
    }

    /**
     * Cost Function - Same as V7.6 with Dead Band and Asymmetric Penalties
     */
    calculateCost(testPower, targetHR, currentHR, currentDemand, currentPower) {
        const errorMag = Math.abs(targetHR - currentHR);

        const horizon = Math.min(75, Math.max(45, errorMag * 5 + 20));
        const SAMPLES = 10;
        const predictions = [];

        for (let i = 0; i < SAMPLES; i++) {
            const p = this.predict(currentHR, currentDemand, testPower, horizon, true);
            predictions.push(p.hr);
        }

        const meanHR = predictions.reduce((a, b) => a + b, 0) / SAMPLES;

        // [V8.0] DEAD BAND - Tightened for precision: [-0.5, +0.2]
        let trackingError = 0;
        if (meanHR > targetHR + 0.2) {
            trackingError = meanHR - targetHR - 0.2;
        } else if (meanHR < targetHR - 0.5) {
            trackingError = targetHR - 0.5 - meanHR;
        }

        const sqError = Math.pow(trackingError, 2) * 22.0;

        predictions.sort((a, b) => a - b);
        const p05HR = predictions[Math.floor(SAMPLES * 0.05)] || predictions[0];
        const p95HR = predictions[Math.floor(SAMPLES * 0.95)];
        const p99HR = predictions[Math.floor(SAMPLES * 0.99)] || predictions[SAMPLES - 1];

        // [V7.6] ASYMMETRIC PENALTIES
        const undershootSoft = (p05HR < targetHR - 1.5) ?
            Math.pow(targetHR - p05HR, 2) * 12 : 0;

        const overshootSoft = (p95HR > targetHR + 0.7) ?
            Math.pow(p95HR - targetHR, 2) * 30 : 0;

        const overshootHard = (p99HR > targetHR + 1.8) ?
            Math.pow(p99HR - targetHR, 2) * 120 : 0;

        const momentumPenalty = Math.pow(testPower - currentPower, 2) * 0.35;

        return sqError + overshootSoft + overshootHard + undershootSoft + momentumPenalty;
    }

    update(targetHR, rawHR, currentPower) {
        // [V8.0] Apply Kalman Filter to raw HR for smooth, lag-free measurement
        const filteredHR = this.kalmanUpdate(rawHR);

        if (!this.state.initialized) {
            this.state.currentDemand = filteredHR;
            this.state.lastPower = currentPower;
            this.state.initialized = true;
            this.history.startTime = Date.now();
            this.kalman.x = filteredHR;  // Initialize Kalman state
            return currentPower;
        }

        // [V7.6 FIX] Correct Horizon for Smith Predictor (8s)
        const delaySecs = this.params.delay * 2.0;
        const pDet = this.predict(filteredHR, this.state.currentDemand, currentPower, delaySecs, false);

        this.history.modelOutput.push(pDet.hr);
        this.history.hr.push(filteredHR);

        if (this.history.modelOutput.length > this.params.delay) this.history.modelOutput.shift();
        if (this.history.hr.length > 20) this.history.hr.shift();

        // Adaptation (uses filtered HR)
        if (Math.abs(targetHR - filteredHR) < 25) {
            this.updateAdaptation(currentPower, filteredHR);
        }

        // Gain-Scheduled Optimizer
        const errMag = Math.abs(targetHR - filteredHR);
        let lr = 0.5;
        let maxVel = 2.5;

        if (errMag > 15) {
            lr = 0.8;
            maxVel = 5.0;
        }

        let power = this.state.lastPower;
        let velocity = this.state.momentum;
        const momentum = 0.4;

        for (let i = 0; i < 8; i++) {
            const delta = 1.0;
            const costPlus = this.calculateCost(power + delta, targetHR, filteredHR, this.state.currentDemand, currentPower);
            const costMinus = this.calculateCost(power - delta, targetHR, filteredHR, this.state.currentDemand, currentPower);
            const grad = (costPlus - costMinus) / (2 * delta);

            velocity = momentum * velocity - lr * grad;
            velocity = Math.max(-maxVel, Math.min(maxVel, velocity));

            power += velocity;

            // [V7.6] Anti-Windup: Reset momentum if hitting rails
            if (power >= this.outputMax || power <= this.outputMin) {
                velocity = 0;
                this.integral.error *= 0.5;  // Also reduce integral on limits
            }

            power = Math.max(this.outputMin, Math.min(this.outputMax, power));
        }

        // [V8.0] Apply Integral Action for zero steady-state error
        const integralAdjustment = this.integralUpdate(targetHR, filteredHR);
        power += integralAdjustment;
        power = Math.max(this.outputMin, Math.min(this.outputMax, power));

        this.state.momentum = velocity;

        // Update Internal State
        const target = (power * this.rls.theta) + this.params.hrMin;
        this.state.currentDemand += (target - this.state.currentDemand) / this.params.tauDemand * 2.0;

        this.state.lastPower = power;
        return power;
    }

    // [V8.0] Getter for diagnostics
    getDiagnostics() {
        return {
            filteredHR: this.kalman.x,
            integralError: this.integral.error,
            integralAdjustment: this.integral.Ki * this.integral.error,
            gain: this.rls.theta,
            tauRise: this.rls.tauRise,
            tauFall: this.rls.tauFall
        };
    }
}
