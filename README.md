# CardioWatts

CardioWatts is an advanced indoor cycling control platform designed to regulate exercise intensity based on real-time physiological response. Unlike traditional ERG mode applications that maintain static power targets, CardioWatts utilizes various control theory implementations to adjust trainer resistance dynamically, ensuring the athlete remains within the precise target heart rate (HR) zone regardless of drift, fatigue, or environmental factors.

## Control Algorithms

The platform implements five generations of control logic, categorized by their predictive capabilities and physiological modeling.

### Core Control (SoftGlide & Agility)

*   **SoftGlide (V1)**: A baseline reactive controller using a proportional-integral (PI) logic variant. It adjusts resistance based on the immediate error between current and target HR. Best suited for low-intensity recovery sessions where stability is prioritized over response time.
*   **Agility V2 (Projected)**: Implements linear trend projection. By calculating the slope of heart rate changes over the previous 15 seconds, the controller projects future HR values. Resistance is adjusted preemptively if the projected HR is calculated to exceed the target.

### Model Predictive Control (Bio-MPC Series)

The Bio-MPC series utilizes a physiological state-space model to simulate athlete response.

*   **Bio-MPC V3 (Predictive)**: Features an internal second-order differential equation model (Digital Twin). Every 2 seconds, it simulates 11 potential futures across a 45-second horizon to identify the power output that minimizes cost (error and overshoot).
*   **Bio-MPC V4 (Mastermind)**: An evolution of V3 focusing on asymmetric physiology and signal processing.
    *   **Hysteresis Modeling**: Recognizes that cardiac acceleration (sympathetic) and recovery (parasympathetic) operate with different time constants.
    *   **Kalman Filtering**: Estimates hidden metabolic demand by fusing power input and HR output, effectively filtering sensor noise and transient spikes.
    *   **1W Precision**: A hill-climbing optimization path replaces discrete searching, allowing for ultra-smooth resistance transitions.
*   **Bio-MPC V5 (Stochastic Oracle)**: The current production standard for robust physiological control.
    *   **Monte Carlo Simulation**: Instead of a single deterministic simulation, V5 executes 20 parallel simulations per step, each injected with randomized physiological noise (gain and tau jitter).
    *   **p95 Safety Margin**: The controller selects a power target that is mathematically safe across 95% of predicted probable futures, ensuring robust overshoot protection in high-variability environments.
*   **Bio-MPC V6 (Adaptive Oracle)**: The current flagship controller, featuring the most advanced physiological adaptation.
    *   **Recursive Least Squares (RLS)**: Continuously adapts physiological `gain` and `tau` parameters to the individual athlete during the session.
    *   **Smith Predictor**: Compensates for the inherent ~6-second latency of HR sensors, reducing oscillation in feedback loops.
    *   **Ornstein-Uhlenbeck Noise**: Replaces Gaussian noise with correlated noise that models physiological persistence (fatigue, thermal drift).
    *   **Adaptive Horizon**: Dynamically adjusts prediction horizon (30s to 75s) based on distance from target HR.
    *   **Gradient Descent + Momentum**: Replaces hill-climbing with a true gradient-based optimizer for faster convergence.
    *   **Zone Awareness (VT1/VT2)**: Provides increased precision near critical physiological thresholds using p99 hard ceiling.

## Simulation Engine

The application includes a built-in physiological simulator for testing and validation.

### Physiological Modeling

The engine simulates cardiac response using a two-stage process:
1.  **Metabolic Demand**: Power is converted to a demand state with an approximate 20-second delay ($\tau_{demand}$).
2.  **Heart Rate Response**: The demand state drives HR through a saturated non-linear filter ($\tau_{hr} \approx 30s$).
3.  **Cardiac Drift**: The model simulates physiological drift over time, increasing HR at a rate of 0.2 bpm/min during high-intensity blocks.

### Time Compression (Speed Control)

Testing long-form intervals is facilitated by a multi-rate engine. Users can compress simulation time by factors of 2x, 4x, or 8x. All internal logic, including the MPC solvers and physics loops, scale synchronously to maintain mathematical consistency with real-time behavior.

## Usage and Implementation

1.  **Hardware Connection**: Connect via the Web Bluetooth API to any standard FTMS trainer and BLE heart rate monitor.
2.  **Algorithm Selection**: Choose the control law based on training goals. Bio-MPC V5 is recommended for high-precision intervals (e.g., Sweet Spot).
3.  **Metrics and Benchmarking**: The integrated benchmarking tool tracks "Time to Target" and "Overshoot Max," allowing for objective comparison of algorithm efficiency across different physiological profiles.

## Technical Stack

*   **Frontend**: Vanilla HTML5/CSS3 and ES6 JavaScript.
*   **Visualization**: Chart.js optimized for high-frequency data streaming.
*   **Connectivity**: Web Bluetooth API.
*   **Computational**: Real-time solvers for state-space models and Monte Carlo simulations.
