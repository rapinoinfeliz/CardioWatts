/**
 * Bio-MPC Controller V10.0 (Bio-Adaptive Supervisory MPC)
 * 
 * Architecture:
 * - Loop 1: MPC interno (controle)
 * - Loop 2: Observador fisiológico adaptativo  
 * - Loop 3: Supervisor meta-ótimo (auto-tuning)
 * 
 * NEW FEATURES V10:
 * 1. [HIDDEN STATE] DemandObserver: Extended Kalman for metabolic demand estimation
 * 2. [AUTO-TUNE] BioSupervisor: Intent recognition + hyperparameter auto-tuning
 * 3. [MULTI-OBJ] MultiObjectiveBlender: Weighted tracking + safety + comfort
 * 4. [DRIFT] Cardiovascular drift detection
 * 
 * INHERITED from V9:
 * - Adaptive Kalman Filter
 * - Mode Recognition (RAMP/STEADY/RECOVERY)
 * - Smart Integral
 */

// ============================================
// MODULE 1: ADAPTIVE KALMAN FILTER (from V9)
// ============================================
class AdaptiveKalmanFilter {
    constructor() {
        this.x = 70;
        this.P = 10;
        this.Q = 0.5;
        this.baseR = 3.0;
        this.R = 3.0;
        this.history = [];
    }

    update(measuredHR) {
        this.history.push(measuredHR);
        if (this.history.length > 5) this.history.shift();

        if (this.history.length >= 5) {
            const mean = this.history.reduce((a, b) => a + b, 0) / 5;
            const variance = this.history.reduce((sum, val) =>
                sum + Math.pow(val - mean, 2), 0) / 5;
            const noiseFactor = Math.sqrt(variance) / 2.0;
            this.R = this.baseR * (1 + Math.min(noiseFactor, 2.0));
        }

        const xPred = this.x;
        const PPred = this.P + this.Q;
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
        return { filteredHR: this.x, R: this.R };
    }
}

// ============================================
// MODULE 2: MODE RECOGNITION (from V9)
// ============================================
class ModeRecognition {
    constructor() {
        this.currentMode = 'STEADY';
        this.hysteresisCounter = 0;
    }

    detect(hrHistory, powerHistory) {
        if (hrHistory.length < 5) return this.currentMode;

        const recent = hrHistory.slice(-5);
        const dhdt = (recent[4] - recent[0]) / 10.0;

        const recentPower = powerHistory.slice(-3);
        const powerTrend = recentPower.length >= 2 ?
            (recentPower[recentPower.length - 1] - recentPower[0]) : 0;

        let detectedMode = this.currentMode;

        if (dhdt > 1.2 && powerTrend > 5) {
            detectedMode = 'RAMP';
        } else if (dhdt < -1.0) {
            detectedMode = 'RECOVERY';
        } else if (Math.abs(dhdt) < 0.5) {
            detectedMode = 'STEADY';
        }

        if (detectedMode !== this.currentMode) {
            this.hysteresisCounter++;
            if (this.hysteresisCounter >= 3) {
                this.currentMode = detectedMode;
                this.hysteresisCounter = 0;
            }
        } else {
            this.hysteresisCounter = 0;
        }

        return this.currentMode;
    }

    reset() {
        this.currentMode = 'STEADY';
        this.hysteresisCounter = 0;
    }

    getDiagnostics() {
        return { mode: this.currentMode };
    }
}

// ============================================
// MODULE 3: SMART INTEGRAL (from V9)
// ============================================
class SmartIntegral {
    constructor() {
        this.accumulated = 0;
        this.Ki = 0.1;
        this.maxAccum = 15;
        this.lastError = 0;
    }

    update(error, mode, atPowerLimit = false) {
        if (mode !== 'STEADY' || atPowerLimit) {
            this.accumulated *= 0.5;
            this.lastError = error;
            return 0;
        }

        if (Math.abs(error) > 2.5) {
            this.accumulated *= 0.8;
            this.lastError = error;
            return this.Ki * this.accumulated;
        }

        if (error * this.lastError < 0) {
            this.accumulated *= 0.3;
        }

        let weight = error > 0 ? 1.5 : 1.0;
        this.accumulated += error * weight * 2.0;
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
        return { accumulated: this.accumulated, adjustment: this.Ki * this.accumulated };
    }
}

// ============================================
// MODULE 4: DEMAND OBSERVER (NEW V10)
// ============================================
class DemandObserver {
    constructor(params = {}) {
        this.state = {
            demand: 70,
            hr: 70,
            dhdt: 0
        };

        this.params = {
            gain: params.gain || 0.45,
            tauDemand: params.tauDemand || 20,
            tauRise: params.tauRise || 25,
            tauFall: params.tauFall || 45
        };

        this.P = [[10, 0, 0], [0, 10, 0], [0, 0, 2]];
        this.Q = 0.5;
        this.R = 2.0;
    }

    update(measuredHR, power, dt = 2.0) {
        // PREDICT STEP
        const targetDemand = (power * this.params.gain) + 65;
        const demandPred = this.state.demand +
            (targetDemand - this.state.demand) / this.params.tauDemand * dt;

        const tau = (demandPred > this.state.hr) ?
            this.params.tauRise : this.params.tauFall;

        const hrPred = this.state.hr +
            (demandPred - this.state.hr) / tau * dt;

        const dhdtPred = (hrPred - this.state.hr) / dt;

        this.P[0][0] += this.Q;
        this.P[1][1] += this.Q;
        this.P[2][2] += this.Q * 0.5;

        // UPDATE STEP
        const innovation = measuredHR - hrPred;
        const S = this.P[1][1] + this.R;
        const K = this.P[1][1] / S;

        this.state.demand = demandPred + K * innovation * 0.3;
        this.state.hr = hrPred + K * innovation;
        this.state.dhdt = dhdtPred + K * innovation * 0.1;

        this.P[1][1] = (1 - K) * this.P[1][1];

        // Physiological limits
        this.state.demand = Math.max(65, Math.min(195, this.state.demand));
        this.state.hr = Math.max(60, Math.min(200, this.state.hr));
        this.state.dhdt = Math.max(-5, Math.min(5, this.state.dhdt));

        return { ...this.state };
    }

    updateParams(newParams) {
        this.params = { ...this.params, ...newParams };
    }

    predict(power, horizon, useCurrentState = true) {
        const dt = 2.0;
        let demand = useCurrentState ? this.state.demand : 70;
        let hr = useCurrentState ? this.state.hr : 70;

        for (let t = 0; t < horizon; t += dt) {
            const targetDemand = (power * this.params.gain) + 65;
            demand += (targetDemand - demand) / this.params.tauDemand * dt;
            const tau = (demand > hr) ? this.params.tauRise : this.params.tauFall;
            hr += (demand - hr) / tau * dt;
        }

        return { demand, hr };
    }

    reset() {
        this.state = { demand: 70, hr: 70, dhdt: 0 };
        this.P = [[10, 0, 0], [0, 10, 0], [0, 0, 2]];
    }

    getDiagnostics() {
        return { ...this.state };
    }
}

// ============================================
// MODULE 5: BIO-SUPERVISOR (NEW V10)
// ============================================
class BioSupervisor {
    constructor() {
        this.inferredIntent = 'TRAINING';
        this.sessionStartTime = Date.now();
        this.sessionDuration = 0;

        this.recentOvershoots = 0;
        this.recentUndershoots = 0;
        this.oscillationCount = 0;
        this.avgError = 0;
        this.lastError = 0;
        this.lastPower = 0;

        this.driftEstimate = 0;
        this.driftOnsetTime = null;

        this.config = this.getDefaultConfig();
    }

    inferIntent(targetHR, hrMax, mode, duration) {
        this.sessionDuration = (Date.now() - this.sessionStartTime) / 60000;

        const intensityRatio = targetHR / hrMax;
        const isLongSession = this.sessionDuration > 60;

        if (intensityRatio > 0.92) {
            this.inferredIntent = 'MEDICAL';
        } else if (intensityRatio > 0.85 && !isLongSession) {
            this.inferredIntent = 'TT';
        } else if (isLongSession || (intensityRatio < 0.75 && duration > 45)) {
            this.inferredIntent = 'ENDURANCE';
        } else {
            this.inferredIntent = 'TRAINING';
        }

        return this.inferredIntent;
    }

    autoTune(context) {
        const { mode, error, variance, targetHR, hrMax } = context;

        const intent = this.inferIntent(targetHR, hrMax, mode, this.sessionDuration);
        this.config = this.getConfigByIntent(intent);

        if (mode === 'RAMP') {
            this.config.horizon *= 1.2;
            this.config.lr *= 1.4;
            this.config.maxVel *= 1.6;
            this.config.enableIntegral = false;
        } else if (mode === 'RECOVERY') {
            this.config.horizon *= 1.3;
            this.config.lr *= 0.6;
            this.config.maxVel *= 0.5;
            this.config.enableIntegral = false;
        } else if (mode === 'STEADY') {
            this.config.enableIntegral = (variance < 2.0);
            this.config.deadband = this.getAdaptiveDeadband(error, variance);
        }

        this.adaptToPerformance();

        return this.config;
    }

    getConfigByIntent(intent) {
        const configs = {
            'TT': {
                weights: { alpha: 0.70, beta: 0.20, gamma: 0.10 },
                horizon: 50, lr: 0.7, maxVel: 4.0,
                overshootPenalty: 40, undershootPenalty: 15, momentumPenalty: 0.25,
                enableIntegral: true, deadband: { lower: 0.5, upper: 0.2 }
            },
            'ENDURANCE': {
                weights: { alpha: 0.40, beta: 0.30, gamma: 0.30 },
                horizon: 55, lr: 0.5, maxVel: 2.5,
                overshootPenalty: 25, undershootPenalty: 18, momentumPenalty: 0.45,
                enableIntegral: true, deadband: { lower: 1.0, upper: 0.4 }
            },
            'MEDICAL': {
                weights: { alpha: 0.25, beta: 0.60, gamma: 0.15 },
                horizon: 60, lr: 0.4, maxVel: 2.0,
                overshootPenalty: 60, undershootPenalty: 10, momentumPenalty: 0.50,
                enableIntegral: true, deadband: { lower: 1.2, upper: 0.3 }
            },
            'TRAINING': {
                weights: { alpha: 0.55, beta: 0.30, gamma: 0.15 },
                horizon: 50, lr: 0.6, maxVel: 3.0,
                overshootPenalty: 30, undershootPenalty: 15, momentumPenalty: 0.35,
                enableIntegral: true, deadband: { lower: 0.8, upper: 0.3 }
            }
        };
        return { ...configs[intent] };
    }

    getAdaptiveDeadband(error, variance) {
        if (Math.abs(error) < 1.5 && variance < 1.5) {
            return { lower: 1.2, upper: 0.4 };
        } else if (Math.abs(error) > 5.0) {
            return { lower: 0.3, upper: 0.1 };
        }
        return this.config.deadband;
    }

    adaptToPerformance() {
        if (this.recentOvershoots > 5) {
            this.config.overshootPenalty *= 1.3;
            this.recentOvershoots = 0;
        }
        if (this.recentUndershoots > 5) {
            this.config.undershootPenalty *= 0.8;
            this.recentUndershoots = 0;
        }
        if (this.oscillationCount > 10) {
            this.config.momentumPenalty *= 1.4;
            this.oscillationCount = 0;
        }
    }

    detectDrift(observedHR, predictedHR, power) {
        if (Math.abs(power - this.lastPower) < 5) {
            const instantDrift = observedHR - predictedHR;
            this.driftEstimate = 0.95 * this.driftEstimate + 0.05 * instantDrift;

            if (Math.abs(this.driftEstimate) > 2.0 && !this.driftOnsetTime) {
                this.driftOnsetTime = Date.now();
            }
        }
        this.lastPower = power;

        return {
            drift: this.driftEstimate,
            isDrifting: Math.abs(this.driftEstimate) > 2.5,
            driftDuration: this.driftOnsetTime ?
                (Date.now() - this.driftOnsetTime) / 60000 : 0
        };
    }

    updatePerformance(error, hr, target) {
        if (hr > target + 1.5) this.recentOvershoots++;
        if (hr < target - 2.0) this.recentUndershoots++;

        if (this.lastError && error * this.lastError < 0) {
            this.oscillationCount++;
        }
        this.lastError = error;

        this.avgError = 0.9 * this.avgError + 0.1 * Math.abs(error);
    }

    getDefaultConfig() {
        return this.getConfigByIntent('TRAINING');
    }

    reset() {
        this.sessionStartTime = Date.now();
        this.recentOvershoots = 0;
        this.recentUndershoots = 0;
        this.oscillationCount = 0;
        this.avgError = 0;
        this.driftEstimate = 0;
        this.driftOnsetTime = null;
        this.config = this.getDefaultConfig();
    }

    getDiagnostics() {
        return {
            intent: this.inferredIntent,
            weights: this.config.weights,
            drift: this.driftEstimate.toFixed(2),
            avgError: this.avgError.toFixed(2),
            overshoots: this.recentOvershoots,
            oscillations: this.oscillationCount
        };
    }
}

// ============================================
// MODULE 6: MULTI-OBJECTIVE BLENDER (NEW V10)
// ============================================
class MultiObjectiveBlender {
    constructor() {
        this.weights = { alpha: 0.6, beta: 0.3, gamma: 0.1 };
    }

    blend(basePower, integralAdj, context) {
        const { weights, mode, lastPower } = context;
        this.weights = weights;

        // TRACKING COMPONENT
        const trackingPower = basePower + integralAdj;

        // SAFETY COMPONENT (limits abrupt changes)
        const maxChange = mode === 'RAMP' ? 8.0 :
            mode === 'RECOVERY' ? 3.0 : 4.0;

        const safetyPower = Math.max(
            lastPower - maxChange,
            Math.min(lastPower + maxChange, trackingPower)
        );

        // COMFORT COMPONENT (additional smoothing)
        const comfortPower = 0.3 * lastPower + 0.7 * safetyPower;

        // WEIGHTED BLEND
        const finalPower =
            this.weights.alpha * trackingPower +
            this.weights.beta * safetyPower +
            this.weights.gamma * comfortPower;

        return finalPower;
    }

    calculateCost(predictions, target, testPower, currentPower, config) {
        const { weights, overshootPenalty, undershootPenalty, momentumPenalty, deadband } = config;

        const meanHR = predictions.reduce((a, b) => a + b, 0) / predictions.length;
        predictions.sort((a, b) => a - b);
        const p05 = predictions[0];
        const p95 = predictions[Math.floor(predictions.length * 0.95)];

        // TRACKING COST (with deadband)
        let trackingError = 0;
        if (meanHR > target + deadband.upper) {
            trackingError = meanHR - target - deadband.upper;
        } else if (meanHR < target - deadband.lower) {
            trackingError = target - deadband.lower - meanHR;
        }
        const trackingCost = Math.pow(trackingError, 2) * 22.0;

        // SAFETY COST
        const overshootCost = (p95 > target + 0.7) ?
            Math.pow(p95 - target, 2) * overshootPenalty : 0;
        const undershootCost = (p05 < target - 1.5) ?
            Math.pow(target - p05, 2) * undershootPenalty : 0;
        const safetyCost = overshootCost + undershootCost;

        // COMFORT COST
        const comfortCost = Math.pow(testPower - currentPower, 2) * momentumPenalty;

        // WEIGHTED SUM
        return weights.alpha * trackingCost +
            weights.beta * safetyCost +
            weights.gamma * comfortCost;
    }
}

// ============================================
// MAIN CLASS: MPCv10
// ============================================
export class MPCv10 {
    constructor(config = {}) {
        this.outputMin = config.outputMin || 50;
        this.outputMax = config.outputMax || 400;

        this.params = {
            hrMin: 65,
            hrMax: config.hrMax || 195,
            gain: 0.45,
            tauDemand: 20,
            tauHRRise: 25,
            tauHRFall: 45,
            delay: 4
        };

        this.rls = {
            theta: this.params.gain,
            tauRise: this.params.tauHRRise,
            tauFall: this.params.tauHRFall
        };

        this.history = {
            modelOutput: [],
            hr: [],
            power: [],
            startTime: Date.now()
        };

        this.state = {
            currentDemand: 65,
            lastPower: 100,
            momentum: 0,
            initialized: false
        };

        this.noise = { value: 0, theta: 0.15, sigma: 0.1 };

        // V10 NEW COMPONENTS
        this.supervisor = new BioSupervisor();
        this.demandObserver = new DemandObserver(this.params);
        this.blender = new MultiObjectiveBlender();

        // V9 INHERITED COMPONENTS
        this.kalman = new AdaptiveKalmanFilter();
        this.modeRecognizer = new ModeRecognition();
        this.integral = new SmartIntegral();

        console.log('[Bio-MPC V10] Initialized - Supervisory Mode');
    }

    reset() {
        this.state.initialized = false;
        this.resetRLS();
        this.supervisor.reset();
        this.demandObserver.reset();
        this.kalman.reset();
        this.modeRecognizer.reset();
        this.integral.reset();
        this.history.startTime = Date.now();
        this.history.power = [];
        console.log('[Bio-MPC V10] Reset');
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

    predict(power, horizonSecs, useNoise = false) {
        const prediction = this.demandObserver.predict(power, horizonSecs, true);

        if (useNoise) {
            prediction.hr += this.nextNoise(2.0) * 5;
        }

        return prediction;
    }

    updateAdaptation(currentPower, currentHR) {
        if (currentPower < 10) return;

        const delayedModel = this.history.modelOutput[0] || currentHR;
        let error = currentHR - delayedModel;
        const effectiveErr = Math.max(-5, Math.min(5, error));

        const elapsedMins = (Date.now() - this.history.startTime) / 60000;
        let learnBoost = 1.0;
        if (elapsedMins < 5) learnBoost = 5.0;
        else if (elapsedMins < 10) learnBoost = 2.0;

        const alphaGain = 0.00005 * learnBoost;
        this.rls.theta += alphaGain * effectiveErr * (currentPower / 200);
        this.rls.theta = Math.max(0.25, Math.min(0.8, this.rls.theta));

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

        // V10: Update DemandObserver with new params
        this.demandObserver.updateParams({
            gain: this.rls.theta,
            tauRise: this.rls.tauRise,
            tauFall: this.rls.tauFall
        });
    }

    update(targetHR, rawHR, currentPower) {
        // 1. FILTER HR (Adaptive Kalman)
        const filteredHR = this.kalman.update(rawHR);

        if (!this.state.initialized) {
            this.state.currentDemand = filteredHR;
            this.state.lastPower = currentPower;
            this.state.initialized = true;
            this.history.startTime = Date.now();
            this.kalman.reset(filteredHR);
            this.demandObserver.state.hr = filteredHR;
            this.demandObserver.state.demand = filteredHR;
            return currentPower;
        }

        // 2. UPDATE DEMAND OBSERVER
        const observedState = this.demandObserver.update(filteredHR, currentPower);

        // 3. DETECT MODE
        const mode = this.modeRecognizer.detect(this.history.hr, this.history.power);

        // 4. CALCULATE HR VARIANCE (for supervisor)
        let hrVariance = 0;
        if (this.history.hr.length >= 5) {
            const recentHR = this.history.hr.slice(-5);
            const mean = recentHR.reduce((a, b) => a + b, 0) / 5;
            hrVariance = recentHR.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / 5;
        }

        // 5. AUTO-TUNE via SUPERVISOR
        const error = targetHR - filteredHR;
        const supervisorConfig = this.supervisor.autoTune({
            mode,
            error,
            variance: hrVariance,
            targetHR,
            hrMax: this.params.hrMax
        });

        // 6. DETECT DRIFT
        const driftInfo = this.supervisor.detectDrift(
            filteredHR,
            observedState.hr,
            currentPower
        );

        // 7. UPDATE PERFORMANCE STATS
        this.supervisor.updatePerformance(error, filteredHR, targetHR);

        // 8. SMITH PREDICTOR
        const delaySecs = this.params.delay * 2.0;
        const pDet = this.predict(currentPower, delaySecs, false);

        this.history.modelOutput.push(pDet.hr);
        this.history.hr.push(filteredHR);
        this.history.power.push(currentPower);

        if (this.history.modelOutput.length > this.params.delay) this.history.modelOutput.shift();
        if (this.history.hr.length > 20) this.history.hr.shift();
        if (this.history.power.length > 10) this.history.power.shift();

        // 9. RLS ADAPTATION
        if (Math.abs(error) < 25) {
            this.updateAdaptation(currentPower, filteredHR);
        }

        // 10. MPC OPTIMIZER with MULTI-OBJECTIVE COST
        const errMag = Math.abs(error);
        let lr = supervisorConfig.lr;
        let maxVel = supervisorConfig.maxVel;

        if (errMag > 15) {
            lr *= 1.3;
            maxVel *= 1.5;
        }

        let power = this.state.lastPower;
        let velocity = this.state.momentum;
        const momentum = 0.4;

        for (let i = 0; i < 8; i++) {
            const delta = 1.0;

            // Generate stochastic predictions
            const predictionsPlus = [];
            const predictionsMinus = [];
            const SAMPLES = 8;

            for (let s = 0; s < SAMPLES; s++) {
                predictionsPlus.push(this.predict(power + delta, supervisorConfig.horizon, true).hr);
                predictionsMinus.push(this.predict(power - delta, supervisorConfig.horizon, true).hr);
            }

            // Multi-objective cost
            const costPlus = this.blender.calculateCost(
                predictionsPlus, targetHR, power + delta, currentPower, supervisorConfig
            );
            const costMinus = this.blender.calculateCost(
                predictionsMinus, targetHR, power - delta, currentPower, supervisorConfig
            );

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

        // 11. SMART INTEGRAL (if enabled by supervisor)
        const atLimit = (power >= this.outputMax - 5 || power <= this.outputMin + 5);
        let integralAdjust = 0;

        if (supervisorConfig.enableIntegral) {
            integralAdjust = this.integral.update(error, mode, atLimit);
        } else {
            this.integral.update(error, mode, atLimit); // Decay
        }

        // 12. MULTI-OBJECTIVE BLEND
        const finalPower = this.blender.blend(power, integralAdjust, {
            weights: supervisorConfig.weights,
            mode,
            lastPower: this.state.lastPower
        });

        // 13. CLAMP and UPDATE STATE
        const clampedPower = Math.max(this.outputMin, Math.min(this.outputMax, finalPower));

        const target = (clampedPower * this.rls.theta) + this.params.hrMin;
        this.state.currentDemand += (target - this.state.currentDemand) / this.params.tauDemand * 2.0;

        this.state.lastPower = clampedPower;
        return clampedPower;
    }

    getDiagnostics() {
        return {
            version: '10.0',
            ...this.kalman.getDiagnostics(),
            ...this.modeRecognizer.getDiagnostics(),
            ...this.supervisor.getDiagnostics(),
            demand: this.demandObserver.state.demand.toFixed(1),
            dhdt: this.demandObserver.state.dhdt.toFixed(2),
            integral: this.integral.getDiagnostics(),
            gain: this.rls.theta.toFixed(3),
            tauRise: this.rls.tauRise.toFixed(1),
            tauFall: this.rls.tauFall.toFixed(1)
        };
    }
}
