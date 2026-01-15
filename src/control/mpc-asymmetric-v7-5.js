/**
 * Bio-MPC Controller V7.5 (Adaptive Flux - Stable)
 * 
 * Architecture: Built strictly on Bio-MPC V6 (Stable).
 * Enhancements:
 * 1. Asymmetric Adaptation (Rise/Fall Tau) from V7.
 * 2. Gain Scheduled Optimizer (Dampened).
 * 3. Relaxed Overshoot Penalty.
 */

export class MPCAsymmetricV7_5 {
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
            bufferSize: 20
        };

        this.state = {
            currentDemand: 65,
            lastPower: 100,
            momentum: 0,
            initialized: false
        };

        // OU Noise State (Kept from V6 for realism)
        this.noise = {
            value: 0,
            theta: 0.15,
            sigma: 0.1
        };

        console.log("[Bio-MPC V7.5] Initialized (V6 Architecture).");
    }

    reset() {
        this.state.initialized = false;
        this.resetRLS();
        console.log("[Bio-MPC V7.5] Reset.");
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

    /**
     * Prediction Model (Core ODE)
     */
    predict(startHR, startDemand, power, horizonSecs, useNoise = false) {
        let hr = startHR;
        let demand = startDemand;
        const dt = 2.0;

        // Use adapted parameters
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

            // Asymmetric Dynamics
            const tau = (demand > hr) ? tRise : tFall;
            hr += (demand - hr) / tau * dt;
        }

        return { hr, demand };
    }

    /**
     * Adaptive Logic (Hybrid V6 RLS + V7 Features)
     */
    updateAdaptation(currentPower, currentHR) {
        if (currentPower < 10) return;

        // Smith Predictor Comparison (Delay Aware)
        const delayedModel = this.history.modelOutput[0] || currentHR;
        let error = currentHR - delayedModel;

        // 1. CLAMP ERROR (V7.4 Fix)
        // Prevent huge errors from destabilizing the model
        const effectiveErr = Math.max(-5, Math.min(5, error));

        // 2. ADAPT GAIN (V6 Logic)
        // "MIT Rule": dTheta/dt = -gamma * error * sensitivity
        const alphaGain = 0.00005; // Conservative
        this.rls.theta += alphaGain * effectiveErr * (currentPower / 200);
        this.rls.theta = Math.max(0.25, Math.min(0.8, this.rls.theta));

        // 3. ADAPT TAUS (V7 Logic)
        // Analyze trend to decide which Tau to adapt
        const n = this.history.hr.length;
        if (n >= 5) {
            const recent = this.history.hr.slice(-5);
            const avg_old = (recent[0] + recent[1]) / 2;
            const avg_new = (recent[3] + recent[4]) / 2;
            const dydt = avg_new - avg_old;

            const alphaTau = 0.0005;

            if (dydt > 0.5) { // Rising
                // If Real > Model (Err > 0), Real is faster -> Decrease TauRise
                this.rls.tauRise *= (error > 0) ? (1 - alphaTau) : (1 + alphaTau);
            } else if (dydt < -0.5) { // Falling
                // If Real > Model (Err > 0), Real is slower -> Increase TauFall
                this.rls.tauFall *= (error > 0) ? (1 + alphaTau) : (1 - alphaTau);
            }

            // Bounds
            this.rls.tauRise = Math.max(15, Math.min(60, this.rls.tauRise));
            this.rls.tauFall = Math.max(25, Math.min(120, this.rls.tauFall));
        }
    }

    calculateCost(testPower, targetHR, currentHR, currentDemand, currentPower) {
        const errorMag = Math.abs(targetHR - currentHR);

        // V6 Adaptive Horizon
        const horizon = Math.min(75, Math.max(30, errorMag * 5 + 20));
        const SAMPLES = 10;
        const predictions = [];

        for (let i = 0; i < SAMPLES; i++) {
            const p = this.predict(currentHR, currentDemand, testPower, horizon, true);
            predictions.push(p.hr);
        }

        const meanHR = predictions.reduce((a, b) => a + b, 0) / SAMPLES;

        // V7.5 Refined Cost Function (Precision Fix)
        // Boosted Error Cost to ensure mean hits target
        const sqError = Math.pow(targetHR - meanHR, 2) * 10.0; // Increased to 10.0 for "magnetic" target

        predictions.sort((a, b) => a - b);
        const p95HR = predictions[Math.floor(SAMPLES * 0.95)];
        const p99HR = predictions[Math.floor(SAMPLES * 0.99)] || predictions[SAMPLES - 1];

        // 1. Precision Penalty (Soft) - Relaxed slightly
        // Previous +0.5 was too tight given the stochastic noise spread, pushing mean down.
        // Now +1.0 allows the "noise tail" to exist without punishing the mean.
        const overshootSoft = (p95HR > targetHR + 1.0) ? Math.pow(p95HR - targetHR, 2) * 20 : 0;

        // 2. Safety Penalty (Hard)
        // Strong penalty for exceeding zone boundary (+2.0)
        let overshootHard = 0;
        if (p99HR > targetHR + 2.0) {
            overshootHard = Math.pow(p99HR - targetHR, 2) * 100;
        }

        const momentumPenalty = Math.pow(testPower - currentPower, 2) * 0.5;

        return sqError + overshootSoft + overshootHard + momentumPenalty;
    }

    update(targetHR, currentHR, currentPower) {
        if (!this.state.initialized) {
            this.state.currentDemand = currentHR;
            this.state.lastPower = currentPower;
            this.state.initialized = true;
            return currentPower;
        }

        // 1. History & Smith Predictor
        const pDet = this.predict(currentHR, this.state.currentDemand, currentPower, 2.0, false);
        this.history.modelOutput.push(pDet.hr);
        this.history.hr.push(currentHR);

        if (this.history.modelOutput.length > this.params.delay) this.history.modelOutput.shift();
        if (this.history.hr.length > 20) this.history.hr.shift();

        // 2. Adaptation (Robust V6+V7 Hybrid)
        // Only adapt if error is manageable preventing blowout
        if (Math.abs(targetHR - currentHR) < 25) {
            this.updateAdaptation(currentPower, currentHR);
        }

        // 3. Gain-Scheduled Optimizer (V7 Feature - Dampened)
        const errMag = Math.abs(targetHR - currentHR);

        // Gentle Schedule
        let lr = 0.5;
        let maxVel = 2.5;

        if (errMag > 15) {
            lr = 0.8;      // Faster when far
            maxVel = 5.0;  // Allow 5W/step (approx 150W/min) - Fast but safe
        }

        let power = this.state.lastPower;
        let velocity = this.state.momentum;
        const momentum = 0.4; // High momentum for smoothing

        for (let i = 0; i < 8; i++) {
            const delta = 1.0;
            const costPlus = this.calculateCost(power + delta, targetHR, currentHR, this.state.currentDemand, currentPower);
            const costMinus = this.calculateCost(power - delta, targetHR, currentHR, this.state.currentDemand, currentPower);
            const grad = (costPlus - costMinus) / (2 * delta);

            velocity = momentum * velocity - lr * grad;
            velocity = Math.max(-maxVel, Math.min(maxVel, velocity)); // Clamp

            power += velocity;
            power = Math.max(this.outputMin, Math.min(this.outputMax, power));
        }

        this.state.momentum = velocity;

        // 4. Update Internal State
        const target = (power * this.rls.theta) + this.params.hrMin;
        this.state.currentDemand += (target - this.state.currentDemand) / this.params.tauDemand * 2.0;

        this.state.lastPower = power;
        return power;
    }
}
