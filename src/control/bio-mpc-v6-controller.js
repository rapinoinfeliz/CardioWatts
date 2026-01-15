/**
 * Bio-MPC Controller V6 (Adaptive Oracle)
 * 
 * Key Innovations:
 * 1. Recursive Least Squares (RLS) for real-time parameter identification
 * 2. Adaptive horizon based on HR distance to target
 * 3. Ensemble prediction with correlated noise (Ornstein-Uhlenbeck process)
 * 4. Smith Predictor for sensor delay compensation
 * 5. Constraint-aware optimization with gradient descent + momentum
 * 6. Physiological zone awareness (VT1/VT2 boundary handling)
 */

export class BioMPCV6Controller {
    constructor(config = {}) {
        this.outputMin = config.outputMin || 50;
        this.outputMax = config.outputMax || 400;

        // Base Physiological Parameters (will be adapted online)
        this.params = {
            hrMin: config.hrMin || 65,
            hrMax: config.hrMax || 195,
            gain: config.gain || 0.45,
            tauDemand: config.tauDemand || 20,
            tauHRRise: config.tauHRRise || 25,
            tauHRFall: config.tauHRFall || 45,
            
            // New V6 parameters
            driftRate: 0.15,        // bpm/min cardiac drift
            sensorDelay: 6.0,       // seconds of HR sensor lag
            vt1HR: config.vt1HR || 145,  // Ventilatory threshold 1
            vt2HR: config.vt2HR || 165,  // Ventilatory threshold 2
        };

        this.state = {
            currentDemand: 65,
            lastPower: 100,
            initialized: false,
            
            // Adaptive learning state
            rlsGain: this.params.gain,
            rlsTauRise: this.params.tauHRRise,
            rlsTauFall: this.params.tauHRFall,
            covarianceP: 1.0,  // RLS covariance
            
            // History buffers for RLS and delay compensation
            hrHistory: [],      // [timestamp, hr, power]
            powerHistory: [],
            
            // Ornstein-Uhlenbeck noise state
            ouNoise: 0,
            
            // Momentum for optimization
            powerMomentum: 0,
            
            // Session tracking for drift
            sessionStartTime: null,
            cumulativeLoad: 0,
        };

        console.log("[Bio-MPC V6] Adaptive Oracle Initialized.");
    }

    reset() {
        this.state.initialized = false;
        this.state.hrHistory = [];
        this.state.powerHistory = [];
        this.state.sessionStartTime = null;
        this.state.cumulativeLoad = 0;
        this.state.powerMomentum = 0;
        console.log("[Bio-MPC V6] Reset.");
    }

    /**
     * Recursive Least Squares Parameter Adaptation
     * Continuously refines gain and tau based on observed HR response
     */
    updateRLS(currentHR, currentPower, dt) {
        const minHistory = 10;
        if (this.state.hrHistory.length < minHistory) return;

        // Get data from ~30 seconds ago for tau estimation
        const lookback = Math.min(30, this.state.hrHistory.length - 1);
        const oldData = this.state.hrHistory[this.state.hrHistory.length - lookback];
        const [oldTime, oldHR, oldPower] = oldData;
        
        const timeDelta = dt * lookback;
        const hrDelta = currentHR - oldHR;
        const powerDelta = currentPower - oldPower;

        if (Math.abs(powerDelta) > 10 && timeDelta > 15) {
            // Estimate steady-state gain
            const observedGain = hrDelta / powerDelta;
            
            // RLS update with forgetting factor
            const lambda = 0.98;
            const error = observedGain - this.state.rlsGain;
            const kalmanGain = this.state.covarianceP / (this.state.covarianceP + 0.1);
            
            this.state.rlsGain += kalmanGain * error * 0.1; // Slow adaptation
            this.state.covarianceP = lambda * (1 - kalmanGain) * this.state.covarianceP + 0.01;
            
            // Bound the gain to physiologically plausible values
            this.state.rlsGain = Math.max(0.2, Math.min(0.8, this.state.rlsGain));
            
            // Estimate tau from response speed
            if (hrDelta > 2) {
                const expectedRise = timeDelta / this.state.rlsTauRise;
                const observedRise = hrDelta / (powerDelta * this.state.rlsGain);
                const tauError = observedRise - expectedRise;
                
                this.state.rlsTauRise += tauError * 0.5;
                this.state.rlsTauRise = Math.max(15, Math.min(40, this.state.rlsTauRise));
            }
        }
    }

    /**
     * Smith Predictor: Compensate for sensor delay
     * Returns the estimated "true" current HR
     */
    compensateDelay(measuredHR, currentPower) {
        if (this.state.hrHistory.length < 3) return measuredHR;
        
        // Predict forward by sensorDelay seconds
        const delay = this.params.sensorDelay;
        return this.predict(
            measuredHR, 
            this.state.currentDemand, 
            currentPower, 
            delay, 
            0, // no noise for delay compensation
            this.state.rlsGain,
            this.state.rlsTauRise,
            this.state.rlsTauFall
        );
    }

    /**
     * Enhanced Prediction with Ornstein-Uhlenbeck Correlated Noise
     */
    predict(startHR, startDemand, power, horizonSecs, noiseLevel = 0, 
            gain = null, tauRise = null, tauFall = null) {
        
        gain = gain || this.state.rlsGain;
        tauRise = tauRise || this.state.rlsTauRise;
        tauFall = tauFall || this.state.rlsTauFall;
        
        let hr = startHR;
        let demand = startDemand;
        let ouState = this.state.ouNoise;
        const dt = 2.0;

        // Inject correlated noise (Ornstein-Uhlenbeck process)
        const ouTheta = 0.15;  // Mean reversion speed
        const ouSigma = 0.08;  // Volatility
        
        for (let t = 0; t < horizonSecs; t += dt) {
            // OU noise evolution: dX = theta*(0-X)*dt + sigma*dW
            ouState += -ouTheta * ouState * dt + ouSigma * Math.sqrt(dt) * (Math.random() - 0.5) * 2;
            
            const noiseGain = gain * (1 + ouState * noiseLevel);
            const noiseTauD = this.params.tauDemand * (1 + ouState * noiseLevel * 0.5);
            
            const target = (power * noiseGain) + this.params.hrMin;
            demand += (target - demand) / noiseTauD * dt;
            
            const tau = (demand > hr) ? tauRise : tauFall;
            const noiseTau = tau * (1 + ouState * noiseLevel * 0.3);
            
            hr += (demand - hr) / noiseTau * dt;
            
            // Apply cardiac drift (increases with cumulative load)
            const driftFactor = this.state.cumulativeLoad / 3600; // per hour
            hr += this.params.driftRate * (dt / 60) * (1 + driftFactor);
        }

        return hr;
    }

    /**
     * Adaptive Horizon Selection
     * Shorter horizons near target, longer when far away
     */
    getAdaptiveHorizon(targetHR, currentHR) {
        const error = Math.abs(targetHR - currentHR);
        
        if (error < 3) return 30;      // Very close: short horizon
        if (error < 8) return 45;      // Moderate: standard horizon
        if (error < 15) return 60;     // Far: longer prediction
        return 75;                      // Very far: max horizon
    }

    /**
     * Physiological Zone-Aware Cost Function
     */
    calculateAdaptiveCost(testPower, targetHR, currentHR, currentDemand, currentPower) {
        const SAMPLES = 25;  // Increased for better statistical power
        const HORIZON = this.getAdaptiveHorizon(targetHR, currentHR);
        const predictions = [];

        for (let i = 0; i < SAMPLES; i++) {
            predictions.push(this.predict(
                currentHR, 
                currentDemand, 
                testPower, 
                HORIZON, 
                0.12  // Increased noise for robustness
            ));
        }

        // Statistical analysis
        const meanHR = predictions.reduce((a, b) => a + b, 0) / SAMPLES;
        const stdHR = Math.sqrt(
            predictions.reduce((sum, x) => sum + Math.pow(x - meanHR, 2), 0) / SAMPLES
        );

        // 1. Tracking Error with Zone Awareness
        let error = targetHR - meanHR;
        let errorWeight = 1.0;
        
        // Near thresholds, be extra conservative
        if (Math.abs(targetHR - this.params.vt2HR) < 5) {
            errorWeight = 8.0;  // Very high precision near VT2
        } else if (Math.abs(targetHR - this.params.vt1HR) < 5) {
            errorWeight = 4.0;  // High precision near VT1
        } else if (error > 0) {
            errorWeight = 6.0;  // Aggressive when below target
        }
        
        const costError = Math.pow(error, 2) * errorWeight;

        // 2. Safety: p95 + Variance Penalty
        predictions.sort((a, b) => a - b);
        const p95HR = predictions[Math.floor(SAMPLES * 0.95)];
        const p99HR = predictions[Math.floor(SAMPLES * 0.99)];
        
        // Allow closer to target if variance is low (confidence)
        const safetyMargin = 1.0 + stdHR * 0.5;
        const overshoot95 = (p95HR > targetHR + safetyMargin) ? 
            Math.pow(p95HR - targetHR, 2) * 80 : 0;
        const overshoot99 = (p99HR > targetHR + 3) ? 
            Math.pow(p99HR - targetHR, 2) * 200 : 0;  // Hard ceiling

        // 3. Smoothness with Momentum-Aware Jerk
        const powerChange = testPower - currentPower;
        const jerkPenalty = Math.pow(powerChange, 2) * 0.12;
        
        // Penalize fighting against momentum
        const momentumPenalty = Math.abs(powerChange + this.state.powerMomentum) * 0.05;

        // 4. Efficiency: Penalize unnecessary high power
        const efficiencyPenalty = Math.pow(Math.max(0, testPower - 300), 2) * 0.001;

        return costError + overshoot95 + overshoot99 + jerkPenalty + 
               momentumPenalty + efficiencyPenalty;
    }

    /**
     * Gradient Descent with Momentum Optimization
     * More sophisticated than hill-climbing
     */
    optimizePower(targetHR, currentHR, currentDemand, currentPower) {
        let power = currentPower;
        let cost = this.calculateAdaptiveCost(power, targetHR, currentHR, currentDemand, currentPower);
        
        const learningRate = 2.0;
        const momentum = 0.7;
        let velocity = this.state.powerMomentum;
        
        // Gradient descent with momentum (5 iterations)
        for (let iter = 0; iter < 5; iter++) {
            // Numerical gradient
            const epsilon = 2.0;
            const costPlus = this.calculateAdaptiveCost(
                power + epsilon, targetHR, currentHR, currentDemand, currentPower
            );
            const costMinus = this.calculateAdaptiveCost(
                power - epsilon, targetHR, currentHR, currentDemand, currentPower
            );
            
            const gradient = (costPlus - costMinus) / (2 * epsilon);
            
            // Momentum update
            velocity = momentum * velocity - learningRate * gradient;
            power += velocity;
            
            // Project onto feasible region
            power = Math.max(this.outputMin, Math.min(this.outputMax, power));
            
            const newCost = this.calculateAdaptiveCost(
                power, targetHR, currentHR, currentDemand, currentPower
            );
            
            if (newCost < cost) {
                cost = newCost;
            } else {
                velocity *= 0.5;  // Reduce momentum if not improving
            }
        }
        
        // Fine-tune with local search
        const searchRadius = 3;
        for (let delta = -searchRadius; delta <= searchRadius; delta++) {
            const testP = Math.max(this.outputMin, Math.min(this.outputMax, power + delta));
            const testCost = this.calculateAdaptiveCost(
                testP, targetHR, currentHR, currentDemand, currentPower
            );
            if (testCost < cost) {
                cost = testCost;
                power = testP;
            }
        }
        
        this.state.powerMomentum = velocity;
        return Math.round(power);
    }

    update(targetHR, currentHR, currentPower, dt = 2.0) {
        const now = Date.now();
        
        if (!this.state.initialized) {
            this.state.currentDemand = currentHR;
            this.state.lastPower = currentPower;
            this.state.initialized = true;
            this.state.sessionStartTime = now;
            this.state.hrHistory.push([now, currentHR, currentPower]);
            this.state.powerHistory.push(currentPower);
            return currentPower;
        }

        // Update history buffers
        this.state.hrHistory.push([now, currentHR, currentPower]);
        if (this.state.hrHistory.length > 100) {
            this.state.hrHistory.shift();
        }
        
        this.state.powerHistory.push(currentPower);
        if (this.state.powerHistory.length > 50) {
            this.state.powerHistory.shift();
        }

        // Track cumulative load for drift modeling
        this.state.cumulativeLoad += currentPower * (dt / 3600);

        // Adaptive parameter learning
        this.updateRLS(currentHR, currentPower, dt);

        // Compensate for sensor delay
        const compensatedHR = this.compensateDelay(currentHR, currentPower);

        // Optimize power with advanced cost function
        const bestPower = this.optimizePower(
            targetHR, 
            compensatedHR, 
            this.state.currentDemand, 
            currentPower
        );

        // Update internal demand state
        const target = (bestPower * this.state.rlsGain) + this.params.hrMin;
        this.state.currentDemand += (target - this.state.currentDemand) / 
            this.params.tauDemand * dt;

        this.state.lastPower = bestPower;
        
        return bestPower;
    }

    // Diagnostic method for monitoring adaptation
    getDiagnostics() {
        return {
            adaptedGain: this.state.rlsGain.toFixed(3),
            adaptedTauRise: this.state.rlsTauRise.toFixed(1),
            adaptedTauFall: this.state.rlsTauFall.toFixed(1),
            covarianceP: this.state.covarianceP.toFixed(4),
            momentum: this.state.powerMomentum.toFixed(2),
            cumulativeLoad: (this.state.cumulativeLoad / 3600).toFixed(2) + ' kJ',
            historyLength: this.state.hrHistory.length
        };
    }
}
