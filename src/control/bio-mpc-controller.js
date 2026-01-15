/**
 * Bio-MPC Controller (V3)
 * Inspired by Apple's Physiological ODE Research
 * 
 * Logic:
 * 1. Internal Model: 2-state system (Metabolic Demand -> Heart Rate)
 * 2. Optimization: Simulates multiple future power scenarios to find the best fit.
 * 3. Adaptation: Adjusts internal model parameters (Gain/Tau) based on real-world error.
 */

export class BioMPCController {
    constructor(config = {}) {
        this.outputMin = config.outputMin || 50;
        this.outputMax = config.outputMax || 400;

        // Physiological Parameters (Initial Estimates)
        this.params = {
            hrMin: 65,
            hrMax: 195,
            gain: 0.45,   // bpm/Watt
            tauDemand: 20, // Metabolic kinetics
            tauHR: 30      // Cardiac kinetics
        };

        // Controller State
        this.state = {
            currentDemand: 65,
            modeledHR: 65,
            lastPower: 100,
            learningRate: 0.01
        };

        this.initialized = false;
        console.log("[BioMPC] Controller Created.");
    }

    reset() {
        this.initialized = false;
        console.log("[BioMPC] Controller Reset.");
    }

    /**
     * Internal Simulator: Predicts HR after 'delta_t' seconds given a constant power
     */
    predict(startHR, startDemand, power, horizonSecs) {
        let hr = startHR;
        let demand = startDemand;
        const dt = 1.0; // 1s simulation steps

        for (let t = 0; t < horizonSecs; t += dt) {
            const target = (power * this.params.gain) + this.params.hrMin;

            // Demand Kinetics
            const demandDot = (target - demand) / this.params.tauDemand;
            demand += demandDot * dt;

            // HR Kinetics (Simplified S-curve for internal fast sim)
            const hrDot = 0.5 * (demand - hr) / this.params.tauHR;
            hr += hrDot * dt;
        }

        return { hr, demand };
    }

    update(targetHR, currentHR, currentPower) {
        if (!this.initialized) {
            this.state.currentDemand = currentHR;
            this.state.modeledHR = currentHR;
            this.state.lastPower = currentPower;
            this.initialized = true;
        }

        // --- 1. ONLINE LEARNING (Adaptation) ---
        // compare modeled vs actual to refine Gain/Tau
        const modelError = currentHR - this.state.modeledHR;
        if (Math.abs(modelError) > 1.0 && currentPower > 50) {
            // If actual HR is higher than model -> gain is likely higher
            this.params.gain += modelError * 0.0001;
            this.params.gain = Math.max(0.3, Math.min(0.7, this.params.gain));
        }

        // Update internal state relative to real world (synchronization)
        this.state.modeledHR = currentHR;
        // Demand is hidden, so we let it follow the model

        // --- 2. MPC OPTIMIZATION ---
        // Horizon: 45 seconds (enough to see the lag effect)
        const HORIZON = 45;
        const POWERS_TO_TEST = [-15, -10, -5, -2, -1, 0, 1, 2, 5, 10, 15];

        let bestPowerDelta = 0;
        let minCost = Infinity;

        for (const delta of POWERS_TO_TEST) {
            const testPower = Math.max(this.outputMin, Math.min(this.outputMax, currentPower + delta));
            const prediction = this.predict(currentHR, this.state.currentDemand, testPower, HORIZON);

            // Cost Function:
            // 1. Squared error at horizon (Primary goal)
            const errorAtHorizon = targetHR - prediction.hr;
            const costError = Math.pow(errorAtHorizon, 2);

            // 2. Penalty for crossing target (Overshoot protection)
            const overshootPenalty = (prediction.hr > targetHR) ? (prediction.hr - targetHR) * 100 : 0;

            // 3. Penalty for aggressive changes (Stability)
            const costJerk = Math.pow(delta, 2) * 0.1;

            const totalCost = costError + overshootPenalty + costJerk;

            if (totalCost < minCost) {
                minCost = totalCost;
                bestPowerDelta = delta;
            }
        }

        const nextPower = Math.max(this.outputMin, Math.min(this.outputMax, currentPower + bestPowerDelta));

        // Update Internal Demand for next loop
        const target = (nextPower * this.params.gain) + this.params.hrMin;
        const demandDot = (target - this.state.currentDemand) / this.params.tauDemand;
        this.state.currentDemand += demandDot * 2.0; // 2s loop

        this.state.lastPower = nextPower;
        return nextPower;
    }
}
