export class Benchmark {
    constructor() {
        this.reset();
    }

    reset() {
        this.startTime = null;
        this.startHR = 0;
        this.targetHR = 0;
        this.reached = false;
        this.reachTime = null;
        this.maxHR = 0;
        this.algoName = "";

        // Stats
        this.samples = 0;
        this.sumError = 0;

        console.log("%c[Benchmark] Ready.", "color: #00ffff");
    }

    start(algoName, currentHR, targetHR) {
        this.reset();
        this.algoName = algoName;
        this.startTime = Date.now();
        this.startHR = currentHR;
        this.targetHR = targetHR;
        this.maxHR = currentHR;

        console.log(`%c[Benchmark] STARTED (${algoName})`, "color: #00ffff; font-weight: bold;");
        console.log(`%c[Benchmark] Target: ${targetHR} (Start: ${currentHR})`, "color: #888");
    }

    update(currentHR, targetHR) {
        // 1. Auto-Start or Detect Scenario Change
        if (!this.startTime || targetHR !== this.targetHR) {
            this.start(this.algoName || "Default", currentHR, targetHR);
            return;
        }

        const now = Date.now();
        const elapsed = (now - this.startTime) / 1000;

        // 2. Track Max HR
        if (currentHR > this.maxHR) {
            this.maxHR = currentHR;
        }

        // 3. Detect Reached Event (Zone +/- 2 bpm)
        const inZone = Math.abs(currentHR - this.targetHR) <= 2;
        if (!this.reached && inZone) {
            this.reached = true;
            this.reachTime = elapsed;
            console.log(`%c[Benchmark] ⏱️ ZONE REACHED in ${elapsed.toFixed(1)}s`, "color: #00ff00; font-weight: 900; font-size: 1.5em;");
            this.report(); // Show full stats immediately
        }

        // 4. Track Overshoot & Stability
        if (this.reached) {
            const overshoot = Math.max(0, currentHR - this.targetHR);
            if (overshoot > 0 && !(this.lastOvershoot === overshoot)) {
                // Only log new maximums to avoid spam
                // Actually, let's keep it silent and only report summary
            }
        }
    }

    report() {
        if (!this.startTime) return;
        const now = Date.now();
        const elapsed = (now - this.startTime) / 1000;
        const overshoot = Math.max(0, this.maxHR - this.targetHR);

        console.group(`[Benchmark Report] ${this.algoName}`);
        console.log(`Time Elapsed: ${elapsed.toFixed(1)}s`);
        if (this.reached) {
            console.log(`%cTime to Target: ${this.reachTime.toFixed(1)}s`, "color: #00ff00");
            console.log(`%cMax Overshoot: +${overshoot} bpm`, overshoot > 2 ? "color: red" : "color: green");
        } else {
            console.log(`Target Not Reached Yet (Current: ${this.maxHR})`);
        }
        console.groupEnd();
    }
}
