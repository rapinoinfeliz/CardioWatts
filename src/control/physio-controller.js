
export class PhysioController {
    constructor({ outputMin, outputMax }) {
        this.outputMin = outputMin || 50;
        this.outputMax = outputMax || 400;

        // Constants (TrainerDay Specifics)
        this.DEFAULT_K = 0.4;
        this.HARD_CAP_HR = 135;
        this.TARGET_TOLERANCE = 2; // Deadband

        // Control Parameters (Conservative Base)
        this.UPDATE_INTERVAL = 5000; // 5 seconds (Tradeoff between TD's 30s and responsiveness)
        this.Kp = 0.3; // Specific User Request: "Initial increments too aggressive"
        this.Ki = 0.1;
        this.MAX_SLEW_RATE = 1.0;

        // State
        this.k_est = this.DEFAULT_K;
        this.hrBuffer = [];
        this.hrBufferWindow = 10;

        // REMOVED: this.integral (Double Integration Bug Fix)
        this.lastUpdateTime = 0;
        this.lastOutputPower = 0;
        this.lastHR = 0;

        this.isInitialized = false;
        this.initialRestHR = null;
    }

    reset() {
        this.hrBuffer = [];
        // this.integral = 0; // Removed
        this.lastUpdateTime = 0;
        this.k_est = this.DEFAULT_K;
        this.isInitialized = false;
        this.initialRestHR = null;
        console.log("[PhysioController] Reset (TrainerDay Logic Active).");
    }

    calibrate(hr, power) {
        console.log(`[PhysioController] Manual Calibration ignored.`);
    }

    getFilteredHR() {
        if (this.hrBuffer.length === 0) return 0;
        const sum = this.hrBuffer.reduce((a, b) => a + b, 0);
        return sum / this.hrBuffer.length;
    }

    update(targetHR, currentHR, currentPower) {
        const now = Date.now();

        // 1. Input Filtering
        this.hrBuffer.push(currentHR);
        if (this.hrBuffer.length > this.hrBufferWindow) this.hrBuffer.shift();
        const filteredHR = this.getFilteredHR();

        // 2. Initialization
        if (!this.isInitialized) {
            this.initialRestHR = currentHR;
            this.isInitialized = true;
            this.lastUpdateTime = now;
            this.lastHR = currentHR;
            this.overshootTimer = 0; // Reset Timer

            // User Request: Fixed Start at 100W
            let initialPower = 100;

            this.lastOutputPower = initialPower;
            console.log(`[PhysioController] Init: Fixed Start @ ${initialPower}W`);
            return initialPower;
        }

        // 3. Timing Check
        const dt = (now - this.lastUpdateTime) / 1000;
        if (dt < 4.0) { // 4s Loop (min)
            return this.lastOutputPower;
        }
        this.lastUpdateTime = now;

        // 4. Safety Override (Disabled for testing)
        /*
        if (currentHR > this.HARD_CAP_HR) {
            console.warn(`[PhysioController] HARD CAP`);
            let safePower = this.lastOutputPower - 10;
            safePower = Math.max(this.outputMin, safePower);
            this.lastOutputPower = safePower;
            return safePower;
        }
        */

        // --- NEW LOGIC (User "Fine Tuning" Request) ---
        // Zone A: Alert Zone (Overshoot) -> Wait 3s, then Drop Gently
        // Zone B: Safe Zone (Target-1 to Target+1) -> Hold
        // Zone C: Recovery Zone (< Target-1) -> Increase

        // Safety Offset: Aim 1 bpm lower so the User's Target is the ceiling.
        const operationalTarget = targetHR - 1;

        let targetPower = this.lastOutputPower;
        const overshootThreshold = operationalTarget + 1; // e.g. 126+1 = 127 (User Target)

        // Safety Floor Raised (User Request):
        // "If 127, holding 124-127 is ok. If 124, start increasing." -> Floor = 125.
        // So HR 124 < 125 -> Increase. HR 125 >= 125 -> Hold.
        const safeFloor = operationalTarget - 1; // e.g. 126-1 = 125

        if (filteredHR > overshootThreshold) {
            // ZONE A: ALERT (Above Target)
            this.overshootTimer += dt;

            if (this.overshootTimer < 3.0) {
                // Phase 1: WAIT (Hysteresis)
                console.log(`[PhysioPI] HR:${filteredHR.toFixed(1)} > ${overshootThreshold}. WAITING (${this.overshootTimer.toFixed(1)}s/3.0s)`);
                return this.lastOutputPower;
            } else {
                // Phase 2: DROP GENTLY
                // User said "starting with 0.5w" (Gentle drop). 
                // 1W step / 5s = 0.2 W/s.
                const dropAmount = 0.2 * dt;
                targetPower -= dropAmount;
                console.log(`[PhysioPI] HR:${filteredHR.toFixed(1)} > ${overshootThreshold}. DROPPING (Timer Expired). -${dropAmount.toFixed(1)}W`);
            }

        } else if (filteredHR >= safeFloor) {
            // ZONE B: SAFE ZONE
            // User: "125-127 is acceptable holding"
            this.overshootTimer = 0; // Reset timer if we dip back in
            console.log(`[PhysioPI] HR:${filteredHR.toFixed(1)} Safe Zone [${safeFloor}-${overshootThreshold}]. HOLDING.`);
            return this.lastOutputPower;

        } else {
            // ZONE C: RECOVERY (< 125 - e.g. 124)
            // Normal PID Logic to raise power
            this.overshootTimer = 0;

            const error = operationalTarget - filteredHR; // Use operational target
            let adjustment = error * this.Kp;

            // Dynamic Slew Rate (User Request: "Linear reduction... 1W@10bpm, 0.5W@5bpm, 0.2W@1bpm")
            // Formula: Rate = Error * 0.02.
            // Loop ~5s. 1W step / 5s = 0.2 W/s.
            // 10 bpm * 0.02 = 0.2 W/s (1W step). Matches.
            // 5 bpm * 0.02 = 0.1 W/s (0.5W step). Matches.
            // 1 bpm * 0.02 = 0.02 W/s (0.1W step). Matches (close to 0.2W requested).

            let slewRate = error * 0.02;
            slewRate = Math.max(0.04, slewRate);           // Min Floor (0.2W step)
            slewRate = Math.min(this.MAX_SLEW_RATE, slewRate); // Max Cap (1.0)

            // Cap Rise Rate
            const maxRise = slewRate * dt;
            adjustment = Math.min(adjustment, maxRise);

            targetPower += adjustment;
            console.log(`[PhysioPI] HR:${filteredHR.toFixed(1)} Low Loop. Err:${error.toFixed(1)} Rate:${slewRate.toFixed(3)} Adj:+${adjustment.toFixed(1)}W`);
        }

        // Global Limits
        targetPower = Math.min(this.outputMax, Math.max(80, targetPower));

        this.lastOutputPower = targetPower;
        return targetPower;
    }
}
