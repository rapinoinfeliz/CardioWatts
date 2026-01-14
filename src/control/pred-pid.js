
// Internal Helper Class for the Feedforward Model
class AdaptiveModel {
    constructor() {
        this.points = []; // Stores {hr, power}
        // Default Starting Model (Very rough guess: 100W at 100bpm, 200W at 150bpm -> Slope: 2 Watts/BPM)
        this.slope = 2.0;
        this.intercept = -100; // Power = 2*HR - 100
        this.isLocked = false; // User Override
    }

    reset() {
        this.points = [];
        this.slope = 2.0;
        this.intercept = -100;
        this.isLocked = false;
    }

    addPoint(hr, power) {
        if (this.isLocked) return; // Don't pollute history if locked manually

        // Only accept stable points (rudimentary check logic would be outside, we just store)
        this.points.push({ hr, power });
        // Keep last 50 points to adapt to drift
        if (this.points.length > 50) this.points.shift();
        this.recalibrate();
    }

    recalibrate() {
        if (this.isLocked) return;
        if (this.points.length < 5) return; // Need data

        // Linear Regression: Power = Slope * HR + Intercept
        const n = this.points.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

        for (const p of this.points) {
            sumX += p.hr;
            sumY += p.power;
            sumXY += p.hr * p.power;
            sumXX += p.hr * p.hr;
        }

        const denominator = (n * sumXX - sumX * sumX);
        if (denominator === 0) return;

        this.slope = (n * sumXY - sumX * sumY) / denominator;
        this.intercept = (sumY - this.slope * sumX) / n;

        // Safety Clamps (Human Physiology Constraints)
        // Slope: Typically 1 to 5 Watts per Beat
        this.slope = Math.max(1.0, Math.min(5.0, this.slope));
        // Intercept: Usually negative (0 Watts at ~50bpm resting)
        // Adjust intercept to ensure reasonable values
    }

    calibrate(hr, power) {
        // FIXED CALIBRATION MODE
        // User says: "This IS the truth. Stop learning."

        // Power = Slope * HR + Intercept
        // => Intercept = Power - (Slope * HR)
        this.intercept = power - (this.slope * hr);

        // We lock it and clear history so it doesn't drift back
        this.points = [];
        this.isLocked = true;

        console.log(`AdaptiveModel: FIXED at ${hr}bpm = ${power}W (Slope: ${this.slope.toFixed(2)}, Intercept: ${this.intercept.toFixed(0)})`);
    }

    predictPower(targetHR) {
        let predicted = (this.slope * targetHR) + this.intercept;
        // Safety Clamp
        predicted = Math.max(50, predicted);
        return predicted;
    }
}

export class PredictiveController {
    constructor({ outputMin, outputMax }) {
        this.outputMin = outputMin;
        this.outputMax = outputMax;

        // Feedforward Model
        this.model = new AdaptiveModel();

        // PID State
        this.history = [];
        this.historyWindow = 120000; // Keep 2 minutes of history for better slope calculation
        this.predictionHorizon = 90; // Seconds (User input: takes ~90s to reach steady state)
        this.updateInterval = 5000;  // 5 seconds

        // PID gains (Corrective only now)
        this.Kp = 0.3;
        this.Ki = 0.02;

        this.integral = 0;
        this.lastUpdateTime = 0;
        this.lastTargetHR = 0;

        this.kp = 0.3; // Stored for reference, we use local vars
        this.startTime = Date.now(); // Track start of session
        console.log("PredictiveController: Initialized (Hybrid Model-Based)");
    }

    reset() {
        this.history = [];
        this.integral = 0;
        this.lastUpdateTime = 0;
        this.startTime = Date.now();
        this.model.reset();
        console.log("PredictiveController: Reset");
    }

    calibrate(hr, power) {
        this.model.calibrate(hr, power);
    }

    getSlope() {
        // ... (unchanged)
        const now = Date.now();
        const recent = this.history.filter(pt => now - pt.time <= 30000);
        if (recent.length < 5) return 0;
        // ...
        const n = recent.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        const t0 = recent[0].time;
        for (const pt of recent) {
            const x = (pt.time - t0) / 1000;
            const y = pt.hr;
            sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
        }
        return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    }


    update(targetHR, currentHR, currentPower) {
        const now = Date.now();

        // 0. Feed Model
        this.model.addPoint(currentHR, currentPower);
        this.history.push({ time: now, hr: currentHR });
        this.history = this.history.filter(pt => now - pt.time <= this.historyWindow);

        if (now - this.lastUpdateTime < this.updateInterval) {
            return currentPower;
        }

        // ----------------------------------------------
        // PHASE 0: WARMUP PROTOCOL (User Request)
        // ----------------------------------------------
        // Only active if we have a locked model (Calibration Set)
        if (this.model.isLocked) {
            const elapsed = (now - this.startTime) / 1000;
            const targetWatts = this.model.predictPower(targetHR); // The "150W" Baseline

            // 1. RAMP (0 - 60s): 100W -> 150W (Faster Ramp)
            if (elapsed < 60) {
                const startWatts = 100;
                const progress = elapsed / 60;
                let rampPower = startWatts + ((targetWatts - startWatts) * progress);
                console.log(`Phase 1 Ramp: ${elapsed.toFixed(1)}s | ${rampPower.toFixed(0)}W`);
                this.lastUpdateTime = now;
                return rampPower;
            }

            // 2. HOLD (60s - 150s): Hold 150W (Longer Wait of 90s)
            if (elapsed < 150) {
                console.log(`Phase 2 Hold: ${elapsed.toFixed(1)}s | ${targetWatts.toFixed(0)}W`);
                this.lastUpdateTime = now;
                return targetWatts;
            }
        }

        // ----------------------------------------------
        // PHASE 3: ADAPTIVE PID (Normal Operation)
        // ----------------------------------------------

        // 1. Calculate Feedforward Base
        // If Target Changed significantly, we assume the Model is better than the PID history
        let basePower = this.model.predictPower(targetHR);

        // 2. Predictive PID Correction (TUNED FOR UNDERSHOOT)
        const slope = this.getSlope();

        // BIAS: Aim 1.5 bpm LOWER than target to hover just under
        const effectiveTarget = targetHR - 1.5;

        const predictedHR = currentHR + (slope * this.predictionHorizon);
        let error = effectiveTarget - predictedHR;

        // Dynamic Gain (Agility)
        let activeKp = this.Kp;

        // CASE 1: Far Below -> Be Aggressive
        if (error > 5) {
            activeKp *= 1.5; // 50% more aggressive if far away
        }

        // CASE 2: Near Target & Rising Fast (Braking Zone)
        if (error < 3 && slope > 0.5) {
            // We are approaching fast. Pretend we are already over.
            error -= 2;
        }

        // CASE 3: Overshoot -> Panic Brake
        if (currentHR > targetHR) {
            activeKp *= 2.0; // Double braking power
        }

        this.integral += error * this.Ki;
        this.integral = Math.max(-20, Math.min(20, this.integral)); // Small window for I

        let correction = (error * activeKp) + this.integral;

        // 3. Hybrid Combination
        // Strategy: 
        // Start from Current Power. 
        // Add PID Correction.
        // But ... PULL towards Model Base Power lightly (Gravity).

        let proposedPower = currentPower + correction;

        // Model Gravity: If we are drifting far from what the model says, nudge back.
        // This helps if PID gets confused.
        const modelDiff = basePower - proposedPower;

        let gravityPull = 0.1; // Default 10%
        if (this.model.isLocked) {
            // "I start at 150W already to reach 127bpm"
            // We want to drive TO the baseline (150W) strongly and trust the 90s lag.
            if (error > 10) {
                gravityPull = 0.4; // Stronger pull (40%) to get to 150W
            } else if (error < 5) {
                gravityPull = 0; // Zero pull if close.
            }
        }

        proposedPower += modelDiff * gravityPull;

        // Step Limiter
        const diff = proposedPower - currentPower;
        let MAX_STEP = 3; // Ultra smooth by default

        // If far away, allow faster ramp, but not "Jolts"
        if (error > 10) MAX_STEP = 8;  // ~10s to add 50W. Smooth.
        if (error > 20) MAX_STEP = 15; // Cap at 15W absolute max jump.

        let limitedDiff = Math.max(-MAX_STEP, Math.min(MAX_STEP, diff));

        // 4. "Ideal World" Monotonicity (User Request)
        // "Never decrease power until I get close to target"
        // If we are significantly below target, ignore "braking" commands from the predictor.
        if (currentHR < (effectiveTarget - 5)) {
            if (limitedDiff < 0) {
                limitedDiff = 0; // Prevent power drop
            }
        }

        let finalPower = currentPower + limitedDiff;
        finalPower = Math.min(this.outputMax, Math.max(this.outputMin, finalPower));

        console.log(`SmartHybrid: HR:${currentHR} Pred:${predictedHR.toFixed(1)} Err:${error.toFixed(1)} | ModelBase:${basePower.toFixed(0)}W | Adj:${limitedDiff.toFixed(1)} -> Pwr:${finalPower.toFixed(0)}`);

        this.lastUpdateTime = now;
        return finalPower;
    }
}
