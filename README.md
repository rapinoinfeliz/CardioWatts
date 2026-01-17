# CardioWatts - Bio-Adaptive Supervisory MPC 🧠🚴

CardioWatts is an advanced heart rate controller for indoor cycling, utilizing Model Predictive Control (MPC) with physiological state estimation (Bio-Observer) and contextual intelligence to maintain precise metabolic targets.

## 🚀 Bio-MPC V10.1 "Personal Tuned"
**The latest version uses Offline Learning to personalize internal parameters to YOUR unique physiology.**

### Features V10.1
*   **Zero-Configuration:** Starts with perfect `Gain` and `Tau` values derived from your history.
*   **Drift Compensation:** Knows exactly how much your HR drifts per hour.
*   **Supervisory Layer:** Auto-detects `Intervals`, `Steady State`, and `Recovery` phases.
*   **Multi-objective:** Blends tracking accuracy with safety and comfort.

## 🧠 Offline Learning (How to Personalize)
1.  Place your `.fit` files in the `fit/` folder.
2.  Run the optimizer:
    ```bash
    node parameter_optimizer.js
    ```
3.  The algorithm will find your physiological constants (Gain, TauRise, TauFall).
4.  Bio-MPC V10.1 will automatically be tuned with these values.

## Algorithms
*   **Bio-MPC V10.1 (Personal Tuned):** **(Default)** Optimized with your data. best performance.
*   **Bio-MPC V10.0 (Supervisory):** Auto-adaptive, zero-config for general users.
*   **Bio-MPC V9.0 (Contextual):** Uses Adaptive Kalman Filter & Smart Integral.
*   **Bio-MPC V8.0 (Zero Error):** Aggressive Integral action for precision.
*   **Bio-MPC V7.6 (Precision):** Robust asymmetric deadband control.

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
*   **Bio-MPC V6 (Adaptive Oracle)**: The pinnacle of the series, introducing self-learning capabilities.
    *   **Recursive Least Squares (RLS)**: Real-time parameter identification adapts the internal model to the athlete's specific gain and kinetics during the workout.
    *   **Smith Predictor**: Explicitly compensates for the ~8s delay inherent in heart rate sensors, eliminating oscillation potential.
    *   **Gradient Descent**: Replaces discrete hill-climbing with a momentum-based gradient optimizer for fluid power adjustments.
*   **Bio-MPC V7.4 (Adaptive Flux)**: The refinement of V6, focusing on physiological asymmetry.
    *   **Asymmetric Adaptation**: Separates learning rates for heart rate rise (sympathetic) and fall (parasympathetic), mirroring human physiology.
    *   **Gain Scheduling**: Dynamically adjusts the optimization aggression based on error magnitude—gentle when close, rapid when far.
    *   **Delay-Aware Matching**: Parameters are updated by comparing reality against the *delayed* model output, ensuring strict causal correctness.

### Comparative Analysis

| Feature | SoftGlide (V1) | Agility (V2) | Bio-MPC V3 | Bio-MPC V4 | Bio-MPC V5 | Bio-MPC V6 | Bio-MPC V7.4 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Methodology** | Reactive PI | Linear Projection | Deterministic MPC | MPC + Kalman | MPC + Monte Carlo | MPC + RLS + Smith | **MPC + Asymmetric RLS** |
| **Prediction Horizon** | 0s (Real-time) | 15s (Linear) | 45s (Fixed) | 45s (Fixed) | 45s (Fixed) | 30s - 75s (Adaptive) | **45s - 90s (Flux)** |
| **Physiology Model** | None | None | Fixed 2nd Order | Asymmetric + Hidden | Randomized (Noise) | Self-Learning (RLS) | **Dual-Tau Adaptation** |
| **Latency Handling** | None | Preemptive | Built-in Delay | Kalman Filter | Robustness | Smith Predictor | **Delay-Aware Match** |
| **Safety Logic** | Reactive | Braking | Zero Overshoot | Hysteresis | p95 Stochastic | Soft/Hard Ceilings | **Gain Scheduling** |
| **Best For** | Recovery / Z1-Z2 | Steady State | Basic Intervals | Precision | Noisy Sensors | All Scenarios | **Pro/Elite Intervals** |

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
