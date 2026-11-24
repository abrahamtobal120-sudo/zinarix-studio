/**
 * Fase 3 (plan de funciones): design studio shared by the vector editor (renderer) and the
 * design tools of the agent (main). Pure functions only: templates as SVG text, 2D matrices,
 * alignment and snapping, and the size of an SVG.
 */

// ------------------------------------------------------------------ templates

export interface Palette {
  id: string;
  name: { es: string; en: string };
  /** Background (top / bottom of the gradient), accent, text, soft text and a light shape. */
  bg1: string;
  bg2: string;
  accent: string;
  text: string;
  soft: string;
  light: string;
}

export const PALETTES: Palette[] = [
  {
    id: 'ocean',
    name: { es: 'Océano', en: 'Ocean' },
    bg1: '#0f4c81',
    bg2: '#1aa6b7',
    accent: '#ffd166',
    text: '#ffffff',
    soft: '#d6f1f5',
    light: '#ffffff',
  },
  {
    id: 'sunset',
    name: { es: 'Atardecer', en: 'Sunset' },
    bg1: '#ff6b6b',
    bg2: '#feca57',
    accent: '#2d3436',
    text: '#ffffff',
    soft: '#fff3e0',
    light: '#ffffff',
  },
  {
    id: 'forest',
    name: { es: 'Bosque', en: 'Forest' },
    bg1: '#1b4332',
    bg2: '#40916c',
    accent: '#d8f3dc',
    text: '#ffffff',
    soft: '#b7e4c7',
    light: '#d8f3dc',
  },
  {
    id: 'night',
    name: { es: 'Noche', en: 'Night' },
    bg1: '#14102b',
    bg2: '#4b2c82',
    accent: '#ff4fa3',
    text: '#ffffff',
    soft: '#cfc6f5',
    light: '#8f7bff',
  },
  {
    id: 'mono',
    name: { es: 'Minimal', en: 'Minimal' },
    bg1: '#f7f7f5',
    bg2: '#e9e9e4',
    accent: '#111111',
    text: '#111111',
    soft: '#555555',
    light: '#111111',
  },
];

export interface TemplateText {
  title?: string;
  subtitle?: string;
}

export interface DesignTemplate {
  id: string;
  name: { es: string; en: string };
  width: number;
  height: number;
  /** Default texts of the template (es / en). */
  text: { es: Required<TemplateText>; en: Required<TemplateText> };
  build: (p: Palette, t: Required<TemplateText>, w: number, h: number) => string;
}

/** Text safe inside an XML element or attribute. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";
const n = (v: number): string => String(Math.round(v * 100) / 100);

function grad(id: string, p: Palette, vertical = true): string {
  const end = vertical ? 'x1="0" y1="0" x2="0" y2="1"' : 'x1="0" y1="0" x2="1" y2="1"';
  return `<linearGradient id="${id}" ${end}><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient>`;
}

function text(
  name: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  content: string,
  opts: { weight?: number; anchor?: 'start' | 'middle' | 'end'; spacing?: number } = {},
): string {
  const lines = content.split('\n');
  const anchor = opts.anchor ?? 'middle';
  const body =
    lines.length === 1
      ? xmlEscape(content)
      : lines
          .map(
            (l, i) => `<tspan x="${n(x)}" dy="${i === 0 ? 0 : '1.15em'}">${xmlEscape(l)}</tspan>`,
          )
          .join('');
  return (
    `<text data-name="${xmlEscape(name)}" x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${n(size)}"` +
    ` font-weight="${opts.weight ?? 400}" fill="${fill}" text-anchor="${anchor}"` +
    (opts.spacing ? ` letter-spacing="${n(opts.spacing)}"` : '') +
    `>${body}</text>`
  );
}

function svgDoc(w: number, h: number, defs: string, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    defs ? `  <defs>${defs}</defs>` : '',
    ...body.map((b) => `  ${b}`),
    '</svg>',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** A starburst (sale sticker) as path data. */
function burst(cx: number, cy: number, r1: number, r2: number, spikes: number): string {
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    pts.push(`${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

export const TEMPLATES: DesignTemplate[] = [
  {
    id: 'instagram-post',
    name: { es: 'Post de Instagram', en: 'Instagram post' },
    width: 1080,
    height: 1080,
    text: {
      es: { title: 'Gran\nlanzamiento', subtitle: 'Este sábado · 10:00 h' },
      en: { title: 'Big\nlaunch', subtitle: 'This Saturday · 10 am' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p, false), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="url(#bg)"/>`,
        `<circle data-name="Círculo" cx="${n(w * 0.86)}" cy="${n(h * 0.14)}" r="${n(w * 0.22)}" fill="${p.light}" opacity="0.15"/>`,
        `<circle data-name="Círculo 2" cx="${n(w * 0.1)}" cy="${n(h * 0.92)}" r="${n(w * 0.16)}" fill="${p.light}" opacity="0.12"/>`,
        text('Título', w / 2, h * 0.43, w * 0.12, p.text, t.title, { weight: 800 }),
        `<rect data-name="Etiqueta" x="${n(w * 0.25)}" y="${n(h * 0.7)}" width="${n(w * 0.5)}" height="${n(h * 0.09)}" rx="${n(h * 0.045)}" fill="${p.accent}"/>`,
        text('Subtítulo', w / 2, h * 0.759, w * 0.036, p.bg1, t.subtitle, { weight: 700 }),
      ]),
  },
  {
    id: 'instagram-story',
    name: { es: 'Historia (Instagram, TikTok)', en: 'Story (Instagram, TikTok)' },
    width: 1080,
    height: 1920,
    text: {
      es: { title: 'Nueva\ncolección', subtitle: 'Desliza hacia arriba' },
      en: { title: 'New\ncollection', subtitle: 'Swipe up' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="url(#bg)"/>`,
        `<rect data-name="Marco" x="${n(w * 0.07)}" y="${n(h * 0.05)}" width="${n(w * 0.86)}" height="${n(h * 0.9)}" rx="40" fill="none" stroke="${p.light}" stroke-width="6" opacity="0.5"/>`,
        `<rect data-name="Foto" x="${n(w * 0.15)}" y="${n(h * 0.14)}" width="${n(w * 0.7)}" height="${n(h * 0.36)}" rx="28" fill="${p.light}" opacity="0.25"/>`,
        text('Título', w / 2, h * 0.6, w * 0.13, p.text, t.title, { weight: 800 }),
        `<rect data-name="Botón" x="${n(w * 0.25)}" y="${n(h * 0.82)}" width="${n(w * 0.5)}" height="${n(h * 0.055)}" rx="${n(h * 0.0275)}" fill="${p.accent}"/>`,
        text('Llamada', w / 2, h * 0.856, w * 0.04, p.bg1, t.subtitle, { weight: 700 }),
      ]),
  },
  {
    id: 'youtube-thumbnail',
    name: { es: 'Miniatura de YouTube', en: 'YouTube thumbnail' },
    width: 1280,
    height: 720,
    text: {
      es: { title: '¡NO LO\nCREERÁS!', subtitle: 'EP. 12' },
      en: { title: "YOU WON'T\nBELIEVE IT", subtitle: 'EP. 12' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p, false), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="url(#bg)"/>`,
        `<rect data-name="Foto" x="${n(w * 0.56)}" y="${n(h * 0.08)}" width="${n(w * 0.4)}" height="${n(h * 0.84)}" rx="24" fill="${p.light}" opacity="0.25"/>`,
        `<text data-name="Título" x="${n(w * 0.05)}" y="${n(h * 0.42)}" font-family="Impact, ${FONT}" font-size="${n(h * 0.2)}" font-weight="900" fill="${p.text}" stroke="${p.accent === p.text ? '#000000' : '#000000'}" stroke-width="8" paint-order="stroke" text-anchor="start">${t.title
          .split('\n')
          .map(
            (l, i) =>
              `<tspan x="${n(w * 0.05)}" dy="${i === 0 ? 0 : '1.05em'}">${xmlEscape(l)}</tspan>`,
          )
          .join('')}</text>`,
        `<rect data-name="Etiqueta" x="${n(w * 0.05)}" y="${n(h * 0.78)}" width="${n(w * 0.16)}" height="${n(h * 0.11)}" rx="10" fill="${p.accent}"/>`,
        text('Episodio', w * 0.13, h * 0.857, h * 0.065, p.bg1, t.subtitle, { weight: 800 }),
      ]),
  },
  {
    id: 'business-card',
    name: { es: 'Tarjeta de presentación', en: 'Business card' },
    width: 1050,
    height: 600,
    text: {
      es: { title: 'Ana López', subtitle: 'Diseñadora gráfica\nana@ejemplo.com · 55 1234 5678' },
      en: { title: 'Ana López', subtitle: 'Graphic designer\nana@example.com · +1 555 123 4567' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="${p.light === '#ffffff' ? '#ffffff' : p.soft}"/>`,
        `<rect data-name="Banda" width="${n(w * 0.34)}" height="${h}" fill="url(#bg)"/>`,
        `<circle data-name="Logo" cx="${n(w * 0.17)}" cy="${n(h / 2)}" r="${n(h * 0.17)}" fill="none" stroke="${p.text === '#111111' ? '#111111' : '#ffffff'}" stroke-width="10"/>`,
        text(
          'Inicial',
          w * 0.17,
          h * 0.565,
          h * 0.17,
          p.text === '#111111' ? '#111111' : '#ffffff',
          t.title.slice(0, 1).toUpperCase(),
          { weight: 800 },
        ),
        text('Nombre', w * 0.41, h * 0.42, h * 0.1, '#1f2933', t.title, {
          weight: 800,
          anchor: 'start',
        }),
        `<rect data-name="Línea" x="${n(w * 0.41)}" y="${n(h * 0.48)}" width="${n(w * 0.12)}" height="6" fill="${p.bg1}"/>`,
        text('Datos', w * 0.41, h * 0.6, h * 0.045, '#52606d', t.subtitle, { anchor: 'start' }),
      ]),
  },
  {
    id: 'logo',
    name: { es: 'Logo', en: 'Logo' },
    width: 1000,
    height: 1000,
    text: {
      es: { title: 'Mi Marca', subtitle: 'ESTUDIO CREATIVO' },
      en: { title: 'My Brand', subtitle: 'CREATIVE STUDIO' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('mark', p, false), [
        `<g data-name="Símbolo">` +
          `<circle cx="${n(w / 2)}" cy="${n(h * 0.36)}" r="${n(w * 0.2)}" fill="url(#mark)"/>` +
          `<path d="M ${n(w * 0.41)} ${n(h * 0.44)} L ${n(w / 2)} ${n(h * 0.26)} L ${n(w * 0.59)} ${n(h * 0.44)} Z" fill="#ffffff"/>` +
          `</g>`,
        text('Nombre', w / 2, h * 0.72, w * 0.1, p.bg1 === '#f7f7f5' ? '#111111' : p.bg1, t.title, {
          weight: 800,
        }),
        text('Lema', w / 2, h * 0.8, w * 0.034, '#6b7280', t.subtitle, { weight: 600, spacing: 6 }),
      ]),
  },
  {
    id: 'flyer',
    name: { es: 'Póster / volante', en: 'Poster / flyer' },
    width: 1240,
    height: 1754,
    text: {
      es: {
        title: 'FESTIVAL\nDE VERANO',
        subtitle: '20 de julio · Parque Central · Entrada libre',
      },
      en: { title: 'SUMMER\nFESTIVAL', subtitle: 'July 20 · Central Park · Free entry' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="url(#bg)"/>`,
        `<circle data-name="Sol" cx="${n(w / 2)}" cy="${n(h * 0.3)}" r="${n(w * 0.28)}" fill="${p.accent}" opacity="0.9"/>`,
        `<path data-name="Ondas" d="M 0 ${n(h * 0.5)} Q ${n(w * 0.25)} ${n(h * 0.45)} ${n(w * 0.5)} ${n(h * 0.5)} T ${w} ${n(h * 0.5)} L ${w} ${h} L 0 ${h} Z" fill="${p.bg1}" opacity="0.55"/>`,
        text('Título', w / 2, h * 0.64, w * 0.12, p.text, t.title, { weight: 900 }),
        text('Detalles', w / 2, h * 0.87, w * 0.032, p.text, t.subtitle, { weight: 600 }),
      ]),
  },
  {
    id: 'slide',
    name: { es: 'Diapositiva 16:9', en: 'Slide 16:9' },
    width: 1920,
    height: 1080,
    text: {
      es: { title: 'Título de la presentación', subtitle: 'Subtítulo · Nombre del autor' },
      en: { title: 'Presentation title', subtitle: 'Subtitle · Author name' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p, false), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="url(#bg)"/>`,
        `<rect data-name="Barra" x="${n(w * 0.08)}" y="${n(h * 0.36)}" width="12" height="${n(h * 0.28)}" fill="${p.accent}"/>`,
        text('Título', w * 0.11, h * 0.47, h * 0.09, p.text, t.title, {
          weight: 800,
          anchor: 'start',
        }),
        text('Subtítulo', w * 0.11, h * 0.59, h * 0.04, p.soft, t.subtitle, { anchor: 'start' }),
      ]),
  },
  {
    id: 'banner',
    name: { es: 'Portada (Facebook, X, LinkedIn)', en: 'Cover (Facebook, X, LinkedIn)' },
    width: 1500,
    height: 500,
    text: {
      es: { title: 'Hacemos tu idea realidad', subtitle: 'www.tusitio.com' },
      en: { title: 'We make your idea real', subtitle: 'www.yoursite.com' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p, false), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="url(#bg)"/>`,
        `<circle data-name="Círculo" cx="${n(w * 0.92)}" cy="${n(h * 0.2)}" r="${n(h * 0.5)}" fill="${p.light}" opacity="0.12"/>`,
        text('Título', w / 2, h * 0.5, h * 0.14, p.text, t.title, { weight: 800 }),
        text('Sitio', w / 2, h * 0.68, h * 0.06, p.soft, t.subtitle),
      ]),
  },
  {
    id: 'invitation',
    name: { es: 'Invitación', en: 'Invitation' },
    width: 1500,
    height: 2100,
    text: {
      es: {
        title: 'Sofía\ncumple 15',
        subtitle: 'Sábado 14 de marzo · 19:00 h\nSalón Las Flores\nConfirma tu asistencia',
      },
      en: {
        title: "Sofia's\n15th birthday",
        subtitle: 'Saturday, March 14 · 7 pm\nLas Flores Hall\nPlease RSVP',
      },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="${p.id === 'mono' ? '#ffffff' : p.soft}"/>`,
        `<rect data-name="Marco" x="${n(w * 0.06)}" y="${n(h * 0.045)}" width="${n(w * 0.88)}" height="${n(h * 0.91)}" fill="none" stroke="${p.bg1}" stroke-width="${n(w * 0.006)}"/>`,
        `<rect data-name="Marco interior" x="${n(w * 0.085)}" y="${n(h * 0.063)}" width="${n(w * 0.83)}" height="${n(h * 0.874)}" fill="none" stroke="${p.bg1}" stroke-width="${n(w * 0.002)}" opacity="0.6"/>`,
        `<circle data-name="Adorno" cx="${n(w / 2)}" cy="${n(h * 0.2)}" r="${n(w * 0.12)}" fill="url(#bg)"/>`,
        `<path data-name="Estrella" d="${shapePath('star', { x: w * 0.42, y: h * 0.143, w: w * 0.16, h: w * 0.16 })}" fill="${p.light === '#111111' ? '#ffffff' : p.light}"/>`,
        text(
          'Título',
          w / 2,
          h * 0.43,
          w * 0.11,
          p.bg1 === '#f7f7f5' ? '#111111' : p.bg1,
          t.title,
          { weight: 800 },
        ),
        `<rect data-name="Línea" x="${n(w * 0.4)}" y="${n(h * 0.6)}" width="${n(w * 0.2)}" height="${n(h * 0.003)}" fill="${p.bg2}"/>`,
        text('Detalles', w / 2, h * 0.69, w * 0.04, '#374151', t.subtitle, { weight: 500 }),
      ]),
  },
  {
    id: 'menu',
    name: { es: 'Menú de restaurante', en: 'Restaurant menu' },
    width: 1240,
    height: 1754,
    text: {
      es: {
        title: 'MENÚ',
        subtitle:
          'Tacos al pastor — $65\nEnchiladas verdes — $90\nPozole rojo — $110\nAgua de horchata — $35\nFlan napolitano — $45',
      },
      en: {
        title: 'MENU',
        subtitle:
          'Pastor tacos — $6.50\nGreen enchiladas — $9\nRed pozole — $11\nHorchata — $3.50\nFlan — $4.50',
      },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="#fffdf8"/>`,
        `<rect data-name="Encabezado" width="${w}" height="${n(h * 0.24)}" fill="url(#bg)"/>`,
        text('Título', w / 2, h * 0.15, w * 0.12, p.text, t.title, {
          weight: 800,
          spacing: w * 0.012,
        }),
        `<rect data-name="Línea" x="${n(w * 0.12)}" y="${n(h * 0.3)}" width="${n(w * 0.76)}" height="3" fill="${p.bg1}" opacity="0.5"/>`,
        text('Platillos', w / 2, h * 0.38, w * 0.045, '#1f2933', t.subtitle, { weight: 500 }),
        `<rect data-name="Pie" y="${n(h * 0.94)}" width="${w}" height="${n(h * 0.06)}" fill="${p.bg1}"/>`,
      ]),
  },
  {
    id: 'certificate',
    name: { es: 'Diploma / reconocimiento', en: 'Certificate' },
    width: 1754,
    height: 1240,
    text: {
      es: {
        title: 'Reconocimiento',
        subtitle: 'Otorgado a Ana López\npor su excelente desempeño · 2026',
      },
      en: {
        title: 'Certificate',
        subtitle: 'Awarded to Ana López\nfor outstanding performance · 2026',
      },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p, false), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="#ffffff"/>`,
        `<rect data-name="Borde" x="${n(w * 0.03)}" y="${n(h * 0.04)}" width="${n(w * 0.94)}" height="${n(h * 0.92)}" fill="none" stroke="url(#bg)" stroke-width="${n(w * 0.014)}"/>`,
        `<rect data-name="Borde fino" x="${n(w * 0.055)}" y="${n(h * 0.077)}" width="${n(w * 0.89)}" height="${n(h * 0.846)}" fill="none" stroke="${p.bg1}" stroke-width="2" opacity="0.5"/>`,
        text(
          'Título',
          w / 2,
          h * 0.32,
          h * 0.12,
          p.bg1 === '#f7f7f5' ? '#111111' : p.bg1,
          t.title,
          { weight: 800 },
        ),
        text('Texto', w / 2, h * 0.5, h * 0.045, '#374151', t.subtitle, { weight: 500 }),
        `<rect data-name="Firma" x="${n(w * 0.38)}" y="${n(h * 0.78)}" width="${n(w * 0.24)}" height="2" fill="#374151"/>`,
        text('Firma (texto)', w / 2, h * 0.83, h * 0.03, '#6b7280', 'Firma', { weight: 500 }),
        `<circle data-name="Sello" cx="${n(w * 0.84)}" cy="${n(h * 0.78)}" r="${n(h * 0.08)}" fill="${p.accent}"/>`,
      ]),
  },
  {
    id: 'sale',
    name: { es: 'Oferta / promoción', en: 'Sale / promo' },
    width: 1080,
    height: 1080,
    text: {
      es: { title: '-50%', subtitle: 'SOLO ESTE FIN DE SEMANA' },
      en: { title: '-50%', subtitle: 'THIS WEEKEND ONLY' },
    },
    build: (p, t, w, h) =>
      svgDoc(w, h, grad('bg', p, false), [
        `<rect data-name="Fondo" width="${w}" height="${h}" fill="url(#bg)"/>`,
        `<path data-name="Estallido" d="${burst(w / 2, h * 0.45, w * 0.36, w * 0.3, 16)}" fill="${p.accent}"/>`,
        text(
          'Descuento',
          w / 2,
          h * 0.52,
          w * 0.2,
          p.accent === '#111111' || p.accent === '#2d3436' ? '#ffffff' : p.bg1,
          t.title,
          { weight: 900 },
        ),
        `<rect data-name="Cinta" x="0" y="${n(h * 0.8)}" width="${w}" height="${n(h * 0.1)}" fill="${p.text}" opacity="0.92"/>`,
        text(
          'Llamada',
          w / 2,
          h * 0.867,
          w * 0.045,
          p.bg1 === '#f7f7f5' ? '#ffffff' : p.bg1,
          t.subtitle,
          { weight: 800, spacing: 4 },
        ),
      ]),
  },
  {
    id: 'blank',
    name: { es: 'En blanco', en: 'Blank' },
    width: 1080,
    height: 1080,
    text: { es: { title: '', subtitle: '' }, en: { title: '', subtitle: '' } },
    build: (_p, _t, w, h) =>
      svgDoc(w, h, '', [`<rect data-name="Fondo" width="${w}" height="${h}" fill="#ffffff"/>`]),
  },
];

export const MAX_DESIGN_SIDE = 10000;

export interface NewDesign {
  template: string;
  palette?: string;
  title?: string;
  subtitle?: string;
  width?: number;
  height?: number;
  lang?: 'es' | 'en';
}

/** The SVG text of a new design from a template (throws on an unknown template). */
export function buildTemplate(o: NewDesign): string {
  const tpl = TEMPLATES.find((x) => x.id === o.template);
  if (!tpl)
    throw new Error(
      `Unknown template "${o.template}". Use one of: ${TEMPLATES.map((x) => x.id).join(', ')}.`,
    );
  const pal = PALETTES.find((x) => x.id === o.palette) ?? PALETTES[0]!;
  const side = (v: number | undefined, d: number): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(MAX_DESIGN_SIDE, Math.max(16, Math.round(v)))
      : d;
  const w = side(o.width, tpl.width);
  const h = side(o.height, tpl.height);
  const def = tpl.text[o.lang ?? 'es'];
  return tpl.build(
    pal,
    { title: o.title ?? def.title, subtitle: o.subtitle ?? def.subtitle },
    w,
    h,
  );
}

/** "Post de Instagram" -> "post-de-instagram" (file names). */
export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'diseno'
  );
}

/** First free name: base.ext, base-2.ext, base-3.ext… */
export function uniqueName(base: string, ext: string, taken: (name: string) => boolean): string {
  for (let i = 1; i < 10000; i++) {
    const name = i === 1 ? `${base}.${ext}` : `${base}-${i}.${ext}`;
    if (!taken(name)) return name;
  }
  return `${base}-${Date.now()}.${ext}`;
}

// ------------------------------------------------------------------ size of an SVG

/** Length in px of an SVG width / height attribute (null when relative or missing). */
function length(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*([0-9.]+)\s*(px|pt|mm|cm|in)?\s*$/i.exec(v);
  if (!m) return null;
  const f: Record<string, number> = { px: 1, pt: 4 / 3, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  const x = Number(m[1]) * f[(m[2] ?? 'px').toLowerCase()]!;
  return Number.isFinite(x) && x > 0 ? x : null;
}

/** Natural size of an SVG from its root tag: width/height, else the viewBox, else 300×150. */
export function svgSize(svg: string): { width: number; height: number } {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) throw new Error('This is not an SVG file (no <svg> element).');
  const attr = (k: string): string | undefined =>
    new RegExp(`\\s${k}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
      .exec(tag)
      ?.slice(1)
      .find((x) => x !== undefined);
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vw = vb && vb.length === 4 && vb[2]! > 0 ? vb[2]! : null;
  const vh = vb && vb.length === 4 && vb[3]! > 0 ? vb[3]! : null;
  let w = length(attr('width'));
  let h = length(attr('height'));
  if (w && !h && vw && vh) h = (w * vh) / vw;
  if (h && !w && vw && vh) w = (h * vw) / vh;
  return { width: Math.round(w ?? vw ?? 300), height: Math.round(h ?? vh ?? 150) };
}

// ------------------------------------------------------------------ 2D matrices

/** SVG matrix (a b c d e f): x' = a x + c y + e, y' = b x + d y + f. */
export type Mat = [number, number, number, number, number, number];
export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m · k (k is applied first). */
export function mul(m: Mat, k: Mat): Mat {
  return [
    m[0] * k[0] + m[2] * k[1],
    m[1] * k[0] + m[3] * k[1],
    m[0] * k[2] + m[2] * k[3],
    m[1] * k[2] + m[3] * k[3],
    m[0] * k[4] + m[2] * k[5] + m[4],
    m[1] * k[4] + m[3] * k[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return IDENTITY;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];
export function rotate(deg: number, cx = 0, cy = 0): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return mul(translate(cx, cy), mul([c, s, -s, c, 0, 0], translate(-cx, -cy)));
}

/** Maps box `from` onto box `to` (scale + translate). Zero sizes keep a scale of 1. */
export function boxToBox(from: Box, to: Box): Mat {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  return mul(translate(to.x, to.y), mul(scale(sx, sy), translate(-from.x, -from.y)));
}

const r4 = (v: number): number => {
  const x = Math.round(v * 10000) / 10000;
  return Object.is(x, -0) ? 0 : x;
};

/** "matrix(…)" for the transform attribute; '' for the identity. */
export function matString(m: Mat): string {
  if (m.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-9)) return '';
  if (
    Math.abs(m[0] - 1) < 1e-9 &&
    Math.abs(m[3] - 1) < 1e-9 &&
    Math.abs(m[1]) < 1e-9 &&
    Math.abs(m[2]) < 1e-9
  )
    return `translate(${r4(m[4])} ${r4(m[5])})`;
  return `matrix(${m.map(r4).join(' ')})`;
}

/** Angle in degrees of the x axis of a matrix (the rotation shown in the panel). */
export function matAngle(m: Mat): number {
  return r4((Math.atan2(m[1], m[0]) * 180) / Math.PI);
}

/** Axis-aligned box of a box transformed by m. */
export function boundsOf(m: Mat, b: Box): Box {
  const pts = [
    apply(m, { x: b.x, y: b.y }),
    apply(m, { x: b.x + b.w, y: b.y }),
    apply(m, { x: b.x, y: b.y + b.h }),
    apply(m, { x: b.x + b.w, y: b.y + b.h }),
  ];
  return pointsBox(pts);
}

export function pointsBox(pts: Pt[]): Box {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return pointsBox(
    boxes.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ]),
  );
}

export function boxesTouch(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

// ------------------------------------------------------------------ resize from a handle

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * New box when a handle of `b` is dragged to `p` (all in the same space). keepRatio keeps
 * the proportion (corners), fromCenter grows both sides. Sizes never go below `min`.
 */
export function resizeBox(
  b: Box,
  h: Handle,
  p: Pt,
  keepRatio: boolean,
  fromCenter: boolean,
  min = 1,
): Box {
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (h.includes('w')) x0 = p.x;
  if (h.includes('e')) x1 = p.x;
  if (h.includes('n')) y0 = p.y;
  if (h.includes('s')) y1 = p.y;
  if (fromCenter) {
    if (h.includes('w')) x1 = 2 * cx - x0;
    if (h.includes('e')) x0 = 2 * cx - x1;
    if (h.includes('n')) y1 = 2 * cy - y0;
    if (h.includes('s')) y0 = 2 * cy - y1;
  }
  let w = Math.max(min, Math.abs(x1 - x0));
  let hh = Math.max(min, Math.abs(y1 - y0));
  if (keepRatio && b.w > 0 && b.h > 0) {
    const ratio = b.w / b.h;
    if (h === 'n' || h === 's') w = hh * ratio;
    else if (h === 'e' || h === 'w') hh = w / ratio;
    else if (w / hh > ratio) hh = w / ratio;
    else w = hh * ratio;
  }
  // Anchor: the side opposite the handle (or the center).
  let x = h.includes('w') ? b.x + b.w - w : h.includes('e') ? b.x : cx - w / 2;
  let y = h.includes('n') ? b.y + b.h - hh : h.includes('s') ? b.y : cy - hh / 2;
  if (fromCenter) {
    x = cx - w / 2;
    y = cy - hh / 2;
  }
  // Dragged past the opposite side: flip into place instead of a negative size.
  if (!fromCenter && h.includes('w') && p.x > b.x + b.w) x = b.x + b.w;
  if (!fromCenter && h.includes('e') && p.x < b.x) x = b.x - w;
  if (!fromCenter && h.includes('n') && p.y > b.y + b.h) y = b.y + b.h;
  if (!fromCenter && h.includes('s') && p.y < b.y) y = b.y - hh;
  return { x, y, w, h: hh };
}

// ------------------------------------------------------------------ align, distribute, snap

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** How far each box moves to line up with `ref` (the selection or the page). */
export function alignDeltas(boxes: Box[], mode: AlignMode, ref: Box): Pt[] {
  return boxes.map((b) => {
    switch (mode) {
      case 'left':
        return { x: ref.x - b.x, y: 0 };
      case 'hcenter':
        return { x: ref.x + ref.w / 2 - (b.x + b.w / 2), y: 0 };
      case 'right':
        return { x: ref.x + ref.w - (b.x + b.w), y: 0 };
      case 'top':
        return { x: 0, y: ref.y - b.y };
      case 'vcenter':
        return { x: 0, y: ref.y + ref.h / 2 - (b.y + b.h / 2) };
      case 'bottom':
        return { x: 0, y: ref.y + ref.h - (b.y + b.h) };
    }
  });
}

/** Equal gaps between 3+ boxes along an axis (the outer two stay). */
export function distributeDeltas(boxes: Box[], axis: 'x' | 'y'): Pt[] {
  const out: Pt[] = boxes.map(() => ({ x: 0, y: 0 }));
  if (boxes.length < 3) return out;
  const size = (b: Box): number => (axis === 'x' ? b.w : b.h);
  const pos = (b: Box): number => (axis === 'x' ? b.x : b.y);
  const order = boxes.map((b, i) => ({ b, i })).sort((a, c) => pos(a.b) - pos(c.b));
  const first = order[0]!.b;
  const last = order[order.length - 1]!.b;
  const span = pos(last) + size(last) - pos(first);
  const used = order.reduce((s, o) => s + size(o.b), 0);
  const gap = (span - used) / (order.length - 1);
  let at = pos(first);
  for (const o of order) {
    const d = at - pos(o.b);
    out[o.i] = axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d };
    at += size(o.b) + gap;
  }
  return out;
}

export interface Guide {
  axis: 'x' | 'y';
  /** Position of the line (x for a vertical line, y for a horizontal one). */
  at: number;
}

/**
 * Snaps a box being moved by (dx, dy): its left / center / right (and top / middle / bottom)
 * catch the nearest line of `xs` / `ys` within `tol`. Returns the corrected move and the
 * guide lines to draw.
 */
export function snapMove(
  b: Box,
  dx: number,
  dy: number,
  xs: number[],
  ys: number[],
  tol: number,
): { dx: number; dy: number; guides: Guide[] } {
  const best = (vals: number[], lines: number[]): { d: number; at: number } | null => {
    let r: { d: number; at: number } | null = null;
    for (const v of vals)
      for (const l of lines) {
        const d = l - v;
        if (Math.abs(d) <= tol && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, at: l };
      }
    return r;
  };
  const nx = b.x + dx;
  const ny = b.y + dy;
  const sx = best([nx, nx + b.w / 2, nx + b.w], xs);
  const sy = best([ny, ny + b.h / 2, ny + b.h], ys);
  const guides: Guide[] = [];
  if (sx) guides.push({ axis: 'x', at: sx.at });
  if (sy) guides.push({ axis: 'y', at: sy.at });
  return { dx: dx + (sx?.d ?? 0), dy: dy + (sy?.d ?? 0), guides };
}

/** Snap lines of a box: its two edges and its center. */
export function boxLines(b: Box): { xs: number[]; ys: number[] } {
  return { xs: [b.x, b.x + b.w / 2, b.x + b.w], ys: [b.y, b.y + b.h / 2, b.y + b.h] };
}

// ------------------------------------------------------------------ pen tool and shapes

/** A point of the pen tool: the anchor and its outgoing handle (the incoming one mirrors it). */
export interface PenPoint {
  x: number;
  y: number;
  /** Outgoing control point; absent = a corner. */
  hx?: number;
  hy?: number;
}

/** Path data of pen points: lines between corners, cubic curves where there are handles. */
export function penPath(pts: PenPoint[], closed: boolean): string {
  if (!pts.length) return '';
  const f = (v: number): string => String(r4(v));
  const out = [`M ${f(pts[0]!.x)} ${f(pts[0]!.y)}`];
  const seg = (a: PenPoint, b: PenPoint): string => {
    const aOut = a.hx !== undefined && a.hy !== undefined ? { x: a.hx, y: a.hy } : null;
    // Incoming handle of b: the mirror of its outgoing one.
    const bIn =
      b.hx !== undefined && b.hy !== undefined ? { x: 2 * b.x - b.hx, y: 2 * b.y - b.hy } : null;
    if (!aOut && !bIn) return `L ${f(b.x)} ${f(b.y)}`;
    const c1 = aOut ?? a;
    const c2 = bIn ?? b;
    return `C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
  };
  for (let i = 1; i < pts.length; i++) out.push(seg(pts[i - 1]!, pts[i]!));
  if (closed && pts.length > 2) {
    const last = pts[pts.length - 1]!;
    const first = pts[0]!;
    if (last.hx !== undefined || first.hx !== undefined) out.push(seg(last, first));
    out.push('Z');
  }
  return out.join(' ');
}

export type ShapeKind = 'star' | 'triangle' | 'hexagon' | 'arrow' | 'heart' | 'speech';

/** Path data of a ready-made shape inside the box (x, y, w, h). */
export function shapePath(kind: ShapeKind, b: Box): string {
  const f = (v: number): string => String(r4(v));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const poly = (pts: Pt[]): string => `M ${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join(' L ')} Z`;
  switch (kind) {
    case 'star': {
      const pts: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.5 : 0.2;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push({ x: cx + Math.cos(a) * b.w * r, y: cy + Math.sin(a) * b.h * r + b.h * 0.03 });
      }
      return poly(pts);
    }
    case 'triangle':
      return poly([
        { x: cx, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ]);
    case 'hexagon': {
      const pts: Pt[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        pts.push({ x: cx + (Math.cos(a) * b.w) / 2, y: cy + (Math.sin(a) * b.h) / 2 });
      }
      return poly(pts);
    }
    case 'arrow':
      return poly([
        { x: b.x, y: b.y + b.h * 0.3 },
        { x: b.x + b.w * 0.6, y: b.y + b.h * 0.3 },
        { x: b.x + b.w * 0.6, y: b.y },
        { x: b.x + b.w, y: cy },
        { x: b.x + b.w * 0.6, y: b.y + b.h },
        { x: b.x + b.w * 0.6, y: b.y + b.h * 0.7 },
        { x: b.x, y: b.y + b.h * 0.7 },
      ]);
    case 'heart': {
      const x = (u: number): string => f(b.x + u * b.w);
      const y = (v: number): string => f(b.y + v * b.h);
      return (
        `M ${x(0.5)} ${y(1)} C ${x(0.1)} ${y(0.7)} ${x(0)} ${y(0.45)} ${x(0)} ${y(0.28)}` +
        ` C ${x(0)} ${y(0.1)} ${x(0.15)} ${y(0)} ${x(0.28)} ${y(0)} C ${x(0.4)} ${y(0)} ${x(0.48)} ${y(0.08)} ${x(0.5)} ${y(0.18)}` +
        ` C ${x(0.52)} ${y(0.08)} ${x(0.6)} ${y(0)} ${x(0.72)} ${y(0)} C ${x(0.85)} ${y(0)} ${x(1)} ${y(0.1)} ${x(1)} ${y(0.28)}` +
        ` C ${x(1)} ${y(0.45)} ${x(0.9)} ${y(0.7)} ${x(0.5)} ${y(1)} Z`
      );
    }
    case 'speech': {
      const r = Math.min(b.w, b.h) * 0.12;
      const x0 = b.x;
      const y0 = b.y;
      const x1 = b.x + b.w;
      const y1 = b.y + b.h * 0.78;
      return (
        `M ${f(x0 + r)} ${f(y0)} L ${f(x1 - r)} ${f(y0)} Q ${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + r)}` +
        ` L ${f(x1)} ${f(y1 - r)} Q ${f(x1)} ${f(y1)} ${f(x1 - r)} ${f(y1)} L ${f(x0 + b.w * 0.4)} ${f(y1)}` +
        ` L ${f(x0 + b.w * 0.2)} ${f(b.y + b.h)} L ${f(x0 + b.w * 0.25)} ${f(y1)} L ${f(x0 + r)} ${f(y1)}` +
        ` Q ${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - r)} L ${f(x0)} ${f(y0 + r)} Q ${f(x0)} ${f(y0)} ${f(x0 + r)} ${f(y0)} Z`
      );
    }
  }
}

/** Colors as #rrggbb for <input type=color> (named / rgb() / #rgb); null when not a plain color. */
export function toHexColor(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m)
    return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}`;
  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    orange: '#ffa500',
    purple: '#800080',
    gray: '#808080',
    grey: '#808080',
  };
  return named[s] ?? null;
}

/**
 * Whether a key press belongs to a field (typing text) rather than to the canvas. Sliders,
 * checkboxes, color pickers and selects still let Ctrl shortcuts (undo, save) through.
 */
export function isTypingTarget(t: EventTarget | null, mod: boolean): boolean {
  if (!(t instanceof Element)) return false;
  if (t.closest('textarea, [contenteditable]')) return true;
  if (t instanceof HTMLInputElement)
    return !['range', 'checkbox', 'radio', 'color', 'button'].includes(t.type) || !mod;
  if (t instanceof HTMLSelectElement) return !mod;
  return false;
}

// ------------------------------------------------------------------ text that wraps to a width

export interface WrappedLine {
  text: string;
  /** The line continues the paragraph of the line before (a wrap, not an Enter). */
  soft: boolean;
}

/**
 * Breaks paragraphs (split by Enter) into lines no wider than `width`, measured with
 * `measure` (the renderer measures with the real font). A word wider than the box is cut
 * by letters. width <= 0 keeps the lines as they are.
 */
export function wrapText(
  value: string,
  width: number,
  measure: (s: string) => number,
): WrappedLine[] {
  const paras = value.replace(/\r/g, '').split('\n');
  const out: WrappedLine[] = [];
  for (const p of paras) {
    if (!(width > 0) || !p.trim()) {
      out.push({ text: p, soft: false });
      continue;
    }
    const words = p.split(/ +/).filter(Boolean);
    let line = '';
    let soft = false;
    const flush = (): void => {
      out.push({ text: line, soft });
      soft = true;
      line = '';
    };
    /** Puts a word on the (empty) line, cut by letters when it alone is too wide. */
    const place = (word: string): void => {
      if (measure(word) <= width || word.length < 2) {
        line = word;
        return;
      }
      let part = '';
      for (const ch of word) {
        if (part && measure(part + ch) > width) {
          line = part;
          flush();
          part = '';
        }
        part += ch;
      }
      line = part;
    };
    for (const word of words) {
      if (!line) place(word);
      else if (measure(`${line} ${word}`) <= width) line = `${line} ${word}`;
      else {
        flush();
        place(word);
      }
    }
    out.push({ text: line, soft });
  }
  return out;
}
