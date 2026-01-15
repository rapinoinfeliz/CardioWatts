/**
 * Bio-MPC Controller V5 (Stochastic Oracle)
 * 
 * Logic:
 * 1. Uses Monte Carlo Simulation: Predicts 20 different "probable" futures per step.
 * 2. Adds random physiological noise (Gain/Tau jitter) to each future.
 * 3. Chooses power that is safe across the majority of futures (95th percentile safety).
 */

export class MPCStochasticV5 {
    constructor(config = {}) {
        this.outputMin = config.outputMin || 50;
        this.outputMax = config.outputMax || 400;

        // Base Physiological Parameters
        this.params = {
            hrMin: 65,
            hrMax: 195,
            gain: 0.45,
            tauDemand: 20,
            tauHRRise: 25,
            tauHRFall: 45,
        };

        this.state = {
            currentDemand: 65,
            lastPower: 100,
            initialized: false
        };

        console.log("[Bio-MPC V5] Stochastic Oracle Initialized.");
    }

    reset() {
        this.state.initialized = false;
        console.log("[Bio-MPC V5] Reset.");
    }

    /**
     * Internal Prediction with Noise Injection
     */
    predict(startHR, startDemand, power, horizonSecs, noiseLevel = 0) {
        let hr = startHR;
        let demand = startDemand;
        const dt = 3.0; // Larger steps for Monte Carlo performance

        // Inject Noise into parameters
        const g = this.params.gain * (1 + (Math.random() - 0.5) * noiseLevel);
        const td = this.params.tauDemand * (1 + (Math.random() - 0.5) * noiseLevel);
        const tr = this.params.tauHRRise * (1 + (Math.random() - 0.5) * noiseLevel);
        const tf = this.params.tauHRFall * (1 + (Math.random() - 0.5) * noiseLevel);

        for (let t = 0; t < horizonSecs; t += dt) {
            const target = (power * g) + this.params.hrMin;
            demand += (target - demand) / td * dt;
            const tau = (demand > hr) ? tr : tf;
            hr += (demand - hr) / tau * dt;
        }

        return hr;
    }

    /**
     * Stochastic Cost Function (Monte Carlo)
     */
    calculateStochasticCost(testPower, targetHR, currentHR, currentDemand, currentPower) {
        const SAMPLES = 20;
        const HORIZON = 45;
        const predictions = [];

        for (let i = 0; i < SAMPLES; i++) {
            // Apply 8% physiological noise (further refined)
            predictions.push(this.predict(currentHR, currentDemand, testPower, HORIZON, 0.08));
        }

        // 1. Mean Error Squared
        const meanHR = predictions.reduce((a, b) => a + b, 0) / SAMPLES;
        const error = targetHR - meanHR;

        // Very aggressive boost when below target to eliminate steady-state bias
        const costError = Math.pow(error, 2) * (error > 0 ? 5.0 : 1.0);

        // 2. 95th Percentile Overshoot (Safety First)
        predictions.sort((a, b) => a - b);
        const p95HR = predictions[Math.floor(SAMPLES * 0.95)];
        // Allow the p95 to touch the target+1bpm before high penalty kicks in
        const overshoot = (p95HR > targetHR + 1.0) ? Math.pow(p95HR - targetHR, 2) * 60 : 0;

        // 3. Jerk Penalty (Stability vs Precision)
        const jerk = Math.pow(testPower - currentPower, 2) * 0.15;

        return costError + overshoot + jerk;
    }

    update(targetHR, currentHR, currentPower) {
        if (!this.state.initialized) {
            this.state.currentDemand = currentHR;
            this.state.lastPower = currentPower;
            this.state.initialized = true;
            return currentPower;
        }

        // --- OPTIMIZATION (Hill-Climbing over Stochastic Cost) ---
        let bestPower = currentPower;
        let minCost = this.calculateStochasticCost(bestPower, targetHR, currentHR, this.state.currentDemand, currentPower);

        const searchSteps = [10, 5, 1];
        for (const step of searchSteps) {
            let improving = true;
            while (improving) {
                improving = false;
                for (const delta of [-step, step]) {
                    const testP = Math.max(this.outputMin, Math.min(this.outputMax, bestPower + delta));
                    const cost = this.calculateStochasticCost(testP, targetHR, currentHR, this.state.currentDemand, currentPower);
                    if (cost < minCost) {
                        minCost = cost;
                        bestPower = testP;
                        improving = true;
                    }
                }
            }
        }

        // Update hidden demand state (deterministic update for stability)
        const target = (bestPower * this.params.gain) + this.params.hrMin;
        this.state.currentDemand += (target - this.state.currentDemand) / this.params.tauDemand * 2.0;

        this.state.lastPower = bestPower;
        return bestPower;
    }
}
