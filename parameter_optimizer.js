
import fs from 'fs';
import FitParser from 'fit-file-parser';
import path from 'path';

// --- Configuration ---
const FIT_DIR = './fit';
const OUTPUT_FILE = './optimized_params.json';

// --- Physiology Model (Same as Bio-MPC) ---
// Returns predicted HR array given inputs and candidates
function simulateHR(powerData, params) {
    const { gain, tauRise, tauFall, drift } = params;

    let hr = 70; // Start at rest (approx)
    let demand = 0;
    const predicted = [];
    const dt = 1; // 1 second intervals in fit file usually

    for (let t = 0; t < powerData.length; t++) {
        const watts = powerData[t];

        // 1. Demand state (fast kinetics)
        demand += (watts * gain - demand) * (1 / tauRise) * dt;

        // 2. Cardiac drift (very slow linear rise)
        // drift is bpm/hour -> bpm/second = drift / 3600
        const driftEffect = (drift / 3600) * t;

        // 3. HR Response (slower kinetics + asymmetry)
        let tau = (demand > hr) ? tauRise : tauFall;

        // Simple ODE: dHR/dt = (Target - Current) / Tau
        // Target = Rest + Demand + Drift
        const target = 60 + demand + driftEffect;
        hr += (target - hr) * (1 / tau) * dt;

        predicted.push(hr);
    }
    return predicted;
}

// --- Data Parsing ---
async function parseFitFile(filePath) {
    return new Promise((resolve, reject) => {
        const content = fs.readFileSync(filePath);
        const parser = new FitParser({
            force: true,
            speedUnit: 'km/h',
            lengthUnit: 'km',
            temperatureUnit: 'celsius',
            elapsedRecordField: true,
            mode: 'cascade',
        });

        parser.parse(content, (error, data) => {
            if (error) {
                console.error(`Error parsing ${filePath}:`, error);
                resolve(null);
            } else {
                try {
                    // Extract record messages
                    const records = data.activity?.sessions[0]?.laps[0]?.records || data.records;
                    if (!records) { resolve(null); return; }

                    const timeSeries = records.map(r => ({
                        time: r.timestamp,
                        watts: r.power || 0,
                        hr: r.heart_rate || null
                    })).filter(r => r.hr !== null); // Filter clean data

                    resolve(timeSeries);
                } catch (e) {
                    console.error('Structure error in fit file:', e);
                    resolve(null);
                }
            }
        });
    });
}

// --- Cost Function (RMSE) ---
function calculateRMSE(actualHR, predictedHR) {
    let sumSq = 0;
    let n = 0;

    // Ignore first 60 seconds (warmup noise)
    for (let i = 60; i < actualHR.length; i++) {
        const diff = actualHR[i] - predictedHR[i];
        sumSq += diff * diff;
        n++;
    }
    return Math.sqrt(sumSq / n);
}

// --- Optimization ---
async function optimize() {
    const files = fs.readdirSync(FIT_DIR).filter(f => f.endsWith('.fit'));
    console.log(`Found ${files.length} .fit files.`);

    let allData = [];

    // Load ALL files
    for (const file of files) {
        const data = await parseFitFile(path.join(FIT_DIR, file));
        if (data && data.length > 300) { // Min 5 mins
            allData.push(data);
            console.log(`Loaded ${file}: ${data.length} records`);
        }
    }

    if (allData.length === 0) {
        console.error("No valid data found.");
        return;
    }

    console.log("Starting Optimization...");

    // Grid Search + Refinement
    // We look for Gain (0.3 - 0.7), TauRise (15 - 60), TauFall (30 - 90), Drift (0 - 10)

    let bestParams = { gain: 0.45, tauRise: 25, tauFall: 45, drift: 2.0 };
    let minError = Infinity;

    // Coarse Grid
    for (let g = 0.35; g <= 0.65; g += 0.05) {
        for (let tr = 20; tr <= 50; tr += 10) {
            for (let tf = tr; tf <= tr + 40; tf += 10) { // TauFall >= TauRise usually
                // Calculate error across ALL files
                let totalError = 0;
                for (const session of allData) {
                    const watts = session.map(s => s.watts);
                    const hr = session.map(s => s.hr);
                    const pred = simulateHR(watts, { gain: g, tauRise: tr, tauFall: tf, drift: 2.0 });
                    totalError += calculateRMSE(hr, pred);
                }
                const avgError = totalError / allData.length;

                if (avgError < minError) {
                    minError = avgError;
                    bestParams = { gain: g, tauRise: tr, tauFall: tf, drift: 2.0 };
                    console.log(`New Best: Gain=${g.toFixed(2)}, Tr=${tr}, Tf=${tf} => Error=${avgError.toFixed(2)}`);
                }
            }
        }
    }

    // Fine Tuning (Hill Climbing neighbors)
    // ... Simplified for now, just logging the coarse winner ...

    console.log("------------------------------------------------");
    console.log("OPTIMIZED PARAMETERS FOUND:");
    console.log(JSON.stringify(bestParams, null, 2));
    console.log("RMSE:", minError.toFixed(2));
    console.log("------------------------------------------------");

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(bestParams));
}

optimize();
