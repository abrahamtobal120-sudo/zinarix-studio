import type { DesignOp, DesignSrc } from '../../shared/design.js';
import { EditError, SRC_ATTR, parseHtml, setStyle, setText, stripMarkers } from './htmlSource.js';

/** "index.html#12" → file and node; null for nodes only the preview knows ("rt:3"). */
export function parseSrc(src: DesignSrc): { file: string; index: number } | null {
  const m = /^(.+)#(\d+)$/.exec(src);
  if (!m) return null;
  return { file: m[1]!, index: Number(m[2]) };
}

const FRIENDLY: Record<string, string> = {
  color: 'color del texto',
  'background-color': 'color de fondo',
  background: 'fondo',
  'font-size': 'tamaño de letra',
  'font-weight': 'negrita',
  'font-style': 'cursiva',
  'font-family': 'tipo de letra',
  'text-decoration': 'subrayado',
  'text-align': 'alineación',
  'line-height': 'interlineado',
  'letter-spacing': 'espacio entre letras',
  padding: 'espacio por dentro',
  margin: 'espacio por fuera',
  'border-radius': 'esquinas',
  opacity: 'transparencia',
  width: 'ancho',
  height: 'alto',
};

/** Plain-words name of a change, for the Undo list ("Cambió color de fondo"). */
export function opLabel(op: DesignOp): string {
  if (op.kind === 'setText') return 'Escribió en el texto';
  const keys = Object.keys(op.styles).map((k) => FRIENDLY[k] ?? FRIENDLY[k.split('-')[0]!] ?? k);
  const uniq = [...new Set(keys)];
  const all = Object.values(op.styles).every((v) => v === null);
  return `${all ? 'Restableció' : 'Cambió'} ${uniq.slice(0, 2).join(' y ')}`;
}

/** Tags of every element except the descendants of one (its own content may change). */
function shapeAround(src: string, index: number): string {
  const nodes = parseHtml(src);
  const skip = new Set<number>();
  const mark = (k: number) => {
    for (const c of nodes[k]?.children ?? []) {
      skip.add(c);
      mark(c);
    }
  };
  mark(index);
  return nodes
    .filter((n) => !skip.has(n.index))
    .map((n) => n.tag)
    .join(',');
}

/**
 * Applies one operation to the text of a file and checks the result: the rest of the
 * document keeps its elements (an edit of one node never moves another), and no preview
 * marker reaches the file. Throws EditError (in plain words) when it can't be done safely.
 */
export function applyOp(content: string, op: DesignOp): string {
  const at = parseSrc(op.src);
  if (!at) throw new EditError('Este elemento no se puede guardar desde el panel.');
  let next: string;
  if (op.kind === 'setText') next = setText(content, at.index, op.html);
  else next = setStyle(content, at.index, op.styles);
  if (next.includes(SRC_ATTR)) next = stripMarkers(next);
  // The edited node and everything around it must be the same elements as before.
  const after = parseHtml(next);
  const before = parseHtml(content);
  const shift = after.length - before.length;
  const lastBefore = before[at.index];
  if (!lastBefore || after[at.index]?.tag !== lastBefore.tag)
    throw new EditError('El cambio movería otros elementos de la página.');
  // Only setText may change the node's own children (inline formatting).
  if (op.kind === 'setStyle' ? shift !== 0 : shapeAround(content, at.index) !== shapeAround(next, at.index))
    throw new EditError('El cambio movería otros elementos de la página.');
  return next;
}
