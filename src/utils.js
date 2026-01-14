
// Minimal Utils for Zone2Flow

export function existance(value, fallback) {
    if (value !== null && value !== undefined) return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`existance needs a fallback value `, value);
}

export function exists(x) {
    return (x !== null && x !== undefined);
}

export function expect(x, msg = 'expected value here') {
    if (exists(x)) return x;
    throw new Error(msg);
}

export function clamp(lower, upper, value) {
    if (value >= upper) return upper;
    if (value < lower) return lower;
    return value;
}

export async function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// Simple Event Bus
export const bus = {
    listeners: {},
    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    },
    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    },
    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(cb => cb(data));
    }
};

export function time() {
    const d = new Date();
    return `${d.getMinutes()}:${d.getSeconds()}`;
}

export const log = (msg) => console.log(`[${time()}] ${msg}`);
