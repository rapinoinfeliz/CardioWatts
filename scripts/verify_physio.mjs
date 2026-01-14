
import { PhysioController } from '../src/control/physio-controller.js';

const controller = new PhysioController({ outputMin: 50, outputMax: 400 });
controller.hrBufferWindow = 1; // Disable smoothing for instant logic verification

console.log("=== Verification: PhysioController Logic ===");

function runStep(targetHR, currentHR, timeStr) {
    const power = controller.update(targetHR, currentHR, 0); // Power arg is unused in current logic except for init but we simulate loop
    return power;
}

// 1. Initialization
console.log("\n--- Step 1: Initialization ---");
// Simulate 4s passing for the loop check (update interval is 5s in code, but there's a 4s check)
// Actually the code relies on Date.now(). We need to mock Date.now() or just sleep? 
// No, better to mock the controller's lastUpdateTime if possible, or just wait.
// Waiting 5s per step in a script is slow.
// Let's modify the controller instance manually for testing or subclass it.

// Hack to mock time
let fakeTime = 1000000;
const originalDateNow = Date.now;
Date.now = () => fakeTime;

// Update Helper
const tick = (ms) => fakeTime += ms;

// Init
let p = runStep(130, 80, "Init");
console.log(`Init Power: ${p}W (Expected 100W)`);

// 2. Deadband Check
console.log("\n--- Step 2: Deadband Check (Target 130, HR 129) ---");
tick(5000);
p = runStep(130, 129, "Steady"); // Error 1/130 < 2%
console.log(`Power: ${p}W (Should hold 100W)`);

// 3. Normal Increase
console.log("\n--- Step 3: Normal Increase (Target 130, HR 120) ---");
tick(5000);
p = runStep(130, 120, "Low HR"); // Error 10/130 = 7%. 
// Trend: 129 -> 120 (Drop). TrendPct?
// RiseRate = (120 - 129) / 5 = -1.8 bpm/s. 
// TrendPct = |-1.8 * 60| / 130 = 108/130 = 0.83 (> 0.05). Trend Boost should fire?
// Wait, rise rate is negative. TrendPct uses ABS(). So yes, rapid drop triggers boost logic?
// Logic: trendPct > 0.05 -> activeKp *= 2.0.
// Error positive (10). trendPct high.
// P term = 10 * (0.5 * 2) = 10.
// I term = 10 * 0.1 * 5 = 5.
// Change = 15. Slew max 1.0 * 5 = 5.
// Should increase by ~5W (clamped).
console.log(`Power: ${p}W (Should increase)`);

// 4. Rise Inhibition
console.log("\n--- Step 4: Rise Inhibition (Target 130, HR 125, Rising Fast) ---");
// We need to set lastHR to something low to simulate rise.
// Last HR was 120.
tick(5000);
// HR goes 120 -> 128 (8 bpm jump in 5s = 1.6 bpm/s)
// RiseRate 1.6 > 0.2? Yes.
// Error 2 > 0.
// Logic: activeKp *= 0.1.
// P Term: 2 * (0.5 * 0.1) = 0.1.
// I Term: 2 * 0.1 * 5 = 1.0.
// Change 1.1. Slew 5.
// Should see very small increase.
p = runStep(130, 128, "Fast Rise");
console.log(`Power: ${p}W (Should be small increase due to inhibition)`);

console.log("\n=== End Verification ===");
