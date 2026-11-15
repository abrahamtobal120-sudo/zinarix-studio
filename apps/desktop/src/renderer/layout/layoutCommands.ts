import { SPACES } from '../../shared/layout';
import { spaceName, tl } from './i18nLayout';
import {
  getLayout,
  goToSpace,
  keepMyLayout,
  resetAllSpaces,
  resetCurrentSpace,
  setDensity,
  togglePanelPosition,
  toggleZen,
} from './layoutStore';

/** Fase 17 commands for the palette (any of them can get a shortcut in Settings). */
export function layoutCommands(): { id: string; label: string; run: () => unknown }[] {
  const right = getLayout().spaces[getLayout().space].panelPosition === 'right';
  const compact = getLayout().density === 'compact';
  return [
    ...SPACES.map((id) => ({
      id: `layout.space.${id}`,
      label: tl('lyGoTo', { space: spaceName(id) }),
      run: () => goToSpace(id),
    })),
    { id: 'layout.resetSpace', label: tl('lyReset'), run: resetCurrentSpace },
    { id: 'layout.resetAll', label: tl('lyResetAll'), run: resetAllSpaces },
    { id: 'layout.keep', label: tl('lyKeep'), run: keepMyLayout },
    {
      id: 'layout.panelPosition',
      label: right ? tl('lyPanelBottom') : tl('lyPanelRight'),
      run: togglePanelPosition,
    },
    { id: 'layout.zen', label: tl('lyZen'), run: toggleZen },
    {
      id: 'layout.density',
      label: compact ? tl('lyDensityComfortable') : tl('lyDensityCompact'),
      run: () => setDensity(compact ? 'comfortable' : 'compact'),
    },
  ];
}
