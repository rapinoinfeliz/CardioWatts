/**
 * Bio-MPC Controller V9.0 (Contextual Intelligence)
 * 
 * Based on V8.0 (Zero Error Edition).
 * Adds intelligent context awareness and adaptive robustness.
 * 
 * NEW FEATURES V9.0:
 * 1. [ROBUST] Adaptive Kalman Filter: R adjusts to observed noise variance
 * 2. [CONTEXT] Mode Recognition: Detects RAMP/STEADY/RECOVERY, adjusts behavior
 * 3. [PRECISION] Smart Integral: Only active in STEADY mode, resets on context change
 * 
 * INHERITED from V8:
 * - Smith Predictor (8s horizon)
 * - Warmup Boost (5x/2x learning rate)
 * - Anti-Windup (momentum reset at rails)
 * - Dead Band (asymmetric [-0.8, +0.3])
 * - Asymmetric Penalties
 */

// ============================================
// MODULE 1: ADAPTIVE KALMAN FILTER
// ============================================
class AdaptiveKalmanFilter {
    constructor() {
        this.x = 70;           // State estimate (filtered HR)
        this.P = 10;           // Estimation error covariance
        this.Q = 0.5;          // Process noise (fixed)
        this.baseR = 3.0;      // Nominal measurement noise
        this.R = 3.0;          // Current R (adaptive)
        this.history = [];     // Last 5 measurements for variance calculation
    }

    update(measuredHR) {
        // 1. ADAPT R based on observed noise
        this.history.push(measuredHR);
        if (this.history.length > 5) this.history.shift();

        if (this.history.length >= 5) {
            // Calculate short-term variance (noise indicator)
            const mean = this.history.reduce((a, b) => a + b, 0) / 5;
            const variance = this.history.reduce((sum, val) =>
                sum + Math.pow(val - mean, 2), 0) / 5;

            // Higher variance -> less confidence -> higher R
            const noiseFactor = Math.sqrt(variance) / 2.0;
            this.R = this.baseR * (1 + Math.min(noiseFactor, 2.0));
        }

        // 2. STANDARD KALMAN
        // Predict step
        const xPred = this.x;
        const PPred = this.P + this.Q;

        // Update step
        const K = PPred / (PPred + this.R);
        this.x = xPred + K * (measuredHR - xPred);
        this.P = (1 - K) * PPred;

        return this.x;
    }

    reset(initialHR = 70) {
        this.x = initialHR;
        this.P = 10;
        this.R = this.baseR;
        this.history = [];
    }

    getDiagnostics() {
        return {
            filteredHR: this.x,
            R: this.R,
            noiseLevel: this.R / this.baseR
        };
    }
}

// ============================================
// MODULE 2: MODE RECOGNITION
// ============================================
class ModeRecognition {
    constructor() {
        this.currentMode = 'STEADY';
        this.hysteresisCounter = 0;
    }

    detect(hrHistory, powerHistory) {
        if (hrHistory.length < 5) return this.currentMode;

        // Calculate dHR/dt (trend over last 5 samples = 10s)
        const recent = hrHistory.slice(-5);
        const dhdt = (recent[4] - recent[0]) / 10.0; // bpm/s

        // Calculate power trend
        const recentPower = powerHistory.slice(-3);
        const powerTrend = recentPower.length >= 2 ?
            (recentPower[recentPower.length - 1] - recentPower[0]) : 0;

        // DETECT MODE
        let detectedMode = this.currentMode;

        if (dhdt > 1.2 && powerTrend > 5) {
            detectedMode = 'RAMP';
        } else if (dhdt < -1.0) {
            detectedMode = 'RECOVERY';
        } else if (Math.abs(dhdt) < 0.5) {
            detectedMode = 'STEADY';
        }

        // HYSTERESIS (avoid flip-flop)
        if (detectedMode !== this.currentMode) {
            this.hysteresisCounter++;
            if (this.hysteresisCounter >= 3) { // 3 consecutive detections
                this.currentMode = detectedMode;
                this.hysteresisCounter = 0;
            }
        } else {
            this.hysteresisCounter = 0;
        }

        return this.currentMode;
    }

    getConfig() {
        // Return mode-specific configuration
        switch (this.currentMode) {
            case 'RAMP':
                return {
                    lr: 1.0,              // High learning rate
                    maxVel: 8.0,          // Allow fast changes
                    enableIntegral: false, // Disable integral
                    horizonBoost: 1.2     // 20% longer horizon
                };
            case 'RECOVERY':
                return {
                    lr: 0.3,              // Conservative
                    maxVel: 1.0,          // Slow changes
                    enableIntegral: false, // Disable integral
                    horizonBoost: 1.3     // Longer horizon (tau_fall is long)
                };
            case 'STEADY':
            default:
                return {
                    lr: 0.5,              // Normal
                    maxVel: 2.5,          // Normal
                    enableIntegral: true,  // ENABLE integral
                    horizonBoost: 1.0     // Normal
                };
        }
    }

    reset() {
        this.currentMode = 'STEADY';
        this.hysteresisCounter = 0;
    }

    getDiagnostics() {
        return {
            mode: this.currentMode,
            hysteresis: this.hysteresisCounter
        };
    }
}

// ============================================
// MODULE 3: SMART INTEGRAL
// ============================================
class SmartIntegral {
    constructor() {
        this.accumulated = 0;
        this.Ki = 0.1;         // Integral gain
        this.maxAccum = 15;    // Anti-windup limit
        this.lastError = 0;
    }

    update(error, mode, atPowerLimit = false) {
        // 1. RESET if not STEADY or hitting power limits
        if (mode !== 'STEADY' || atPowerLimit) {
            this.accumulated *= 0.5;  // Fast decay
            this.lastError = error;
            return 0;
        }

        // 2. ONLY ACCUMULATE if error is small (fine-tuning zone)
        if (Math.abs(error) > 2.5) {
            this.accumulated *= 0.8;  // Gentle decay
            this.lastError = error;
            return this.Ki * this.accumulated;
        }

        // 3. DETECT SIGN CHANGE (overshoot)
        if (error * this.lastError < 0) {
            this.accumulated *= 0.3;  // Partial reset
        }

        // 4. ACCUMULATE WITH ASYMMETRY
        // Overshoot costs more than undershoot
        let weight = 1.0;
        if (error > 0) {  // Above target
            weight = 1.5;  // Accumulate 50% faster (fix overshoot urgently)
        }

        this.accumulated += error * weight * 2.0;  // dt = 2s

        // 5. ANTI-WINDUP
        this.accumulated = Math.max(
            -this.maxAccum / this.Ki,
            Math.min(this.maxAccum / this.Ki, this.accumulated)
        );

        this.lastError = error;

        return this.Ki * this.accumulated;
    }

    reset() {
        this.accumulated = 0;
        this.lastError = 0;
    }

    getDiagnostics() {
        return {
            accumulated: this.accumulated,
            adjustment: this.Ki * this.accumulated
        };
    }
}

// ============================================
// MAIN CLASS: MPCv9
// ============================================
export class MPCv9 {
    constructor(config = {}) {
        this.outputMin = config.outputMin || 50;
        this.outputMax = config.outputMax || 400;

        // Physiological parameters (inherited from V8)
        this.params = {
            hrMin: 65,
            hrMax: 195,
            gain: 0.45,
            tauDemand: 20,
            tauHRRise: 25,
            tauHRFall: 45,
            delay: 4
        };

        // RLS quantities
        this.rls = {
            theta: this.params.gain,
            tauRise: this.params.tauHRRise,
            tauFall: this.params.tauHRFall
        };

        // History buffers
        this.history = {
            modelOutput: [],
            hr: [],
            power: [],  // NEW: track power for mode detection
            startTime: Date.now()
        };

        // Internal state
        this.state = {
            currentDemand: 65,
            lastPower: 100,
            momentum: 0,
            initialized: false
        };

        // OU Noise state
        this.noise = {
            value: 0,
            theta: 0.15,
            sigma: 0.1
        };

        // [V9] NEW MODULAR COMPONENTS
        this.kalman = new AdaptiveKalmanFilter();
        this.modeRecognizer = new ModeRecognition();
        this.integral = new SmartIntegral();

        console.log("[Bio-MPC V9] Initialized (Contextual Intelligence).");
    }

    reset() {
        this.state.initialized = false;
        this.resetRLS();
        this.kalman.reset();
        this.modeRecognizer.reset();
        this.integral.reset();
        this.history.startTime = Date.now();
        this.history.power = [];
        console.log("[Bio-MPC V9] Reset.");
    }

    resetRLS() {
        this.rls.theta = this.params.gain;
        this.rls.tauRise = this.params.tauHRRise;
        this.rls.tauFall = this.params.tauHRFall;
        this.history.modelOutput = [];
        this.history.hr = [];
    }

    nextNoise(dt) {
        const dW = (Math.random() - 0.5) * 2 * Math.sqrt(dt);
        const dx = this.noise.theta * (0 - this.noise.value) * dt + this.noise.sigma * dW;
        this.noise.value += dx;
        return this.noise.value;
    }

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

    updateAdaptation(currentPower, currentHR) {
        if (currentPower < 10) return;

        const delayedModel = this.history.modelOutput[0] || currentHR;
        let error = currentHR - delayedModel;
        const effectiveErr = Math.max(-5, Math.min(5, error));

        // Warmup Boost (inherited from V8)
        const elapsedMins = (Date.now() - this.history.startTime) / 60000;
        let learnBoost = 1.0;
        if (elapsedMins < 5) learnBoost = 5.0;
        else if (elapsedMins < 10) learnBoost = 2.0;

        // MIT Rule
        const alphaGain = 0.00005 * learnBoost;
        this.rls.theta += alphaGain * effectiveErr * (currentPower / 200);
        this.rls.theta = Math.max(0.25, Math.min(0.8, this.rls.theta));

        // Adapt TAUs
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

    calculateCost(testPower, targetHR, currentHR, currentDemand, currentPower, modeConfig) {
        const errorMag = Math.abs(targetHR - currentHR);

        // [V9] Horizon adjusted by mode
        const baseHorizon = Math.min(75, Math.max(45, errorMag * 5 + 20));
        const horizon = baseHorizon * modeConfig.horizonBoost;

        const SAMPLES = 10;
        const predictions = [];

        for (let i = 0; i < SAMPLES; i++) {
            const p = this.predict(currentHR, currentDemand, testPower, horizon, true);
            predictions.push(p.hr);
        }

        const meanHR = predictions.reduce((a, b) => a + b, 0) / SAMPLES;

        // Dead Band Asymmetric (inherited from V7.6)
        let trackingError = 0;
        if (meanHR > targetHR + 0.3) {
            trackingError = meanHR - targetHR - 0.3;
        } else if (meanHR < targetHR - 0.8) {
            trackingError = targetHR - 0.8 - meanHR;
        }

        const sqError = Math.pow(trackingError, 2) * 22.0;

        predictions.sort((a, b) => a - b);
        const p05HR = predictions[0];
        const p95HR = predictions[Math.floor(SAMPLES * 0.95)];
        const p99HR = predictions[SAMPLES - 1];

        // Asymmetric penalties (inherited from V7.6)
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
        // [V9] 1. FILTER HR with Adaptive Kalman
        const filteredHR = this.kalman.update(rawHR);

        if (!this.state.initialized) {
            this.state.currentDemand = filteredHR;
            this.state.lastPower = currentPower;
            this.state.initialized = true;
            this.history.startTime = Date.now();
            this.kalman.reset(filteredHR);
            return currentPower;
        }

        // [V9] 2. DETECT MODE
        const mode = this.modeRecognizer.detect(this.history.hr, this.history.power);
        const modeConfig = this.modeRecognizer.getConfig();

        // [V8] 3. SMITH PREDICTOR
        const delaySecs = this.params.delay * 2.0;
        const pDet = this.predict(filteredHR, this.state.currentDemand, currentPower, delaySecs, false);

        this.history.modelOutput.push(pDet.hr);
        this.history.hr.push(filteredHR);
        this.history.power.push(currentPower);

        if (this.history.modelOutput.length > this.params.delay) this.history.modelOutput.shift();
        if (this.history.hr.length > 20) this.history.hr.shift();
        if (this.history.power.length > 10) this.history.power.shift();

        // [V8] 4. RLS ADAPTATION
        if (Math.abs(targetHR - filteredHR) < 25) {
            this.updateAdaptation(currentPower, filteredHR);
        }

        // [V9] 5. OPTIMIZER with Gain Scheduling by Mode
        const errMag = Math.abs(targetHR - filteredHR);

        // Base schedule
        let lr = 0.5;
        let maxVel = 2.5;
        if (errMag > 15) {
            lr = 0.8;
            maxVel = 5.0;
        }

        // [V9] Override by mode
        lr *= modeConfig.lr / 0.5;  // Normalized
        maxVel = modeConfig.maxVel;

        let power = this.state.lastPower;
        let velocity = this.state.momentum;
        const momentum = 0.4;

        for (let i = 0; i < 8; i++) {
            const delta = 1.0;
            const costPlus = this.calculateCost(power + delta, targetHR, filteredHR,
                this.state.currentDemand, currentPower, modeConfig);
            const costMinus = this.calculateCost(power - delta, targetHR, filteredHR,
                this.state.currentDemand, currentPower, modeConfig);
            const grad = (costPlus - costMinus) / (2 * delta);

            velocity = momentum * velocity - lr * grad;
            velocity = Math.max(-maxVel, Math.min(maxVel, velocity));

            power += velocity;

            // Anti-Windup
            if (power >= this.outputMax || power <= this.outputMin) {
                velocity = 0;
            }

            power = Math.max(this.outputMin, Math.min(this.outputMax, power));
        }

        this.state.momentum = velocity;

        // [V9] 6. SMART INTEGRAL (only if mode allows)
        const error = targetHR - filteredHR;
        const atLimit = (power >= this.outputMax - 5 || power <= this.outputMin + 5);

        let integralAdjust = 0;
        if (modeConfig.enableIntegral) {
            integralAdjust = this.integral.update(error, mode, atLimit);
            power += integralAdjust;
            power = Math.max(this.outputMin, Math.min(this.outputMax, power));
        } else {
            // Decay integral when not in STEADY
            this.integral.update(error, mode, atLimit);
        }

        // [V8] 7. UPDATE INTERNAL STATE
        const target = (power * this.rls.theta) + this.params.hrMin;
        this.state.currentDemand += (target - this.state.currentDemand) / this.params.tauDemand * 2.0;

        this.state.lastPower = power;
        return power;
    }

    getDiagnostics() {
        return {
            version: '9.0',
            ...this.kalman.getDiagnostics(),
            ...this.modeRecognizer.getDiagnostics(),
            integral: this.integral.getDiagnostics(),
            gain: this.rls.theta,
            tauRise: this.rls.tauRise,
            tauFall: this.rls.tauFall,
            momentum: this.state.momentum
        };
    }
}
