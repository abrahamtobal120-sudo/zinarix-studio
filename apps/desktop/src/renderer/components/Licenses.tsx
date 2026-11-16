import gplText from '../../../build/ffmpeg/COPYING.GPLv3.txt?raw';
import ffmpegSource from '../../../build/ffmpeg/FFMPEG-SOURCE.txt?raw';
import { t } from '../i18n';
import { setState } from '../store';
import { ModalShell } from './ModalShell';
import { ThirdPartyNotices } from './ThirdPartyNotices';

const pre = {
  whiteSpace: 'pre-wrap',
  fontSize: 'var(--text-sm)',
  maxHeight: '40vh',
  overflow: 'auto',
} as const;

/** Ayuda → Acerca de → Licencias: Zinarix (GPL-3.0-or-later) and the third-party parts it ships. */
export function Licenses() {
  return (
    <ModalShell
      onClose={() => setState({ modal: null })}
      className="shortcuts"
      labelledBy="licenses-title"
    >
      <h2 id="licenses-title">{t('licensesTitle')}</h2>
      <p>{t('licensesApp')}</p>
      <h3>FFmpeg / FFprobe</h3>
      <p>{t('licensesFfmpeg')}</p>
      <details open>
        <summary>{t('licensesFfmpegSource')}</summary>
        <pre style={pre}>{ffmpegSource}</pre>
      </details>
      <details>
        <summary>{t('licensesGpl')}</summary>
        <pre style={pre}>{gplText}</pre>
      </details>
      <ThirdPartyNotices />
    </ModalShell>
  );
}
