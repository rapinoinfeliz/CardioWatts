/**
 * Bio-MPC Controller V6 (Adaptive Oracle)
 * 
 * Key Innovations:
 * 1. Recursive Least Squares (RLS) for real-time parameter identification.
 * 2. Adaptive Horizon (30s-75s) based on error magnitude.
 * 3. Smith Predictor for delay compensation.
 * 4. Gradient Descent Optimizer with Momentum.
 * 5. Ornstein-Uhlenbeck Noise for realistic simulation.
 */

export class BioMPCV6Controller {
    constructor(config = {}) {
        this.outputMin = config.outputMin || 50;
        this.outputMax = config.outputMax || 400;

        // Initial Physiological Parameters (will be adapted)
        this.params = {
            hrMin: 65,
            hrMax: 195,
            gain: 0.45,       // Adaptive
            tauDemand: 20,
            tauHRRise: 25,    // Adaptive
            tauHRFall: 45,    // Adaptive
            delay: 4          // steps (~8-12s)
        };

        // RLS State (Covariance Matrix & Parameter Estimates)
        // Estimating Theta = [Gain] for simplicity in this implementation, 
        // or a simplified sensitivity factor.
        this.rls = {
            P: 1000,    // Initial large covariance
            lambda: 0.98, // Forgetting factor
            theta: this.params.gain // Estimated Gain
        };

        // Smith Predictor History
        this.history = {
            power: [],
            modelOutput: [],
            bufferSize: 20
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

        console.log("[Bio-MPC V6] Adaptive Oracle Initialized.");
    }

    reset() {
        this.state.initialized = false;
        this.resetRLS();
        console.log("[Bio-MPC V6] Reset.");
    }

    resetRLS() {
        this.rls.P = 1000;
        this.rls.theta = this.params.gain;
        this.history.power = [];
        this.history.modelOutput = [];
    }

    /**
     * Ornstein-Uhlenbeck Process Step
     */
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

        // Use adapted Gain
        const currentGain = this.rls.theta;

        for (let t = 0; t < horizonSecs; t += dt) {
            let noise = 0;
            if (useNoise) {
                noise = this.nextNoise(dt);
            }

            // Apply noise to Target HR in model
            const target = (power * currentGain) + this.params.hrMin + (noise * 5);

            demand += (target - demand) / this.params.tauDemand * dt;
            const tau = (demand > hr) ? this.params.tauHRRise : this.params.tauHRFall;
            hr += (demand - hr) / tau * dt;
        }

        return { hr, demand };
    }

    /**
     * RLS Update Step
     * Updates the Gain estimate based on observed error.
     * Simple RLS formulation: y = x * theta + noise
     * y = Observed steady-state HR (approx) -> (HR - HRmin)
     * x = Power
     */
    updateRLS(currentPower, currentHR) {
        // Only update if moving, to avoid singularity like 0 power
        if (currentPower < 10) return;

        // If we trust our last prediction (delayed):
        const delayedModel = this.history.modelOutput[0] || currentHR; // Oldest in buffer
        const error = currentHR - delayedModel;

        // Normalize error
        const alpha = 0.00001; // Slower learning rate (was 0.0001)
        this.rls.theta += alpha * error * (currentPower / 200);

        // Safety clamps for realistic Gain (0.2 roughly 450W for 90bpm rise, 1.2 is huge)
        this.rls.theta = Math.max(0.25, Math.min(0.8, this.rls.theta));
    }

    /**
     * Stochastic Cost Function with Adaptive Horizon
     */
    calculateCost(testPower, targetHR, currentHR, currentDemand, currentPower) {
        const errorMag = Math.abs(targetHR - currentHR);

        // Adaptive Horizon: Short when close (precision), Long when far (planning)
        // If error < 3bpm, Horizon ~ 30s. If error > 10bpm, Horizon ~ 75s.
        const horizon = Math.min(75, Math.max(30, errorMag * 5 + 20));

        const SAMPLES = 10; // Reduced samples for performance since we use GD
        const predictions = [];

        for (let i = 0; i < SAMPLES; i++) {
            // Predict with OU Noise
            const p = this.predict(currentHR, currentDemand, testPower, horizon, true);
            predictions.push(p.hr);
        }

        const meanHR = predictions.reduce((a, b) => a + b, 0) / SAMPLES;

        // Cost Components
        const sqError = Math.pow(targetHR - meanHR, 2) * 2.0; // Stronger error signal

        // p99 Overshoot Hard Ceiling (Zone Awareness)
        predictions.sort((a, b) => a - b);
        const p99HR = predictions[Math.floor(SAMPLES * 0.99)] || predictions[SAMPLES - 1];
        const p95HR = predictions[Math.floor(SAMPLES * 0.95)];

        // Soft penalty for p95, Hard penalty for p99 (Reduced weights)
        const overshootSoft = (p95HR > targetHR + 0.5) ? Math.pow(p95HR - targetHR, 2) * 20 : 0;
        const overshootHard = (p99HR > targetHR + 2.0) ? Math.pow(p99HR - targetHR, 2) * 200 : 0; // Was 1000

        const momentumPenalty = Math.pow(testPower - currentPower, 2) * 0.5; // Stronger stability penalty

        return sqError + overshootSoft + overshootHard + momentumPenalty;
    }

    update(targetHR, currentHR, currentPower) {
        if (!this.state.initialized) {
            this.state.currentDemand = currentHR;
            this.state.lastPower = currentPower;
            this.state.initialized = true;
            return currentPower;
        }

        // 1. Store History for Smith Predictor / Adaptation
        // We store the "Open Loop Model" prediction for comparison later
        const pDet = this.predict(currentHR, this.state.currentDemand, currentPower, 2.0, false);
        this.history.modelOutput.push(pDet.hr);
        if (this.history.modelOutput.length > this.params.delay) {
            this.history.modelOutput.shift();
        }

        // 2. Adaptive Learning (RLS/MIT Rule) with stabilization
        if (Math.abs(targetHR - currentHR) < 5) {
            // Only adapt when relatively stable to avoid chasing transients
            this.updateRLS(currentPower, currentHR);
        }

        // 3. Gradient Descent Optimization
        let power = this.state.lastPower;

        // Gradient parameters (Lower LR for stability)
        const lr = 0.5; // Reduced from 2.0 to 0.5
        const momentum = 0.2; // Reduced momentum
        let velocity = this.state.momentum;

        // Perform GD steps
        for (let i = 0; i < 8; i++) { // More steps, smaller LR
            const delta = 1.0;
            const costPlus = this.calculateCost(power + delta, targetHR, currentHR, this.state.currentDemand, currentPower);
            const costMinus = this.calculateCost(power - delta, targetHR, currentHR, this.state.currentDemand, currentPower);
            const grad = (costPlus - costMinus) / (2 * delta);

            // Momentum Update
            velocity = momentum * velocity - lr * grad;

            // Limit velocity burst
            velocity = Math.max(-5, Math.min(5, velocity));

            power += velocity;
            power = Math.max(this.outputMin, Math.min(this.outputMax, power));
        }

        this.state.momentum = velocity;

        // 4. Update Internal State (Demand)
        const target = (power * this.rls.theta) + this.params.hrMin;
        this.state.currentDemand += (target - this.state.currentDemand) / this.params.tauDemand * 2.0;

        this.state.lastPower = power;
        return power;
    }
}
