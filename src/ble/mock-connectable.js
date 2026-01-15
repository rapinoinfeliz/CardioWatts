
// Mock Devices for Simulation
// Simulates a ThinkRider X2 and Garmin HRM-Pro+
// includes a basic physiological model for HR response to power.

export default function MockConnectable(args = {}) {
    const onData = args.onData || (d => console.log('data', d));
    const onStatus = args.onStatus || (s => console.log('status', s));

    // Simulation State
    let state = {
        simulating: false,
        trainerConnected: false,
        hrConnected: false,
        targetPower: 100,
        currentPower: 0,
        currentCadence: 0,
        currentHR: 65, // Resting HR
        currentDemand: 65,
        fatigue: 0,
        simStartTime: 0,
        speedMultiplier: 1
    };

    // Physics Engine Interval
    let loopId = null;

    function physicsLoop() {
        if (!state.simulating) return;

        // Effective dt (10Hz loop = 0.1s base)
        const dt = 0.1 * state.speedMultiplier;

        // 1. Simulate Trainer Response (ERG Mode Lag)
        // ThinkRider X2 takes about 2-3 seconds to smooth to target
        const powerDiff = state.targetPower - state.currentPower;
        state.currentPower += powerDiff * 0.1; // Smooth approach

        // Simulate Cadence (Random fluctuation around 85-90 if power > 0)
        if (state.targetPower > 0) {
            const targetCadence = 88;
            state.currentCadence += (targetCadence - state.currentCadence) * 0.2 + (Math.random() - 0.5) * 2;
        } else {
            state.currentCadence = 0;
        }

        // 2. Simulate Physiological HR Response (Apple-inspired ODE)
        // State 1: Demand (Metabolic intensity)
        // State 2: Heart Rate (Following demand)

        // Configuration
        const HR_MIN = 65;
        const HR_MAX = 195;
        const GAIN = 0.45; // bpm/Watt
        const TAU_DEMAND = 20.0; // Seconds (Fastest metabolic response)
        const TAU_HR = 30.0; // Seconds (Cardiac lag)
        const ALPHA = 0.5; // Lower-bound saturation
        const BETA = 0.8;  // Upper-bound saturation (Stronger near HR Max)

        // Cardiac Drift: +0.2 bpm every minute (~1 bpm per 5 mins)
        if (state.simStartTime === 0) state.simStartTime = Date.now();
        const elapsedMins = (Date.now() - state.simStartTime) / 60000;
        const drift = state.currentPower > 50 ? (elapsedMins * 0.2) : 0;

        // Current Intensity Target
        const metabolicPowerTarget = (state.currentPower * GAIN) + HR_MIN + drift;

        // Update Demand State
        // dD/dt = (Target - D) / Tau
        const demandDot = (metabolicPowerTarget - (state.currentDemand || state.currentHR)) / TAU_DEMAND;
        state.currentDemand = (state.currentDemand || state.currentHR) + demandDot * dt;

        // Update HR State with Saturation
        // S = ((HR - HR_MIN)/60)^alpha * ((HR_MAX - HR)/60)^beta
        const f_min = Math.pow(Math.abs(state.currentHR - HR_MIN + 0.1) / 60, ALPHA);
        const f_max = Math.pow(Math.abs(HR_MAX - state.currentHR + 0.1) / 60, BETA);

        // hr_dot = A * f_min * f_max * (Demand - HR)
        // A is a scaling factor to keep kinetics realistic (~0.5)
        const A = 0.5;
        let hrDot = A * f_min * f_max * (state.currentDemand - state.currentHR);

        // Clamping/Safety logic at boundaries
        if (state.currentHR >= HR_MAX && hrDot > 0) hrDot = HR_MAX - state.currentHR;
        if (state.currentHR <= HR_MIN && hrDot < 0) hrDot = HR_MIN - state.currentHR;

        state.currentHR += hrDot * dt;

        // Add Noise (Heart Rate Variability-ish)
        const noise = (Math.random() - 0.5) * 0.4;

        // Emit Data
        const output = {};

        if (state.trainerConnected) {
            output.power = Math.round(state.currentPower);
            output.cadence = Math.round(state.currentCadence);
        }

        if (state.hrConnected) {
            output.heartRate = Math.round(state.currentHR + noise);
        }

        // Only emit if we have data and connections
        if (state.trainerConnected || state.hrConnected) {
            onData(output);
        }
    }

    function startLoop() {
        if (!loopId) {
            state.simulating = true;
            loopId = setInterval(physicsLoop, 100); // 10Hz physics
            console.log("Mock Physics Engine Started");
        }
    }

    function stopLoop() {
        if (loopId && !state.trainerConnected && !state.hrConnected) {
            clearInterval(loopId);
            loopId = null;
            state.simulating = false;
            console.log("Mock Physics Engine Stopped");
        }
    }

    async function connectTrainer() {
        return new Promise(resolve => {
            setTimeout(() => {
                state.trainerConnected = true;
                onStatus("Mock Trainer Connected");
                startLoop();
                resolve(true);
            }, 800);
        });
    }

    async function connectHR() {
        return new Promise(resolve => {
            setTimeout(() => {
                state.hrConnected = true;
                onStatus("Mock HRM Connected");
                startLoop();
                resolve(true);
            }, 800);
        });
    }

    async function disconnect(type) {
        if (type === 'trainer') {
            state.trainerConnected = false;
            onStatus("Mock Trainer Disconnected");
        } else if (type === 'hr') {
            state.hrConnected = false;
            onStatus("Mock HRM Disconnected");
        }
        stopLoop();
    }

    async function setPower(watts) {
        // In simulation, we just accept it
        console.log(`[Mock] Target Power set to ${watts}W`);
        state.targetPower = watts;
    }

    function setSpeed(multiplier) {
        state.speedMultiplier = multiplier;
        console.log(`[Mock] Simulation speed set to ${multiplier}x`);
    }

    async function destroy() {
        if (loopId) {
            clearInterval(loopId);
            loopId = null;
        }
        state.simulating = false;
        console.log("Mock Physics Engine Destroyed");
    }

    return {
        connectTrainer,
        connectHR,
        disconnect,
        setPower,
        setSpeed,
        destroy, // EXPOSED
        services: { trainer: true, hr: true } // Fake services
    };
}
