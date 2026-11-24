import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findFfmpeg } from '../src/main/video.js';
import {
  COMP_PRESETS,
  EQ_BANDS,
  LoudnessMeter,
  biquadMagnitudeDb,
  cleanComp,
  cleanEq,
  compStaticGainDb,
  eqResponseDb,
  ffmpegComp,
  ffmpegEq,
  highpassCoefs,
  highshelfCoefs,
  kWeightingCoefs,
  kWeightingWebAudio,
  peakingCoefs,
  validComp,
  validEq,
  webAudioCompParams,
  webAudioEqParams,
} from '../src/shared/videoAudioFx.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);

describe('EQ (RBJ peaking)', () => {
  it('a −12 dB low band is −12 dB at 100 Hz and ~0 far away', () => {
    for (const sr of [44100, 48000]) {
      expect(eqResponseDb({ low: -12 }, 100, sr)).toBeCloseTo(-12, 2);
      expect(Math.abs(eqResponseDb({ low: -12 }, 8000, sr))).toBeLessThan(0.1);
      expect(Math.abs(eqResponseDb({ high: 6 }, 100, sr))).toBeLessThan(0.05);
    }
    const c = peakingCoefs(EQ_BANDS.highMid.f, 1, 6, 48000);
    expect(biquadMagnitudeDb(c, 2500, 48000)).toBeCloseTo(6, 6);
    expect(eqResponseDb(undefined, 1000, 48000)).toBe(0);
  });

  it('cleanEq clamps, rounds and drops flat bands', () => {
    expect(cleanEq({ low: 0, high: 0 })).toBeUndefined();
    expect(cleanEq(undefined)).toBeUndefined();
    expect(cleanEq({ low: 99, lowMid: -99, highMid: 1.234, high: NaN })).toEqual({
      low: 24,
      lowMid: -24,
      highMid: 1.2,
    });
  });

  it('validEq accepts undefined and numeric bands, rejects wrong types', () => {
    expect(validEq(undefined)).toBe(true);
    expect(validEq({})).toBe(true);
    expect(validEq({ low: -3, high: 2 })).toBe(true);
    expect(validEq(null)).toBe(false);
    expect(validEq('eq')).toBe(false);
    expect(validEq([1, 2])).toBe(false);
    expect(validEq({ low: '3' })).toBe(false);
    expect(validEq({ low: Infinity })).toBe(false);
  });

  it('ffmpegEq emits one sanitised equalizer per band; Web Audio params match', () => {
    expect(ffmpegEq({ low: -12, high: 3 })).toEqual([
      'equalizer=f=100:t=q:w=1:g=-12',
      'equalizer=f=8000:t=q:w=1:g=3',
    ]);
    expect(ffmpegEq({ low: 0 })).toEqual([]);
    const evil = { low: '1:afade' } as unknown as { low: number };
    expect(ffmpegEq(evil)).toEqual([]);
    for (const s of ffmpegEq({ low: 1e9, lowMid: -1e9 }))
      expect(s).toMatch(/^equalizer=f=\d+:t=q:w=1:g=-?24$/);
    expect(webAudioEqParams({ lowMid: -2 })).toEqual([
      { type: 'peaking', frequency: 400, Q: 1, gain: -2 },
    ]);
  });
});

describe('compressor', () => {
  it('cleanComp clamps and drops no-ops; validComp checks types', () => {
    expect(cleanComp({ threshold: -100, ratio: 50, attack: 0, release: 1e6, makeup: 40 })).toEqual({
      threshold: -60,
      ratio: 20,
      attack: 0.1,
      release: 2000,
      makeup: 24,
    });
    expect(
      cleanComp({ threshold: -20, ratio: 1, attack: 10, release: 100, makeup: 0 }),
    ).toBeUndefined();
    expect(cleanComp(null)).toBeUndefined();
    expect(cleanComp({ ratio: 4 })).toMatchObject({ ratio: 4, threshold: -24 });
    expect(validComp(undefined)).toBe(true);
    expect(validComp(COMP_PRESETS.voice)).toBe(true);
    expect(validComp({ threshold: -20, ratio: 4 })).toBe(false);
    expect(validComp({ ...COMP_PRESETS.voice, ratio: '4' })).toBe(false);
    expect(validComp(7)).toBe(false);
  });

  it('static curve: hard knee + makeup', () => {
    const c = { threshold: -20, ratio: 4, attack: 10, release: 100, makeup: 3 };
    expect(compStaticGainDb(-30, c)).toBeCloseTo(3, 9);
    expect(compStaticGainDb(-20, c)).toBeCloseTo(3, 9);
    expect(compStaticGainDb(-8, c)).toBeCloseTo(3 - 9, 9); // 12 dB over → 3 dB out
  });

  it('ffmpegComp uses linear threshold/makeup inside acompressor limits', () => {
    const [f] = ffmpegComp({ threshold: -60, ratio: 4, attack: 0.1, release: 2000, makeup: 24 });
    expect(f).toMatch(
      /^acompressor=threshold=0\.001:ratio=4:attack=0\.1:release=2000:makeup=15\.848932:knee=1/,
    );
    expect(ffmpegComp(undefined)).toEqual([]);
    const [g] = ffmpegComp({ threshold: 0, ratio: 2, attack: 5, release: 50, makeup: 0 });
    expect(g).toContain('threshold=1:');
    expect(g).toContain('makeup=1:');
  });

  it('Web Audio params cancel the automatic makeup gain', () => {
    const w = webAudioCompParams({
      threshold: -20,
      ratio: 4,
      attack: 10,
      release: 1500,
      makeup: 3,
    })!;
    expect(w).toMatchObject({ threshold: -20, ratio: 4, attack: 0.01, release: 1, knee: 0 });
    // auto makeup = 0.6·20·(1−1/4) = 9 dB → node gain 3 − 9 = −6 dB
    expect(20 * Math.log10(w.makeupGain)).toBeCloseTo(-6, 9);
  });
});

describe('K-weighting', () => {
  it('48 kHz coefficients match BS.1770', () => {
    const [s, r] = kWeightingCoefs(48000);
    expect(s.b0).toBeCloseTo(1.53512485958697, 6);
    expect(s.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(s.b2).toBeCloseTo(1.19839281085285, 6);
    expect(s.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(s.a2).toBeCloseTo(0.73248077421585, 6);
    expect([r.b0, r.b1, r.b2]).toEqual([1, -2, 1]);
    expect(r.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(r.a2).toBeCloseTo(0.99007225036621, 6);
  });

  it('the Web Audio approximation stays within 1 dB of the exact K curve', () => {
    const sr = 48000;
    const [s, r] = kWeightingCoefs(sr);
    const [hp, hs] = kWeightingWebAudio();
    expect(hp.type).toBe('highpass');
    const approxHp = highpassCoefs(hp.frequency, Math.pow(10, hp.Q / 20), sr);
    const approxHs = highshelfCoefs(hs.frequency, hs.gain, sr);
    for (const f of [20, 40, 100, 500, 1000, 1500, 2000, 4000, 10000, 16000]) {
      const exact = biquadMagnitudeDb(s, f, sr) + biquadMagnitudeDb(r, f, sr);
      const approx = biquadMagnitudeDb(approxHp, f, sr) + biquadMagnitudeDb(approxHs, f, sr);
      expect(Math.abs(exact - approx)).toBeLessThan(1);
    }
  });
});

describe('LoudnessMeter (pure)', () => {
  const sine = (sr: number, sec: number, f: number, amp: number) =>
    Float32Array.from(
      { length: Math.round(sr * sec) },
      (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr),
    );

  it('a 997 Hz full-scale-referenced sine reads as expected and silence is −Infinity', () => {
    const m = new LoudnessMeter(48000, 2);
    expect(m.integrated()).toBe(-Infinity);
    expect(m.momentary()).toBe(-Infinity);
    expect(m.peak()).toBe(-Infinity);
    // −20 dBFS-peak 997 Hz in both channels: K gain ≈ +0.65 dB → ≈ −20 − 3.01 + 3.01 − 0.691 + 0.65
    const x = sine(48000, 5, 997, 0.1);
    m.push([x, x]);
    expect(m.integrated()).toBeCloseTo(-20.04, 0);
    expect(m.shortTerm()).toBeCloseTo(m.integrated(), 1);
    expect(m.momentary()).toBeCloseTo(m.integrated(), 1);
    expect(m.peak()).toBeCloseTo(-20, 1);
    const silent = new LoudnessMeter(48000, 1);
    silent.push([new Float32Array(48000)]);
    expect(silent.integrated()).toBe(-Infinity);
    expect(silent.shortTerm()).toBe(-Infinity);
  });

  it('chunked pushes give the same result as one push', () => {
    const x = sine(44100, 4, 440, 0.3);
    const a = new LoudnessMeter(44100, 1);
    a.push([x]);
    const b = new LoudnessMeter(44100, 1);
    for (let i = 0; i < x.length; i += 1000) b.push([x.subarray(i, i + 1000)]);
    expect(b.integrated()).toBeCloseTo(a.integrated(), 9);
    expect(b.shortTerm()).toBeCloseTo(a.shortTerm(), 9);
  });
});

// ---------------- with real FFmpeg ----------------

const SR = 48000;

function ff(args: string[]) {
  const r = spawnSync(tools.ffmpeg!, ['-hide_banner', '-nostats', ...args], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r;
}

/** Decodes a lavfi source (optionally filtered) to planar float channels. */
function pcm(src: string, channels: number, af?: string): Float32Array[] {
  const r = ff([
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    src,
    ...(af ? ['-af', af] : []),
    '-ac',
    String(channels),
    '-ar',
    String(SR),
    '-f',
    'f32le',
    '-',
  ]);
  const buf = Buffer.from(r.stdout);
  const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const n = Math.floor(all.length / channels);
  return Array.from({ length: channels }, (_, c) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = all[i * channels + c]!;
    return out;
  });
}

const rmsDb = (x: Float32Array, skip = 0) => {
  let s = 0;
  const from = Math.round(skip * SR);
  for (let i = from; i < x.length; i++) s += x[i]! * x[i]!;
  return 10 * Math.log10(s / (x.length - from));
};

describe.skipIf(!tools.ffmpeg)('audio FX with FFmpeg', () => {
  it('equalizer: −12 dB on the low band takes a 100 Hz sine down 12 dB', () => {
    const src = `sine=f=100:sample_rate=${SR}:d=2`;
    const before = rmsDb(pcm(src, 1)[0]!, 0.2);
    const after = rmsDb(pcm(src, 1, ffmpegEq({ low: -12 }).join(','))[0]!, 0.2);
    expect(before - after).toBeGreaterThan(11);
    expect(before - after).toBeLessThan(13);
  });

  it.each(Object.keys(COMP_PRESETS) as (keyof typeof COMP_PRESETS)[])(
    'acompressor (%s) settles on compStaticGainDb for a −6 dBFS tone',
    (id) => {
      const amp = Math.pow(10, -6 / 20);
      const src = `aevalsrc=${amp}*sin(2*PI*1000*t):s=${SR}:d=3`;
      const before = rmsDb(pcm(src, 1)[0]!, 0.5);
      const after = rmsDb(pcm(src, 1, ffmpegComp(COMP_PRESETS[id]).join(','))[0]!, 0.5);
      expect(Math.abs(after - before - compStaticGainDb(-6, COMP_PRESETS[id]))).toBeLessThan(1);
    },
  );

  it('LoudnessMeter matches ffmpeg ebur128 (integrated ±0.5 LU, short-term ±1.5)', () => {
    // Loud tone, a near-silent part (gated out), then a bass part with different channels.
    const L =
      'if(lt(t,4),0.1*sin(2*PI*1000*t),if(lt(t,7),0.001*sin(2*PI*440*t),0.3*sin(2*PI*80*t)))';
    const R =
      'if(lt(t,4),0.05*sin(2*PI*500*t),if(lt(t,7),0.001*sin(2*PI*440*t),0.2*sin(2*PI*3000*t)))';
    const src = `aevalsrc=exprs='${L}|${R}':s=${SR}:d=10`;
    const meter = new LoudnessMeter(SR, 2);
    meter.push(pcm(src, 2));
    const r = ff(['-v', 'info', '-f', 'lavfi', '-i', src, '-af', 'ebur128', '-f', 'null', '-']);
    const log = String(r.stderr);
    const summary = log.slice(log.lastIndexOf('Summary:'));
    const ref = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
    expect(Number.isFinite(ref)).toBe(true);
    expect(Math.abs(meter.integrated() - ref)).toBeLessThan(0.5);

    // Short-term on a steady tone: last per-frame "S:" reading.
    const tone = `aevalsrc=0.1*sin(2*PI*1000*t)|0.05*sin(2*PI*500*t):s=${SR}:d=5`;
    const m2 = new LoudnessMeter(SR, 2);
    m2.push(pcm(tone, 2));
    const log2 = String(
      ff(['-v', 'info', '-f', 'lavfi', '-i', tone, '-af', 'ebur128', '-f', 'null', '-']).stderr,
    );
    const s = [...log2.matchAll(/S:\s+(-?[\d.]+)/g)].map((x) => Number(x[1]));
    const refS = s[s.length - 1]!;
    expect(Math.abs(m2.shortTerm() - refS)).toBeLessThan(1.5);
    expect(m2.peak()).toBeCloseTo(-20, 1);
  });
});
