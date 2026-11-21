/**
 * Fase 7 (mejora): slicing a model to G-code with PrusaSlicer / SuperSlicer (their command
 * line). Zinarix writes the settings to a temporary .ini (simple choices: printer, material,
 * layer height, infill, supports, brim); a profile exported from PrusaSlicer can go first, so
 * a tuned printer keeps its own settings and only the simple choices change.
 */

export interface PrinterPreset {
  id: string;
  es: string;
  en: string;
  bed: [number, number, number];
  nozzle: number;
  /** PrusaSlicer gcode_flavor. */
  flavor: 'marlin2' | 'marlin' | 'klipper' | 'reprapfirmware';
}

export const PRINTER_PRESETS: PrinterPreset[] = [
  { id: 'generic220', es: 'Genérica 220×220 (Ender 3 y parecidas)', en: 'Generic 220×220 (Ender 3 and similar)', bed: [220, 220, 250], nozzle: 0.4, flavor: 'marlin2' },
  { id: 'prusa_mk4', es: 'Prusa MK4 / MK3S (250×210)', en: 'Prusa MK4 / MK3S (250×210)', bed: [250, 210, 220], nozzle: 0.4, flavor: 'marlin2' },
  { id: 'generic256', es: 'Genérica 256×256', en: 'Generic 256×256', bed: [256, 256, 256], nozzle: 0.4, flavor: 'marlin2' },
  { id: 'klipper235', es: 'Klipper 235×235 (Voron, Ender 3 con Klipper…)', en: 'Klipper 235×235 (Voron, Ender 3 with Klipper…)', bed: [235, 235, 250], nozzle: 0.4, flavor: 'klipper' },
  { id: 'generic300', es: 'Grande 300×300', en: 'Large 300×300', bed: [300, 300, 400], nozzle: 0.4, flavor: 'marlin2' },
  { id: 'mini180', es: 'Pequeña 180×180 (Prusa Mini y parecidas)', en: 'Small 180×180 (Prusa Mini and similar)', bed: [180, 180, 180], nozzle: 0.4, flavor: 'marlin2' },
];

export interface MaterialPreset {
  id: string;
  name: string;
  nozzle: number;
  bed: number;
  /** g/cm³ */
  density: number;
  fan: boolean;
  /** PrusaSlicer filament_type. */
  type: string;
}

export const MATERIALS: MaterialPreset[] = [
  { id: 'pla', name: 'PLA', nozzle: 210, bed: 60, density: 1.24, fan: true, type: 'PLA' },
  { id: 'petg', name: 'PETG', nozzle: 240, bed: 80, density: 1.27, fan: true, type: 'PETG' },
  { id: 'abs', name: 'ABS', nozzle: 250, bed: 100, density: 1.04, fan: false, type: 'ABS' },
  { id: 'asa', name: 'ASA', nozzle: 255, bed: 100, density: 1.07, fan: false, type: 'ASA' },
  { id: 'tpu', name: 'TPU (flexible)', nozzle: 225, bed: 50, density: 1.21, fan: true, type: 'FLEX' },
];

export type SupportMode = 'none' | 'buildplate' | 'everywhere';
export const SUPPORT_MODES: SupportMode[] = ['none', 'buildplate', 'everywhere'];
export const INFILL_PATTERNS = ['gyroid', 'grid', 'rectilinear', 'cubic', 'honeycomb', 'lightning'] as const;
export type InfillPattern = (typeof INFILL_PATTERNS)[number];

export interface SliceSettings {
  printer: string;
  material: string;
  /** mm, 0.05..0.4 (and at most 80 % of the nozzle). */
  layerHeight: number;
  /** % 0..100 */
  infill: number;
  pattern: InfillPattern;
  /** Perimeters (walls). */
  walls: number;
  supports: SupportMode;
  /** Brim width in mm (0 = none). */
  brim: number;
  /** Bed size override [x, y, z] for a printer that is not in the list. */
  bed?: [number, number, number];
  /** Temperatures override (°C). */
  nozzleTemp?: number;
  bedTemp?: number;
}

export const DEFAULT_SLICE: SliceSettings = {
  printer: 'generic220',
  material: 'pla',
  layerHeight: 0.2,
  infill: 15,
  pattern: 'gyroid',
  walls: 2,
  supports: 'none',
  brim: 0,
};

export const LAYER_CHOICES = [0.1, 0.15, 0.2, 0.25, 0.3];

const num = (v: unknown, lo: number, hi: number, name: string): number => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`"${name}" must be a number.`);
  if (n < lo || n > hi) throw new Error(`"${name}" must be between ${lo} and ${hi}.`);
  return n;
};

/** Settings from the UI or the AI, checked (missing ones take the defaults). */
export function validateSlice(input: Partial<Record<keyof SliceSettings, unknown>>, base: SliceSettings = DEFAULT_SLICE): SliceSettings {
  const out: SliceSettings = { ...base };
  if (input.printer !== undefined) {
    if (typeof input.printer !== 'string' || !PRINTER_PRESETS.some((p) => p.id === input.printer))
      throw new Error(`Unknown printer "${String(input.printer)}". Use one of: ${PRINTER_PRESETS.map((p) => p.id).join(', ')}.`);
    out.printer = input.printer;
  }
  if (input.material !== undefined) {
    const m = typeof input.material === 'string' ? input.material.toLowerCase() : '';
    if (!MATERIALS.some((x) => x.id === m)) throw new Error(`Unknown material "${String(input.material)}". Use one of: ${MATERIALS.map((x) => x.id).join(', ')}.`);
    out.material = m;
  }
  if (input.layerHeight !== undefined) out.layerHeight = num(input.layerHeight, 0.05, 0.4, 'layer_height');
  if (input.infill !== undefined) out.infill = Math.round(num(input.infill, 0, 100, 'infill'));
  if (input.pattern !== undefined) {
    if (!(INFILL_PATTERNS as readonly unknown[]).includes(input.pattern)) throw new Error(`"pattern" must be one of: ${INFILL_PATTERNS.join(', ')}.`);
    out.pattern = input.pattern as InfillPattern;
  }
  if (input.walls !== undefined) out.walls = Math.round(num(input.walls, 1, 10, 'walls'));
  if (input.supports !== undefined) {
    if (!(SUPPORT_MODES as unknown[]).includes(input.supports)) throw new Error(`"supports" must be one of: ${SUPPORT_MODES.join(', ')}.`);
    out.supports = input.supports as SupportMode;
  }
  if (input.brim !== undefined) out.brim = num(input.brim, 0, 20, 'brim');
  if (input.bed !== undefined) {
    const b = input.bed;
    if (!Array.isArray(b) || b.length !== 3) throw new Error('"bed" must be [x, y, z] in mm.');
    out.bed = [num(b[0], 50, 1000, 'bed x'), num(b[1], 50, 1000, 'bed y'), num(b[2], 20, 1000, 'bed z')];
  }
  if (input.nozzleTemp !== undefined) out.nozzleTemp = Math.round(num(input.nozzleTemp, 150, 320, 'nozzle_temp'));
  if (input.bedTemp !== undefined) out.bedTemp = Math.round(num(input.bedTemp, 0, 130, 'bed_temp'));
  const p = presetOf(out);
  if (out.layerHeight > p.nozzle * 0.8 + 1e-9) throw new Error(`A layer of ${out.layerHeight} mm is too thick for a ${p.nozzle} mm nozzle (at most ${(p.nozzle * 0.8).toFixed(2)}).`);
  return out;
}

export const presetOf = (s: SliceSettings): PrinterPreset => PRINTER_PRESETS.find((p) => p.id === s.printer) ?? PRINTER_PRESETS[0]!;
export const materialOf = (s: SliceSettings): MaterialPreset => MATERIALS.find((m) => m.id === s.material) ?? MATERIALS[0]!;
export const bedOf = (s: SliceSettings): [number, number, number] => s.bed ?? presetOf(s).bed;

/** PrusaSlicer .ini values are one line: newlines are written as \n. */
const iniValue = (v: string | number) => String(v).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n');

/**
 * The .ini with the simple choices. `withMachine` false = the user loads their own printer
 * profile first, so the bed, start G-code and flavour are theirs and only the print and
 * material choices are written.
 */
export function sliceIni(s: SliceSettings, withMachine = true): string {
  const p = presetOf(s);
  const m = materialOf(s);
  const [bx, by, bz] = bedOf(s);
  const nozzle = s.nozzleTemp ?? m.nozzle;
  const bed = s.bedTemp ?? m.bed;
  const kv: [string, string | number][] = [];
  if (withMachine) {
    const start =
      p.flavor === 'klipper'
        ? 'PRINT_START BED=[first_layer_bed_temperature] EXTRUDER=[first_layer_temperature]\n; (si tu macro se llama distinto, cámbiala en tu perfil)'
        : [
            'M140 S[first_layer_bed_temperature] ; cama',
            'M104 S[first_layer_temperature] ; boquilla',
            'G28 ; ir al origen',
            'M190 S[first_layer_bed_temperature]',
            'M109 S[first_layer_temperature]',
            'G92 E0',
            'G1 Z2 F3000',
            'G1 X5 Y20 Z0.3 F5000 ; línea de purga',
            'G1 X5 Y120 E10 F1500',
            'G1 X5.4 Y120 F5000',
            'G1 X5.4 Y20 E20 F1500',
            'G92 E0',
            'G1 Z2 F3000',
          ].join('\n');
    const end =
      p.flavor === 'klipper'
        ? 'PRINT_END'
        : ['G91', 'G1 E-2 F2700', 'G1 Z10 F3000', 'G90', `G1 X0 Y${Math.round(by * 0.9)} F3000 ; presentar la pieza`, 'M104 S0', 'M140 S0', 'M107', 'M84'].join('\n');
    kv.push(
      ['bed_shape', `0x0,${bx}x0,${bx}x${by},0x${by}`],
      ['max_print_height', bz],
      ['nozzle_diameter', p.nozzle],
      ['gcode_flavor', p.flavor],
      ['start_gcode', start],
      ['end_gcode', end],
      ['use_relative_e_distances', p.flavor === 'klipper' ? 1 : 0],
      ['retract_length', 0.8],
      ['retract_speed', 35],
      ['binary_gcode', 0],
    );
  }
  kv.push(
    ['filament_diameter', 1.75],
    ['filament_type', m.type],
    ['filament_density', m.density],
    ['temperature', nozzle],
    ['first_layer_temperature', nozzle + (m.id === 'pla' ? 5 : 0)],
    ['bed_temperature', bed],
    ['first_layer_bed_temperature', bed],
    ['cooling', m.fan ? 1 : 0],
    ['fan_always_on', m.fan ? 1 : 0],
    ['min_fan_speed', m.fan ? 100 : 0],
    ['max_fan_speed', m.fan ? 100 : 15],
    ['disable_fan_first_layers', 1],
    ['layer_height', s.layerHeight],
    ['first_layer_height', Math.min(0.3, Math.max(0.2, s.layerHeight))],
    ['fill_density', `${s.infill}%`],
    ['fill_pattern', s.pattern === 'grid' ? 'grid' : s.pattern],
    ['perimeters', s.walls],
    ['top_solid_layers', Math.max(3, Math.ceil(0.8 / s.layerHeight))],
    ['bottom_solid_layers', Math.max(3, Math.ceil(0.6 / s.layerHeight))],
    ['support_material', s.supports === 'none' ? 0 : 1],
    ['support_material_auto', 1],
    ['support_material_buildplate_only', s.supports === 'buildplate' ? 1 : 0],
    ['brim_width', s.brim],
    ['skirts', s.brim > 0 ? 0 : 1],
    ['ensure_on_bed', 1],
  );
  return kv.map(([k, v]) => `${k} = ${iniValue(v)}`).join('\n') + '\n';
}

/** Short summary of the settings (G-code name, UI, AI). */
export function describeSlice(s: SliceSettings, lang: 'es' | 'en' = 'es'): string {
  const p = presetOf(s);
  const m = materialOf(s);
  const sup = { none: lang === 'en' ? 'no supports' : 'sin soportes', buildplate: lang === 'en' ? 'supports from the bed' : 'soportes desde la cama', everywhere: lang === 'en' ? 'supports everywhere' : 'soportes en todo' }[s.supports];
  return `${lang === 'en' ? p.en : p.es} · ${m.name} · ${s.layerHeight} mm · ${s.infill} % ${s.pattern} · ${s.walls} ${lang === 'en' ? 'walls' : 'paredes'} · ${sup}${s.brim ? ` · brim ${s.brim} mm` : ''}`;
}

/** PrusaSlicer's console output -> the lines worth showing (errors and warnings first). */
export function slicerProblems(out: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const raw of out.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || /^\d+ => /.test(l)) continue;
    if (/error|failed|could not|cannot|unable|not fit|outside|empty/i.test(l) && !/^warning/i.test(l)) errors.push(l.replace(/^\[\w+\]\s*/, ''));
    else if (/warning|detected|requires? support|overhang/i.test(l)) warnings.push(l.replace(/^\[\w+\]\s*/, ''));
  }
  return { errors: [...new Set(errors)].slice(0, 20), warnings: [...new Set(warnings)].slice(0, 20) };
}

/** What PrusaSlicer can read (3MF keeps several parts and their placement). */
export const SLICEABLE = /\.(stl|3mf|obj|amf|step|stp)$/i;

// ---- Types shared by the main process and the window (IPC) ----

export type PrinterKind = 'octoprint' | 'moonraker';
export const PRINTER_KINDS: PrinterKind[] = ['octoprint', 'moonraker'];

export interface PrinterConfig {
  id: string;
  name: string;
  kind: PrinterKind;
  url: string;
}

export interface Temp {
  actual: number;
  target: number;
}

export interface PrinterStatus {
  online: boolean;
  /** Printer words (OctoPrint "Printing", Moonraker "printing"…). */
  state: string;
  printing: boolean;
  paused: boolean;
  file?: string;
  /** 0..1 */
  progress?: number;
  timeLeftS?: number;
  nozzle?: Temp;
  bed?: Temp;
  error?: string;
}

export type PrinterAction = 'pause' | 'resume' | 'cancel';

export interface SlicerView {
  slicer: { name: string; version: string; path: string } | null;
  /** The user's PrusaSlicer profile (.ini), when one was chosen. */
  profile: string | null;
  /** Desktop slicers a model can be opened in. */
  desktop: { id: string; name: string }[];
}

export interface SliceView {
  /** The G-code, relative to the open folder. */
  path: string;
  ms: number;
  slicer: string;
  warnings: string[];
  timeS: number;
  grams: number;
  layers: number;
}
