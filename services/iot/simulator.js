// Deterministic machine simulator. Not random noise: a reproducible state machine over named
// machine states, with seeded jitter so the same tick index always yields the same reading.
// Emits *logical* readings { velocityX/Y/Z, temperature, accelerationX/Y/Z }; the pipeline encodes
// them as Netvox frames so the simulator and real hardware share the exact same decode path.

// Per-state targets: overall vibration velocity magnitude (mm/s) and surface temperature (°C).
// ramp:true means interpolate from the previous state's end to this state's target across the segment.
const STATES = {
    OFF                  : { vib: 0.0,  temp: 22, jitter: 0.02 },
    HEALTHY              : { vib: 1.2,  temp: 35, jitter: 0.15 },
    WARMUP               : { vib: 1.6,  temp: 48, jitter: 0.20, ramp: true },
    DEGRADING            : { vib: 4.5,  temp: 55, jitter: 0.35, ramp: true },
    WARNING              : { vib: 6.5,  temp: 61, jitter: 0.45 },
    CRITICAL             : { vib: 11.0, temp: 72, jitter: 0.70 },
    MAINTENANCE_RECOVERY : { vib: 1.2,  temp: 35, jitter: 0.20, ramp: true },
};

// Default demo scenario: the full Healthy -> ... -> Recovery arc the DoD requires.
const DEFAULT_SCENARIO = [
    { state: 'HEALTHY',              ticks: 20 },
    { state: 'WARMUP',               ticks: 15 },
    { state: 'HEALTHY',              ticks: 15 },
    { state: 'DEGRADING',            ticks: 25 },
    { state: 'WARNING',              ticks: 20 },
    { state: 'CRITICAL',            ticks: 15 },
    { state: 'MAINTENANCE_RECOVERY', ticks: 25 },
    { state: 'HEALTHY',              ticks: 20 },
];

// Split an overall vibration magnitude across 3 axes with fixed ratios (magnitude preserved).
const AXIS = (() => { const r = [0.62, 0.55, 0.56]; const n = Math.hypot(...r); return r.map(v => v / n); })();

// Deterministic PRNG (mulberry32) seeded per tick -> reproducible jitter.
function rng(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function totalTicks(scenario) { return scenario.reduce((s, seg) => s + seg.ticks, 0); }

// Locate tick i within the scenario: returns { seg, prevState, progress (0..1) }.
function locate(scenario, i) {
    let acc = 0, prevState = 'OFF';
    for (const seg of scenario) {
        if (i < acc + seg.ticks) {
            return { seg, prevState, progress: seg.ticks > 1 ? (i - acc) / (seg.ticks - 1) : 1 };
        }
        acc += seg.ticks;
        prevState = seg.state;
    }
    const last = scenario[scenario.length - 1];
    return { seg: last, prevState, progress: 1 }; // clamp past the end to the final state
}

// Pure, deterministic reading for a given scenario + tick index.
function readingAt(scenario, i, seed = 1) {
    const { seg, prevState, progress } = locate(scenario, i);
    const target = STATES[seg.state];
    const from   = STATES[prevState] || STATES.OFF;
    const vib  = seg.ticks && target.ramp ? lerp(from.vib, target.vib, progress)   : target.vib;
    const temp = seg.ticks && target.ramp ? lerp(from.temp, target.temp, progress) : target.temp;

    const r = rng(seed * 1000003 + i);
    const j = target.jitter;
    const vJit = () => (r() - 0.5) * 2 * j;   // small absolute jitter in mm/s, deterministic per tick

    const velMag = Math.max(0, vib + vJit());
    return {
        state         : seg.state,
        velocityX     : round4(velMag * AXIS[0] + vJit() * 0.2),
        velocityY     : round4(velMag * AXIS[1] + vJit() * 0.2),
        velocityZ     : round4(velMag * AXIS[2] + vJit() * 0.2),
        temperature   : round4(temp + vJit()),
        accelerationX : round4((velMag * AXIS[0]) * 0.03 + vJit() * 0.01),
        accelerationY : round4((velMag * AXIS[1]) * 0.03 + vJit() * 0.01),
        accelerationZ : round4((velMag * AXIS[2]) * 0.03 + vJit() * 0.01),
    };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function round4(n) { return parseFloat(n.toFixed(4)); }

module.exports = { STATES, DEFAULT_SCENARIO, readingAt, totalTicks, locate };
