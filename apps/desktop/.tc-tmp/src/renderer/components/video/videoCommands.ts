/**
 * Video Studio's place in the app: its commands (palette + menu) and the app-menu shortcuts it
 * takes over while it is on screen (Ctrl+S saves the video project, not the code file).
 */
import { mediaKindOf, PROJECT_EXT } from '../../../shared/video';
import { tv } from './strings';
import { getV, openProjectFile, openStudio, saveProject, setV, toggleStudio } from './videoStore';

export interface StudioCommand {
  id: string;
  label: string;
  keys?: string;
  run: () => unknown;
}

export function videoCommands(mod: string): StudioCommand[] {
  return [
    { id: 'video.toggle', label: tv('cmdOpen'), keys: `${mod}+Shift+V`, run: toggleStudio },
    {
      id: 'video.new',
      label: tv('cmdNew'),
      run: async () => {
        await openStudio();
        setV({ dialog: 'new' });
      },
    },
    {
      id: 'video.openProject',
      label: tv('cmdOpenProject'),
      run: async () => {
        await openStudio();
        await openProjectFile();
      },
    },
  ];
}

export function studioVisible(): boolean {
  const s = getV();
  return s.open && !s.minimized;
}

/** App commands the studio answers itself while visible; true = handled. */
export function studioCommand(id: string): boolean {
  if (!studioVisible()) return false;
  switch (id) {
    case 'file.save':
    case 'file.saveAll':
      void saveProject();
      return true;
    // Closing a code tab or creating a code file under the studio would be invisible.
    case 'tab.close':
    case 'file.new':
      return true;
  }
  return false;
}

/** Files the studio opens (explorer double-click, drops on the window): video, audio, projects. */
export function isStudioFile(path: string): boolean {
  const k = mediaKindOf(path);
  return k === 'video' || k === 'audio' || path.toLowerCase().endsWith(`.${PROJECT_EXT}`);
}
