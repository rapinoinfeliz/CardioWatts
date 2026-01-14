
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
        fatigue: 0
    };

    // Physics Engine Interval
    let loopId = null;

    function physicsLoop() {
        if (!state.simulating) return;

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

        // 2. Simulate Physiological HR Response
        // Simple First-Order Model:
        // TargetHR = RestingHR + (Power / Gain) + Drift
        // Gain approx 0.45 BPM/Watt for a fit individual (200W -> 155bpm, 65 rest -> +90bpm bump)
        // So 200 * 0.45 = 90. 65 + 90 = 155.

        const gain = 0.45;
        const metabolicPower = state.currentPower * gain + 65;

        // HR Response Lag (Tau ~ 45 seconds)
        // Update every 100ms means 10 updates per sec.
        // alpha = dt / (tau + dt) -> 0.1 / (45 + 0.1) ~ 0.002
        const alpha = 0.005; // Slightly faster for demo purposes

        state.currentHR += (metabolicPower - state.currentHR) * alpha;

        // Add Noise (Heart Rate Variability-ish)
        const noise = (Math.random() - 0.5) * 0.5;

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
        destroy, // EXPOSED
        services: { trainer: true, hr: true } // Fake services
    };
}
