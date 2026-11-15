import { lang } from '../i18n';

/** Strings of the layout and workspaces (Fase 17), kept apart from i18n.ts. */
const es = {
  lySpaces: 'Espacios de trabajo',
  lySpace: 'Espacio: {space}',
  lySpace_code: 'Código',
  lySpace_agents: 'Agentes',
  lySpace_design: 'Diseño',
  lySpace_video: 'Video',
  lySpace_cloud: 'Nube',
  lyGoTo: 'Ir al espacio {space}',
  lyReset: 'Restablecer este espacio',
  lyResetAll: 'Restablecer todos los espacios',
  lyResetDone: 'El espacio {space} volvió a su distribución inicial.',
  lyKeep: 'Mantener mi distribución',
  lyPresetsChanged:
    'Esta versión trae distribuciones nuevas. La tuya no cambió; usa «Restablecer todos los espacios» si quieres las nuevas.',
  lyPanelRight: 'Mover el panel a la derecha',
  lyPanelBottom: 'Mover el panel abajo',
  lyResizePanelSide: 'Cambiar el ancho del panel',
  lyZen: 'Modo Zen',
  lyZenOn: 'Modo Zen. Pulsa Esc dos veces para salir.',
  lyZenExit: 'Salir del modo Zen',
  lyDensityCompact: 'Densidad compacta',
  lyDensityComfortable: 'Densidad cómoda',
  lyMenuBar: 'Menú de la aplicación',
  lyWindowEffects: 'Efectos de ventana',
  lyWindowEffectsHint:
    'Mica en Windows 11 y transparencia en macOS, detrás de la barra de título y la barra de actividad. Se apaga solo con alto contraste.',
};

type LyKey = keyof typeof es;

const en: Record<LyKey, string> = {
  lySpaces: 'Workspaces',
  lySpace: 'Workspace: {space}',
  lySpace_code: 'Code',
  lySpace_agents: 'Agents',
  lySpace_design: 'Design',
  lySpace_video: 'Video',
  lySpace_cloud: 'Cloud',
  lyGoTo: 'Go to the {space} workspace',
  lyReset: 'Reset this workspace',
  lyResetAll: 'Reset every workspace',
  lyResetDone: 'The {space} workspace is back to its initial layout.',
  lyKeep: 'Keep my layout',
  lyPresetsChanged:
    'This version ships new layouts. Yours did not change; use "Reset every workspace" to get the new ones.',
  lyPanelRight: 'Move the panel to the right',
  lyPanelBottom: 'Move the panel to the bottom',
  lyResizePanelSide: 'Resize the panel',
  lyZen: 'Zen mode',
  lyZenOn: 'Zen mode. Press Esc twice to leave.',
  lyZenExit: 'Leave Zen mode',
  lyDensityCompact: 'Compact density',
  lyDensityComfortable: 'Comfortable density',
  lyMenuBar: 'Application menu',
  lyWindowEffects: 'Window effects',
  lyWindowEffectsHint:
    'Mica on Windows 11 and translucency on macOS, behind the title bar and the activity bar. Turns itself off with high contrast.',
};

export function tl(key: LyKey, vars: Record<string, string | number> = {}): string {
  const dict = lang === 'en' ? en : es;
  return dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export function spaceName(id: 'code' | 'agents' | 'design' | 'video' | 'cloud'): string {
  return tl(`lySpace_${id}` as LyKey);
}
