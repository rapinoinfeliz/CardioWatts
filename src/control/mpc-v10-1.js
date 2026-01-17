
import { MPCv10 } from './mpc-v10.js';

/**
 * Bio-MPC V10.1 (Personal Tuned Edition)
 * 
 * Optimized based on Offline Learning from 17 .fit files.
 * Tuned Parameters:
 * - Gain: 0.45 bpm/Watt (Official: 0.45)
 * - TauRise: 20s (Fast responder)
 * - TauFall: 30s (Safety margin added to raw 20s)
 * - Drift: 2.0 bpm/hour
 * 
 * This version starts with a highly accurate physiological model,
 * minimizing the "learning period" at the start of a session.
 */
export class MPCv10_1 extends MPCv10 {
    constructor(config = {}) {
        super(config);

        // --- PERSONALIZED TUNING ---
        this.params.gain = 0.45;
        this.params.tauHRRise = 20; // Fast kinetics found in data
        this.params.tauHRFall = 30; // Conservative adjustment
        this.params.driftRate = 2.0;

        // Initialize RLS with optimized values
        this.rls = {
            theta: this.params.gain,
            tauRise: this.params.tauHRRise,
            tauFall: this.params.tauHRFall
        };

        // Initialize Demand Observer with optimized model
        this.demandObserver.updateParams({
            gain: this.params.gain,
            tauRise: this.params.tauHRRise,
            tauFall: this.params.tauHRFall
        });

        // Tweak Supervisor for Fast Kinetics
        // Since user responds fast (Tau=20), we can be slightly more aggressive
        if (this.supervisor && this.supervisor.config) {
            this.supervisor.config.horizon = 45; // Shorter horizon sufficient
            this.supervisor.config.lr = 0.65;    // Higher learning rate
        }

        console.log('[Bio-MPC V10.1] Initialized - Personal Tuned Edition');
    }

    getDiagnostics() {
        const diag = super.getDiagnostics();
        diag.version = '10.1 (Tuned)';
        return diag;
    }
}
