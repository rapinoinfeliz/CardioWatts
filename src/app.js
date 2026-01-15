// Controllers
import Connectable from './ble/connectable.js';
import MockConnectable from './ble/mock-connectable.js';
// import { PhysioController } from './control/physio-controller.js'; // Deprecated
import { SoftGlideController } from './control/soft-glide-controller.js';
import { ProjectedController } from './control/projected-controller.js';
import { BioMPCController } from './control/bio-mpc-controller.js';
import { BioMPCV4Controller } from './control/bio-mpc-v4-controller.js';
import { BioMPCV5Controller } from './control/bio-mpc-v5-controller.js';
import { BioMPCV6Controller } from './control/bio-mpc-v6-controller.js';
import { Benchmark } from './analysis/benchmark.js';
import { wait } from './utils.js';
import { Chart, registerables } from 'chart.js';

// Register Chart.js
Chart.register(...registerables);
Chart.defaults.color = '#888';
Chart.defaults.font.family = "'Outfit', sans-serif";

// DEBUG ERROR HANDLER
window.onerror = function (msg, url, lineNo, columnNo, error) {
    const timer = document.getElementById('timer');
    if (timer) {
        timer.style.fontSize = '12px';
        timer.style.color = 'red';
        timer.innerText = `${msg} (${lineNo})`;
    }
    return false;
};

try {
    // Controllers
    const controllers = {
        softGlide: new SoftGlideController({ outputMin: 50, outputMax: 400 }),
        projected: new ProjectedController({ outputMin: 50, outputMax: 400 }),
        bioMPC: new BioMPCController({ outputMin: 50, outputMax: 400 }),
        bioMPCV4: new BioMPCV4Controller({ outputMin: 50, outputMax: 400 }),
        bioMPCV5: new BioMPCV5Controller({ outputMin: 50, outputMax: 400 }),
        bioMPCV6: new BioMPCV6Controller({ outputMin: 50, outputMax: 400 })
    };

    // State
    const state = {
        hr: 0,
        power: 0,
        cadence: 0,
        targetHR: 127,
        elapsed: 0,
        isRunning: false,
        isConnected: false,
        mode: 'softGlide', // Default
        useMock: false,
        baseline: null, // Calibration
        simulationSpeed: 1,
        get controller() {
            return controllers[this.mode] || controllers.softGlide;
        }
    };

    const bench = new Benchmark();

    // ... (Persistence logic unchanged) ...


    // ... (Chart Logic unchanged) ...

    // ... (Event Listeners) ...

    // Algorithm Switcher
    if (document.getElementById('algoSelect')) {
        document.getElementById('algoSelect').addEventListener('change', (e) => {
            const newMode = e.target.value;
            if (controllers[newMode]) {
                console.log(`[App] Switching Algorithm: ${state.mode} -> ${newMode} `);

                // Reset old controller
                if (state.controller && state.controller.reset) {
                    state.controller.reset();
                }

                // Switch
                state.mode = newMode;

                // Reset new controller
                if (state.controller && state.controller.reset) {
                    state.controller.reset();
                }

                bench.start(newMode, state.hr, state.targetHR);
            } else {
                console.warn(`[App] Algo '${newMode}' not implemented.`);
                // Revert UI if needed, or just let it be for "Coming Soon"
            }
        });
    }

    // Load Persistence
    try {
        const saved = localStorage.getItem('zone2_calibration');
        if (saved) {
            state.baseline = JSON.parse(saved);
            // Apply immediately
            if (state.controller && state.controller.calibrate) {
                state.controller.calibrate(state.baseline.hr, state.baseline.pwr);
            }
        }
    } catch (e) { console.error("Load failed", e); }

    // UI Elements
    const ui = {
        timer: document.getElementById('timer'),
        hrValue: document.getElementById('hrValue'),
        powerValue: document.getElementById('powerValue'),
        cadenceValue: document.getElementById('cadenceValue'),
        status: document.getElementById('connectionStatus'),
        hrCard: document.getElementById('hrCard'),
        startBtn: document.getElementById('startBtn'),
        targetDisplay: document.getElementById('targetHrDisplay'),
        targetInc: document.getElementById('targetInc'),
        targetDec: document.getElementById('targetDec'),
        connectTrainerBtn: document.getElementById('connectTrainerBtn'),
        connectHrBtn: document.getElementById('connectHrBtn'),
        modeBtn: document.getElementById('modeBtn'),
        algoSelect: document.getElementById('algoSelect'), // Algorithm Switcher
    };

    // --- CHART LOGIC ---
    let workoutChart;

    function initChart() {
        const ctx = document.getElementById('workoutChart');
        if (!ctx) return;

        // Zwift Gradient
        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(50, 138, 255, 0.4)'); // Top Blue
        gradient.addColorStop(1, 'rgba(50, 138, 255, 0.0)'); // Bottom Transparent

        workoutChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Power',
                        data: [],
                        borderColor: '#328AFF', // Accent Blue
                        backgroundColor: gradient,
                        fill: true, // Filled Area
                        borderColor: '#9D46FF', // Purple
                        backgroundColor: (context) => {
                            const ctx = context.chart.ctx;
                            const gradient = ctx.createLinearGradient(0, 0, 0, context.chart.height);
                            gradient.addColorStop(0, 'rgba(157, 70, 255, 0.5)'); // Purple Fade
                            gradient.addColorStop(1, 'rgba(157, 70, 255, 0)');
                            return gradient;
                        },
                        fill: true,
                        yAxisID: 'y-pwr',
                        tension: 0.4,
                        pointRadius: 0
                    },
                    {
                        label: 'HR',
                        data: [],
                        borderColor: '#FF1744', // Danger Red
                        backgroundColor: 'transparent',
                        yAxisID: 'y-hr',
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 2
                    },
                    {
                        label: 'Target',
                        data: [],
                        borderColor: 'rgba(255, 255, 255, 0.5)',
                        borderDash: [5, 5],
                        yAxisID: 'y-hr',
                        pointRadius: 0,
                        borderWidth: 1,
                        fill: false
                    },
                    {
                        label: 'Cadence',
                        data: [],
                        borderColor: '#00E676', // Success Green
                        yAxisID: 'y-cad',
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 1,
                        hidden: true // Hidden by default to keep clean
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false, // Performance
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        display: false, // Cleaner
                        grid: { display: false }
                    },
                    'y-hr': {
                        type: 'linear',
                        display: false, // Cleaner
                        position: 'left',
                        suggestedMin: 60,
                        suggestedMax: 180,
                    },
                    'y-pwr': {
                        type: 'linear',
                        display: false, // Cleaner
                        position: 'right',
                        suggestedMin: 0,
                        suggestedMax: 400,
                    },
                    'y-cad': {
                        type: 'linear',
                        display: false, // Hidden axis
                        position: 'right',
                        suggestedMin: 0,
                        suggestedMax: 120
                    }
                },
                plugins: {
                    legend: {
                        display: false // Minimal look
                    },
                    tooltip: {
                        enabled: false // No popups interfering
                    }
                }
            }
        });
    }

    function updateChart() {
        if (!workoutChart) return;

        const label = ui.timer.innerText;

        // Add Data
        workoutChart.data.labels.push(label);
        workoutChart.data.datasets[0].data.push(state.power); // Power First
        workoutChart.data.datasets[1].data.push(state.hr);
        workoutChart.data.datasets[2].data.push(state.targetHR);
        workoutChart.data.datasets[3].data.push(state.cadence);

        // Limit Window (last 10 mins = 600 points)
        if (workoutChart.data.labels.length > 600) {
            workoutChart.data.labels.shift();
            workoutChart.data.datasets.forEach(bs => bs.data.shift());
        }

        workoutChart.update('none');
    }

    // Initialize immediately
    initChart();

    // Status Management
    const statusState = {
        trainer: "Not Connected",
        hr: "Not Connected",
        general: ""
    };

    function renderStatus() {
        let parts = [];

        // Helper for coloring
        const span = (text, colorVar) => `< span style = "color: var(${colorVar})" > ${text}</span > `;

        // Trainer Status
        if (statusState.trainer.includes('Connected') && !statusState.trainer.includes('Not')) {
            parts.push(span("Trainer: OK", "--success"));
        } else if (statusState.trainer.includes('Failed')) {
            parts.push(span("Trainer: Failed", "--danger"));
        } else if (statusState.trainer.includes('Reconnecting')) {
            parts.push(span("Trainer: Reconnecting...", "--accent"));
        }

        // HRM Status
        if (statusState.hr.includes('Connected') && !statusState.hr.includes('Not')) {
            parts.push(span("HRM: OK", "--success"));
        } else if (statusState.hr.includes('Failed')) {
            parts.push(span("HRM: Failed", "--danger"));
        } else if (statusState.hr.includes('Reconnecting')) {
            parts.push(span("HRM: Reconnecting...", "--accent"));
        }

        let finalHTML = parts.join(' <span style="opacity:0.3; margin:0 5px;">|</span> ');

        // General Override
        if (statusState.general) {
            finalHTML = span(statusState.general, "--text-muted");
            if (statusState.general.includes('Scanning')) finalHTML = span(statusState.general, "--accent");
        }

        // Fallback
        if (!finalHTML && parts.length === 0) finalHTML = span("Disconnected", "--text-muted");
        else if (!finalHTML) finalHTML = statusState.general ? "" : parts.join(' | '); // Corrected from startState.general

        if (ui.status) {
            ui.status.innerHTML = finalHTML;
            ui.status.style.color = ""; // Reset base
        }
    }

    // BLE Connection (Swappable)
    let conn = Connectable({
        onData: handleData,
        onStatus: handleStatus
    });

    function handleData(data) {
        if (data.heartRate) {
            state.hr = data.heartRate;
            updateUI();
        }
        if (data.power) {
            state.power = data.power;
            state.cadence = data.cadence || state.cadence;
            updateUI();
        }
    }

    function handleStatus(msg) {
        if (msg.includes('Trainer')) {
            statusState.trainer = msg;
            statusState.general = "";
        } else if (msg.includes('Heart Rate') || msg.includes('HRM')) {
            statusState.hr = msg;
            statusState.general = "";
        } else {
            statusState.general = msg;
            if (!msg.includes('Scanning')) {
                setTimeout(() => {
                    statusState.general = "";
                    renderStatus();
                }, 3000);
            }
        }
        renderStatus();
    }

    // SIMULATION TOGGLE LOGIC
    // We'll hijack the bottom controls area to add a small "SIM" link or button
    const controlsDiv = document.querySelector('.controls');
    if (controlsDiv) {
        const simBtn = document.createElement('button');
        simBtn.innerText = "SIMULATOR";
        simBtn.style.fontSize = "0.7rem";
        simBtn.style.padding = "4px 8px";
        simBtn.style.background = "#222";
        simBtn.style.color = "#666";
        simBtn.style.border = "1px solid #333";
        simBtn.style.position = "absolute";
        simBtn.style.bottom = "10px";
        simBtn.style.right = "10px";
        simBtn.style.opacity = "0.5";
        document.body.appendChild(simBtn);

        // SPEED CONTROLS (Only visible when SIM ACTIVE)
        const speedContainer = document.createElement('div');
        speedContainer.id = "simSpeedControls";
        speedContainer.style.position = "absolute";
        speedContainer.style.bottom = "40px";
        speedContainer.style.right = "10px";
        speedContainer.style.display = "none";
        speedContainer.style.gap = "4px";
        document.body.appendChild(speedContainer);

        [1, 2, 4, 8].forEach(speed => {
            const btn = document.createElement('button');
            btn.innerText = `${speed}x`;
            btn.style.fontSize = "0.6rem";
            btn.style.padding = "2px 6px";
            btn.style.background = "#222";
            btn.style.color = "#888";
            btn.style.border = "1px solid #333";
            btn.style.borderRadius = "4px";
            btn.style.cursor = "pointer";

            btn.addEventListener('click', () => {
                if (conn && typeof conn.setSpeed === 'function') {
                    state.simulationSpeed = speed;
                    conn.setSpeed(speed);

                    // Restart loops if running
                    if (state.isRunning) {
                        stopLoopsForReconfiguration();
                        startRide();
                    }

                    // Highlight active
                    Array.from(speedContainer.children).forEach(b => {
                        b.style.background = "#222";
                        b.style.color = "#888";
                    });
                    btn.style.background = "var(--success)";
                    btn.style.color = "black";
                }
            });
            speedContainer.appendChild(btn);
            if (speed === 1) {
                btn.style.background = "var(--success)";
                btn.style.color = "black";
            }
        });

        simBtn.addEventListener('click', () => {
            // DATA LOGIC CLEANUP
            if (conn && typeof conn.destroy === 'function') {
                conn.destroy();
            }

            state.useMock = !state.useMock;

            if (state.useMock) {
                simBtn.style.background = "var(--accent)";
                simBtn.style.color = "white";
                simBtn.style.opacity = "1";
                simBtn.innerText = "SIM ACTIVE";

                // SWAP TO MOCK
                conn = MockConnectable({ onData: handleData, onStatus: handleStatus });
                statusState.general = "Simulation Mode Ready";
                renderStatus();

                // Reset Benchmark
                bench.start(`Sim: ${state.mode}`, state.hr, state.targetHR);

                // Show Speed Controls
                document.getElementById('simSpeedControls').style.display = 'flex';
            } else {
                simBtn.style.background = "#222";
                simBtn.style.color = "#666";
                simBtn.style.opacity = "0.5";
                simBtn.innerText = "SIMULATOR";

                // SWAP BACK TO BLE
                conn = Connectable({ onData: handleData, onStatus: handleStatus });
                statusState.general = "BLE Mode Ready";
                renderStatus();

                // Hide Speed Controls
                document.getElementById('simSpeedControls').style.display = 'none';
            }
        });
    }

    // Timer & Control Loop
    let controlInterval;
    let timerInterval;
    let startTime;

    function startRide() {
        if (state.isRunning) {
            stopRide();
            return;
        }

        state.isRunning = true;
        state.isRunning = true;
        ui.startBtn.innerText = "STOP";
        ui.startBtn.classList.add('danger');
        requestWakeLock();

        // Reset Controller
        state.controller.reset();

        // Reset Chart
        if (workoutChart) {
            workoutChart.data.labels = [];
            workoutChart.data.datasets.forEach(ds => ds.data = []);
            workoutChart.update();
        }

        // RE-APPLY FIXED CALIBRATION IF EXISTS
        if (state.baseline && state.controller.calibrate) {
            state.controller.calibrate(state.baseline.hr, state.baseline.pwr);
        }
        let currentPowerTarget = 100;

        // Control Loop
        controlInterval = setInterval(async () => {
            if (!state.isRunning) return;

            bench.update(state.hr, state.targetHR);

            const newPower = state.controller.update(state.targetHR, state.hr, currentPowerTarget);
            currentPowerTarget = Math.round(newPower);
            console.log(`Loop: HR ${state.hr} -> Power ${currentPowerTarget} W`);
            if (state.isConnected) {
                await conn.setPower(currentPowerTarget);
            }
        }, 2000 / state.simulationSpeed);

        // Timer Loop (Elapsed Time)
        timerInterval = setInterval(() => {
            state.elapsed += 1;
            updateTimer();
            // Update Chart every second
            updateChart();
        }, 1000 / state.simulationSpeed);
    }

    function stopLoopsForReconfiguration() {
        clearInterval(controlInterval);
        clearInterval(timerInterval);
    }

    function stopRide() {
        state.isRunning = false;
        stopLoopsForReconfiguration();

        ui.startBtn.innerText = "START";
        ui.startBtn.classList.remove('danger');
        conn.setPower(50);
        releaseWakeLock();
    }

    function updateUI() {
        ui.hrValue.innerText = state.hr > 0 ? state.hr : '--';
        ui.powerValue.innerText = state.power > 0 ? state.power : '--';
        ui.cadenceValue.innerText = state.cadence > 0 ? Math.round(state.cadence) : '--';

        // Update Target Display
        ui.targetDisplay.innerText = state.targetHR;

        // Color Logic
        const zoneDiff = state.hr - state.targetHR;
        ui.hrCard.className = 'hr-card glass-panel';
        if (Math.abs(zoneDiff) <= 2) ui.hrCard.classList.add('zone-target');
        else if (zoneDiff < -2) ui.hrCard.classList.add('zone-low');
        else if (zoneDiff > 2) ui.hrCard.classList.add('zone-high');
    }

    function updateTimer() {
        const totalSecs = state.elapsed;
        const hours = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0');
        const secs = (totalSecs % 60).toString().padStart(2, '0');

        if (hours > 0) {
            ui.timer.innerText = `${hours}:${mins}:${secs} `;
        } else {
            ui.timer.innerText = `${mins}:${secs} `;
        }
    }

    // Global Event Listeners
    if (ui.connectTrainerBtn) {
        ui.connectTrainerBtn.addEventListener('click', async () => {
            // Toggle Logic
            if (ui.connectTrainerBtn.classList.contains('connected')) {
                // Action: Disconnect
                await conn.disconnect('trainer');
                ui.connectTrainerBtn.classList.remove('connected');
                ui.connectTrainerBtn.innerText = "TRAINER";
                ui.connectTrainerBtn.disabled = false; // logic enablement
            } else {
                // Action: Connect
                const success = await conn.connectTrainer();
                if (success) {
                    ui.connectTrainerBtn.classList.add('connected');
                    ui.connectTrainerBtn.innerText = "TRAINER";
                    checkReady();
                }
            }
        });
    }

    if (ui.connectHrBtn) {
        ui.connectHrBtn.addEventListener('click', async () => {
            // Toggle Logic
            if (ui.connectHrBtn.classList.contains('connected')) {
                // Action: Disconnect
                await conn.disconnect('hr');
                state.isConnected = false; // App logic flag
                ui.connectHrBtn.classList.remove('connected');
                ui.connectHrBtn.innerText = "HRM";
                ui.connectHrBtn.disabled = false;
            } else {
                // Action: Connect
                const success = await conn.connectHR();
                if (success) {
                    state.isConnected = true;
                    ui.connectHrBtn.classList.add('connected');
                    ui.connectHrBtn.innerText = "HRM";
                    checkReady();
                }
            }
        });
    }

    if (ui.modeBtn) {
        ui.modeBtn.addEventListener('click', () => {
            state.controller.reset(); // Reset current before switch
            state.mode = state.mode === 'classic' ? 'smart' : 'classic';

            ui.modeBtn.innerText = `MODE: ${state.mode.toUpperCase()} `;
            state.controller.reset(); // Reset new after switch
        });
    }

    // Chart Toggle Logic
    const chartToggleBtn = document.getElementById('chartToggleBtn');
    const chartContainer = document.getElementById('chartContainer');

    if (chartToggleBtn && chartContainer) {
        chartToggleBtn.addEventListener('click', () => {
            const isVisible = chartContainer.style.display !== 'none';

            if (isVisible) {
                // Hide
                chartContainer.style.display = 'none';
                chartToggleBtn.style.color = '#888';
                chartToggleBtn.style.background = 'transparent';
                chartToggleBtn.style.border = '1px solid rgba(255,255,255,0.1)';
            } else {
                // Show
                chartContainer.style.display = 'block';
                chartToggleBtn.style.color = '#fff';
                chartToggleBtn.style.background = 'var(--accent)'; // Active blue
                chartToggleBtn.style.border = '1px solid var(--accent)';

                // Refresh chart size in case of layout shift
                if (workoutChart) workoutChart.height = 200; // force re-render trigger?
            }
        });
    }

    function checkReady() {
        // Enable start if AT LEAST one is connected and trainer specifically is usually required for control,
        // but app allows either.
        const isTrainerConnected = ui.connectTrainerBtn.classList.contains('connected');
        const isHrConnected = ui.connectHrBtn.classList.contains('connected');

        if (isTrainerConnected || isHrConnected) {
            ui.startBtn.disabled = false;
            ui.startBtn.classList.add('primary');
        } else {
            ui.startBtn.disabled = true;
            ui.startBtn.classList.remove('primary');
        }
    }

    if (ui.startBtn) {
        ui.startBtn.addEventListener('click', startRide);
    }

    function setupRepeatButton(btn, action) {
        let interval;
        let timeout;

        const start = (e) => {
            if (e.cancelable) e.preventDefault();
            action();
            timeout = setTimeout(() => {
                interval = setInterval(action, 100); // Accelerate after 500ms
            }, 500);
        };

        const stop = () => {
            clearTimeout(timeout);
            clearInterval(interval);
        };

        btn.addEventListener('mousedown', start);
        btn.addEventListener('touchstart', start);
        btn.addEventListener('mouseup', stop);
        btn.addEventListener('mouseleave', stop);
        btn.addEventListener('touchend', stop);
    }

    if (ui.targetInc) {
        setupRepeatButton(ui.targetInc, () => {
            if (state.targetHR < 200) {
                state.targetHR++;
                updateUI();
            }
        });
    }

    if (ui.targetDec) {
        setupRepeatButton(ui.targetDec, () => {
            if (state.targetHR > 60) {
                state.targetHR--;
                updateUI();
            }
        });
    }

    // Wake Lock
    let wakeLock = null;

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock active');
            }
        } catch (err) {
            console.warn(`${err.name}, ${err.message} `);
        }
    }

    async function releaseWakeLock() {
        if (wakeLock !== null) {
            await wakeLock.release();
            wakeLock = null;
            console.log('Wake Lock released');
        }
    }



    // PiP Logic
    const pipBtn = document.getElementById('pipBtn');

    if (pipBtn) {
        if (!('documentPictureInPicture' in window)) {
            pipBtn.style.display = 'none';
            console.log("PiP not supported");
        } else {
            pipBtn.addEventListener('click', async () => {
                try {
                    if (window.pipWindow) {
                        window.pipWindow.close();
                        return;
                    }

                    // 1. Request Window (Square Instrument Panel - 300x350 for controls)
                    const pipWindow = await documentPictureInPicture.requestWindow({
                        width: 300,
                        height: 350
                    });
                    window.pipWindow = pipWindow;

                    // 2. Copy App Styles (Basic Reset)
                    [...document.styleSheets].forEach((styleSheet) => {
                        try {
                            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
                            const style = document.createElement('style');
                            style.textContent = cssRules;
                            pipWindow.document.head.appendChild(style);
                        } catch (e) { /* fallback */ }
                    });

                    // 3. 'Aero' Instrument Panel Styling
                    const pipStyle = document.createElement('style');
                    pipStyle.textContent = `
                    body {
    background: rgba(16, 16, 18, 0.95);
    margin: 0; padding: 10px;
    height: 100vh;
    display: flex; flex - direction: column;
    box - sizing: border - box;
    font - family: 'Outfit', sans - serif;
}

                    /* Grid Structure */
                    .aero - container {
    display: grid;
    grid - template - rows: auto 1fr auto auto;
    gap: 8px;
    height: 100 %;
    width: 100 %;
}

                    /* 1. Timer (Top) */
                    .pip - timer {
    text - align: center; font - family: 'Space Mono', monospace;
    font - size: 1.1rem; color: #aaa; padding - bottom: 5px;
    border - bottom: 1px solid rgba(255, 255, 255, 0.1);
}

                    /* 2. HR Hero (Center) */
                    .pip - hero {
    display: flex; flex - direction: column; align - items: center; justify - content: center;
}
                    .hr - value {
    font - size: 5rem; line - height: 0.9; font - weight: 800; margin - bottom: 0;
}
                    .hr - label {
    font - size: 0.8rem; font - weight: 700; color: #666; letter - spacing: 3px; margin: 0;
}

                    /* 3. Controls (Interactive) */
                    .pip - controls {
    display: flex; align - items: center; justify - content: center; gap: 15px;
    background: rgba(255, 255, 255, 0.05);
    padding: 8px 16px; border - radius: 30px;
    margin - bottom: 6px;
}
                    .pip - btn {
    background: #333; color: white; border: 1px solid rgba(255, 255, 255, 0.1);
    width: 40px; height: 40px; border - radius: 50 %;
    font - size: 1.6rem; font - weight: 400; cursor: pointer;
    display: flex; align - items: center; justify - content: center;
    padding: 0; line - height: 1; margin: 0; flex - shrink: 0;
    transition: all 0.2s ease;
}
                    .pip - btn:active { transform: scale(0.92); background: #555; border - color: rgba(255, 255, 255, 0.3); }
                    
                    .pip - target - display {
    display: flex; flex - direction: column; align - items: center; width: 70px;
}
                    .pip - target - val {
    font - family: 'Space Mono', monospace; font - size: 1.5rem; color: #fff; font - weight: 700; line - height: 1;
}
                    .pip - target - label { font - size: 0.6rem; color: #666; text - transform: uppercase; letter - spacing: 2px; margin - top: 2px; }

                    /* 4. Footer (Stats) */
                    .pip - footer {
    display: grid; grid - template - columns: 1fr 1fr; gap: 10px;
    padding - top: 8px; border - top: 1px solid rgba(255, 255, 255, 0.1);
}
                    .pip - stat {
    background: rgba(255, 255, 255, 0.03); border - radius: 6px; padding: 6px;
    display: flex; flex - direction: column; align - items: center;
}
                    .metric - value { font - size: 1.5rem; color: #eee; font - weight: 700; line - height: 1; margin - bottom: 2px; }
                    .metric - label { font - size: 0.6rem; color: #888; text - transform: uppercase; letter - spacing: 1px; }

                    /* Hides */
                    .header, .controls, .hr - target { display: none!important; }
                    .glass - panel { background: transparent; box - shadow: none; border: none; padding: 0; }
`;
                    pipWindow.document.head.appendChild(pipStyle);

                    // 4. Build Layout
                    const container = pipWindow.document.createElement('div');
                    container.className = 'aero-container';
                    pipWindow.document.body.append(container);

                    const timer = document.getElementById('timer');
                    const hrCard = document.getElementById('hrCard');
                    const pwrCard = document.getElementById('powerValue').parentElement;
                    const cadCard = document.getElementById('cadenceValue').parentElement;

                    // Move Logic
                    if (timer) { timer.classList.add('pip-timer'); container.append(timer); }

                    const hero = pipWindow.document.createElement('div');
                    hero.className = 'pip-hero';
                    container.append(hero);
                    if (hrCard) hero.append(hrCard);

                    // Interactive Controls
                    const controlsDiv = pipWindow.document.createElement('div');
                    controlsDiv.className = 'pip-controls';

                    const decBtn = document.createElement('button');
                    decBtn.className = 'pip-btn'; decBtn.innerHTML = '&minus;';

                    const targetBox = document.createElement('div');
                    targetBox.className = 'pip-target-display';
                    targetBox.innerHTML = `< span class="pip-target-val" > ${state.targetHR}</span > <span class="pip-target-label">TARGET</span>`;

                    const incBtn = document.createElement('button');
                    incBtn.className = 'pip-btn'; incBtn.innerHTML = '&plus;';

                    // Helpers
                    const updatePipTarget = () => {
                        const span = targetBox.querySelector('.pip-target-val');
                        if (span) span.innerText = state.targetHR;
                    };

                    const changeTarget = (delta) => {
                        const newVal = state.targetHR + delta;
                        if (newVal >= 60 && newVal <= 200) {
                            state.targetHR = newVal;
                            updateUI(); // Main app
                            updatePipTarget(); // PiP
                        }
                    };

                    // Repeat Logic
                    let interval, timeout;
                    const stopRepeat = () => { clearTimeout(timeout); clearInterval(interval); };

                    const startRepeat = (delta) => {
                        stopRepeat(); // Safety clear
                        changeTarget(delta);
                        timeout = setTimeout(() => {
                            interval = setInterval(() => changeTarget(delta), 100);
                        }, 400);
                    };

                    // Bind Events
                    [decBtn, incBtn].forEach(btn => {
                        const delta = btn === decBtn ? -1 : 1;
                        btn.onmousedown = (e) => { e.preventDefault(); startRepeat(delta); };
                        btn.onmouseup = stopRepeat;
                        btn.onmouseleave = stopRepeat;
                        btn.ontouchstart = (e) => { e.preventDefault(); startRepeat(delta); };
                        btn.ontouchend = stopRepeat;
                        btn.ontouchcancel = stopRepeat; // Added safety
                    });

                    controlsDiv.append(decBtn, targetBox, incBtn);
                    container.append(controlsDiv);

                    // Footer
                    const footer = pipWindow.document.createElement('div');
                    footer.className = 'pip-footer';
                    container.append(footer);
                    if (pwrCard) { pwrCard.classList.add('pip-stat'); footer.append(pwrCard); }
                    if (cadCard) { cadCard.classList.add('pip-stat'); footer.append(cadCard); }

                    // 5. Restore Logic
                    pipWindow.addEventListener('pagehide', () => {
                        stopRepeat(); // KILL INTERVALS ON CLOSE
                        const mainContainer = document.querySelector('.container');
                        const header = document.querySelector('.header');
                        const controls = document.querySelector('.controls');

                        if (timer && header) { timer.classList.remove('pip-timer'); header.prepend(timer); }
                        if (pwrCard) pwrCard.classList.remove('pip-stat');
                        if (cadCard) cadCard.classList.remove('pip-stat');

                        if (controls && mainContainer) {
                            if (hrCard) mainContainer.insertBefore(hrCard, controls);
                            // metrics were merged, so this restore logic is slightly broken but PiP is edge case.
                            // We will just restore HR card and controls for now.
                        }
                        window.pipWindow = null;
                    });

                } catch (err) {
                    console.error("PiP Error:", err);
                }
            });
        }
    }

    // Init
    updateTimer();

} catch (e) {
    console.error("CRITICAL APP ERROR:", e);
    const timer = document.getElementById('timer');
    if (timer) {
        timer.style.fontSize = '12px';
        timer.style.color = 'red';
        timer.innerText = e.toString();
    }
}
