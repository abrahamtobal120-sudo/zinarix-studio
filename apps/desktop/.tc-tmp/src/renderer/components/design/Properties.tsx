import { useEffect, useState, type ReactNode } from 'react';
import type { DesignSelection, DesignSrc } from '../../../shared/design';
import { t } from '../../i18n';
import { Icon } from '../Icon';
import { tagName } from './names';

type SetStyle = (styles: Record<string, string | null>) => void;

/** "rgb(10, 20, 30)" / "rgba(…)" → "#0a141e" (and whether it is see-through). */
export function toHex(css: string): { hex: string; clear: boolean } {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(css);
  if (!m) return { hex: '#000000', clear: css === 'transparent' };
  const hex = `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return { hex, clear: m[4] !== undefined && Number(m[4]) === 0 };
}

const px = (v: string | undefined) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const FONTS: [string, string][] = [
  ['', 'dzFontPage'],
  ['system-ui, sans-serif', 'Sistema'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['Verdana, sans-serif', 'Verdana'],
  ["'Trebuchet MS', sans-serif", 'Trebuchet'],
  ['Georgia, serif', 'Georgia'],
  ["'Times New Roman', serif", 'Times New Roman'],
  ["'Courier New', monospace", 'Courier New'],
];

const SHADOWS: [string, string][] = [
  ['none', 'dzShadowNone'],
  ['0 1px 3px rgba(0,0,0,0.15)', 'dzShadowSoft'],
  ['0 4px 12px rgba(0,0,0,0.18)', 'dzShadowMedium'],
  ['0 12px 32px rgba(0,0,0,0.25)', 'dzShadowStrong'],
];

const TEXT_KEYS = ['font-family', 'font-size', 'color', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'letter-spacing', 'text-transform'];
const BOX_KEYS = ['background-color', 'background', 'border-radius', 'border', 'box-shadow', 'opacity'];
const SPACE_KEYS = ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'width', 'max-width', 'height'];

const reset = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, null]));

/** Number field that writes when the person stops typing (or presses Enter), not per key. */
function NumberField(props: { value: number; min?: number; max?: number; unit?: string; onChange: (n: number) => void; label: string }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = (raw: string) => {
    const n = Math.max(props.min ?? -9999, Math.min(props.max ?? 9999, Number(raw)));
    if (Number.isFinite(n) && n !== props.value) props.onChange(n);
  };
  return (
    <span className="dz-num">
      <button onClick={() => props.onChange(Math.max(props.min ?? -9999, props.value - 1))} aria-label={`${props.label} −`}>
        −
      </button>
      <input
        type="number"
        value={text}
        min={props.min}
        max={props.max}
        aria-label={props.label}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
      />
      <button onClick={() => props.onChange(Math.min(props.max ?? 9999, props.value + 1))} aria-label={`${props.label} +`}>
        +
      </button>
      {props.unit && <span className="dz-unit">{props.unit}</span>}
    </span>
  );
}

function Section(props: { title: string; onReset?: () => void; canReset?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="dz-sec">
      <header>
        <button className="dz-sec-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`dz-twisty ${open ? 'open' : ''}`}>
            <Icon name="chevron" size={11} />
          </span>
          {props.title}
        </button>
        {props.onReset && (
          <button className="link dz-reset" onClick={props.onReset} disabled={!props.canReset} title={t('dzResetTitle')}>
            {t('dzReset')}
          </button>
        )}
      </header>
      {open && <div className="dz-sec-body">{props.children}</div>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="dz-row">
      <span className="dz-row-label">{label}</span>
      <span className="dz-row-ctl">{children}</span>
    </label>
  );
}

/** Properties of the selected element, in plain words; each change is seen and saved at once. */
export function Properties(props: {
  sel: DesignSelection;
  setStyle: SetStyle;
  onEditText: () => void;
  onParent: (src: DesignSrc) => void;
}) {
  const { sel, setStyle } = props;
  const st = sel.style;
  const has = (keys: string[]) => keys.some((k) => Object.keys(sel.inline).some((i) => i === k || i.startsWith(`${k}-`)));
  const color = toHex(st['color'] ?? '');
  const bg = toHex(st['background-color'] ?? '');
  const bold = Number(st['font-weight']) >= 600 || st['font-weight'] === 'bold';
  const italic = st['font-style'] === 'italic';
  const underline = (st['text-decoration-line'] ?? '').includes('underline');
  const align = st['text-align'] ?? 'start';
  const hasText = sel.editable || sel.value.trim().length > 0;
  const family = sel.inline['font-family'] ?? '';
  const shadow = sel.inline['box-shadow'] ?? (st['box-shadow'] === 'none' ? 'none' : '');
  const lh = sel.inline['line-height'] ?? '';
  const isImage = sel.tag === 'img';

  return (
    <div className="dz-props">
      <div className="dz-sel-head">
        <strong>{tagName(sel.tag)}</strong>
        {sel.text && <span className="dz-muted"> «{sel.text}»</span>}
        {sel.parents.length > 0 && (
          <div className="dz-crumbs">
            {sel.parents
              .slice(0, 4)
              .reverse()
              .map((p) => (
                <button key={p.src} className="link" onClick={() => props.onParent(p.src)} title={p.text}>
                  {tagName(p.tag)}
                </button>
              ))}
            <span>›</span>
            <span>{tagName(sel.tag)}</span>
          </div>
        )}
        {sel.editable && (
          <button className="dz-wide" onClick={props.onEditText}>
            <Icon name="edit" size={13} /> {t('dzEditTextTitle')}
          </button>
        )}
        {isImage && (
          <div className="dz-note">
            {t('dzImageAt')} <code>{sel.image}</code>
            <br />
            {t('dzImageSoon')}
          </div>
        )}
      </div>

      {hasText && !isImage && (
        <Section title={t('dzSecText')} onReset={() => setStyle(reset(TEXT_KEYS))} canReset={has(TEXT_KEYS)}>
          <Row label={t('dzFont')}>
            <select value={FONTS.some(([v]) => v === family) ? family : ''} onChange={(e) => setStyle({ 'font-family': e.target.value || null })}>
              {FONTS.map(([v, l]) => (
                <option key={v} value={v} style={v ? { fontFamily: v } : undefined}>
                  {l.startsWith('dz') ? t(l as 'dzFontPage') : l}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('dzSize')}>
            <NumberField label={t('dzSize')} value={px(st['font-size'])} min={6} max={200} unit="px" onChange={(n) => setStyle({ 'font-size': `${n}px` })} />
          </Row>
          <Row label={t('dzColor')}>
            <input type="color" value={color.hex} onChange={(e) => setStyle({ color: e.target.value })} aria-label={t('dzColor')} />
          </Row>
          <Row label={t('dzStyle')}>
            <span className="dz-seg">
              <button className={bold ? 'on' : ''} aria-pressed={bold} onClick={() => setStyle({ 'font-weight': bold ? '400' : '700' })} title={t('dzBold')}>
                <b>B</b>
              </button>
              <button className={italic ? 'on' : ''} aria-pressed={italic} onClick={() => setStyle({ 'font-style': italic ? 'normal' : 'italic' })} title={t('dzItalic')}>
                <i>I</i>
              </button>
              <button className={underline ? 'on' : ''} aria-pressed={underline} onClick={() => setStyle({ 'text-decoration': underline ? 'none' : 'underline' })} title={t('dzUnderline')}>
                <u>U</u>
              </button>
            </span>
          </Row>
          <Row label={t('dzAlign')}>
            <span className="dz-seg">
              {(
                [
                  ['left', 'dzAlignLeft', '⯇'],
                  ['center', 'dzAlignCenter', '≡'],
                  ['right', 'dzAlignRight', '⯈'],
                  ['justify', 'dzAlignJustify', '☰'],
                ] as const
              ).map(([v, l, g]) => (
                <button
                  key={v}
                  className={align === v || (v === 'left' && align === 'start') ? 'on' : ''}
                  onClick={() => setStyle({ 'text-align': v })}
                  title={t(l)}
                  aria-label={t(l)}
                >
                  {g}
                </button>
              ))}
            </span>
          </Row>
          <Row label={t('dzLineHeight')}>
            <select value={lh} onChange={(e) => setStyle({ 'line-height': e.target.value || null })}>
              <option value="">{t('dzAuto')}</option>
              <option value="1">1</option>
              <option value="1.15">1.15</option>
              <option value="1.5">1.5</option>
              <option value="2">2</option>
            </select>
          </Row>
        </Section>
      )}

      <Section title={t('dzSecBox')} onReset={() => setStyle(reset(BOX_KEYS))} canReset={has(BOX_KEYS)}>
        <Row label={t('dzBackground')}>
          <input type="color" value={bg.clear ? '#ffffff' : bg.hex} onChange={(e) => setStyle({ 'background-color': e.target.value })} aria-label={t('dzBackground')} />
          <button className="link" onClick={() => setStyle({ 'background-color': 'transparent', background: null })} disabled={bg.clear}>
            {t('dzNoColor')}
          </button>
        </Row>
        <Row label={t('dzRadius')}>
          <input type="range" min={0} max={60} value={px(st['border-top-left-radius'])} onChange={(e) => setStyle({ 'border-radius': `${e.target.value}px` })} aria-label={t('dzRadius')} />
          <span className="dz-unit">{px(st['border-top-left-radius'])} px</span>
        </Row>
        <Row label={t('dzBorder')}>
          <select value={sel.inline['border-top-width'] ? sel.inline['border-top-width'] : sel.inline['border-top-style'] === 'none' ? 'none' : ''} onChange={(e) => setStyle({ border: e.target.value === '' ? null : e.target.value === 'none' ? 'none' : `${e.target.value} solid ${color.hex}` })}>
            <option value="">{t('dzAuto')}</option>
            <option value="none">{t('dzBorderNone')}</option>
            <option value="1px">{t('dzBorderThin')}</option>
            <option value="3px">{t('dzBorderThick')}</option>
          </select>
        </Row>
        <Row label={t('dzShadow')}>
          <select value={SHADOWS.some(([v]) => v === shadow) ? shadow : ''} onChange={(e) => setStyle({ 'box-shadow': e.target.value || null })}>
            {!SHADOWS.some(([v]) => v === shadow) && <option value="">{t('dzCustom')}</option>}
            {SHADOWS.map(([v, l]) => (
              <option key={v} value={v}>
                {t(l as 'dzShadowNone')}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('dzOpacity')}>
          <input type="range" min={10} max={100} value={Math.round(Number(st['opacity'] ?? 1) * 100)} onChange={(e) => setStyle({ opacity: String(Number(e.target.value) / 100) })} aria-label={t('dzOpacity')} />
          <span className="dz-unit">{Math.round(Number(st['opacity'] ?? 1) * 100)}%</span>
        </Row>
      </Section>

      <Section title={t('dzSecSpace')} onReset={() => setStyle(reset(SPACE_KEYS))} canReset={has(SPACE_KEYS)}>
        <Row label={t('dzPadding')}>
          <NumberField label={t('dzPadding')} value={px(st['padding-top'])} min={0} max={400} unit="px" onChange={(n) => setStyle({ padding: `${n}px`, 'padding-top': null, 'padding-right': null, 'padding-bottom': null, 'padding-left': null })} />
        </Row>
        <Row label={t('dzMargin')}>
          <NumberField label={t('dzMargin')} value={px(st['margin-top'])} min={-200} max={400} unit="px" onChange={(n) => setStyle({ margin: `${n}px`, 'margin-top': null, 'margin-right': null, 'margin-bottom': null, 'margin-left': null })} />
        </Row>
        <Row label={t('dzWidth')}>
          <select value={sel.inline['width'] ?? ''} onChange={(e) => setStyle({ width: e.target.value || null })}>
            <option value="">{t('dzAuto')}</option>
            <option value="100%">{t('dzFullWidth')}</option>
            <option value="75%">75%</option>
            <option value="50%">50%</option>
            <option value="25%">25%</option>
            {sel.inline['width'] && !['100%', '75%', '50%', '25%'].includes(sel.inline['width']) && (
              <option value={sel.inline['width']}>{sel.inline['width']}</option>
            )}
          </select>
        </Row>
        <div className="dz-note">{t('dzSpaceNote', { w: Math.round(sel.rect.width), h: Math.round(sel.rect.height) })}</div>
      </Section>
    </div>
  );
}
