/**
 * Editing script of the visual editor (Panel de Edición). It is served only inside the
 * preview frame (a sandboxed, opaque-origin iframe), added to the page by the zxp://
 * protocol: it has no Node, no Zinarix API, only postMessage to the panel that embeds it.
 * It highlights what the pointer is over, selects on click, lets the person write on a
 * text in place, and reports everything to the panel, which writes the files.
 */
import type {
  DesignLayer,
  DesignPreviewCmd,
  DesignPreviewMsg,
  DesignSelection,
} from '../shared/design.js';

(() => {
  const ATTR = 'data-zx-src';
  const INLINE = new Set([
    'a', 'abbr', 'b', 'br', 'code', 'em', 'i', 'kbd', 'mark', 'q', 's', 'small', 'span',
    'strong', 'sub', 'sup', 'time', 'u',
  ]);
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'title', 'head', 'base', 'noscript', 'template']);
  const STYLE_KEYS = [
    'color', 'background-color', 'background-image', 'font-size', 'font-weight', 'font-style',
    'font-family', 'text-decoration-line', 'text-align', 'line-height', 'letter-spacing',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top',
    'margin-right', 'margin-bottom', 'margin-left', 'border-top-left-radius', 'width',
    'height', 'opacity', 'display', 'box-shadow',
  ];

  /**
   * Live mode (framework projects shown by their dev server or built files): every element
   * can be selected, but nothing is written to the files (changes are asked to the AI), so
   * elements get their number here, kept out of the page (no attribute: React and others
   * would see a changed page).
   */
  const LIVE = document.currentScript?.hasAttribute('data-zx-live') ?? false;
  const liveIds = new WeakMap<Element, string>();
  const liveEls = new Map<string, WeakRef<Element>>();
  let liveNext = 0;
  const liveId = (el: Element): string => {
    let id = liveIds.get(el);
    if (!id) {
      id = `live#${++liveNext}`;
      liveIds.set(el, id);
      liveEls.set(id, new WeakRef(el));
    }
    return id;
  };

  let mode: 'edit' | 'visitor' = 'edit';
  let selected: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let editing: { el: HTMLElement; before: string } | null = null;

  const post = (msg: DesignPreviewMsg) => window.parent.postMessage({ zx: 1, ...msg }, '*');
  const srcOf = (el: Element | null) => (!el ? null : LIVE ? liveId(el) : el.getAttribute(ATTR));
  const find = (src: string | null): HTMLElement | null => {
    if (!src) return null;
    if (LIVE) {
      const el = liveEls.get(src)?.deref();
      return el?.isConnected ? (el as HTMLElement) : null;
    }
    for (const el of document.querySelectorAll<HTMLElement>(`[${ATTR}]`))
      if (el.getAttribute(ATTR) === src) return el;
    return null;
  };
  const target = (node: EventTarget | null): HTMLElement | null => {
    let el = node instanceof Element ? node : null;
    if (LIVE) {
      // The drawing as a whole, not one of its lines.
      const svg = el?.closest('svg');
      if (svg) el = svg;
      while (el && (SKIP.has(el.tagName.toLowerCase()) || el === document.documentElement || el === host))
        el = el.parentElement;
      return el as HTMLElement | null;
    }
    while (el && (!el.hasAttribute(ATTR) || SKIP.has(el.tagName.toLowerCase()) || el === document.documentElement))
      el = el.parentElement;
    return el as HTMLElement | null;
  };
  const snippet = (el: Element): string => {
    const own =
      el.getAttribute('alt') ??
      el.getAttribute('aria-label') ??
      el.getAttribute('placeholder') ??
      el.getAttribute('title') ??
      (el as HTMLElement).innerText ??
      el.textContent ??
      '';
    return own.replace(/\s+/g, ' ').trim().slice(0, 40);
  };
  const isEditable = (el: Element): boolean => {
    if (LIVE) return false;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag) || ['img', 'input', 'video', 'iframe', 'svg', 'select', 'textarea', 'html', 'body'].includes(tag))
      return false;
    const ok = (e: Element): boolean =>
      [...e.children].every((c) => INLINE.has(c.tagName.toLowerCase()) && ok(c));
    return ok(el) && (el.textContent ?? '').trim().length > 0;
  };

  // ------------------------------------------------------------ overlay (shadow DOM)

  const host = document.createElement('zx-overlay');
  host.setAttribute('data-zx-ui', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .box { position: fixed; pointer-events: none; box-sizing: border-box; z-index: 2147483646; display: none; }
      .hover { border: 1px solid #4f8cff; }
      .sel { border: 2px solid #2f6bff; }
      .sel i { position: absolute; width: 8px; height: 8px; background: #fff; border: 1.5px solid #2f6bff; border-radius: 2px; }
      .tag { position: fixed; z-index: 2147483647; pointer-events: none; display: none; font: 600 11px/1 system-ui, sans-serif;
             background: #2f6bff; color: #fff; padding: 3px 6px; border-radius: 4px; white-space: nowrap; }
      .bar { position: fixed; z-index: 2147483647; display: none; gap: 2px; padding: 3px; background: #1f2430; border-radius: 8px;
             box-shadow: 0 4px 16px rgba(0,0,0,.3); font: 13px system-ui, sans-serif; }
      .bar button { all: unset; cursor: pointer; color: #fff; min-width: 26px; height: 26px; padding: 0 6px; border-radius: 5px;
                    display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; }
      .bar button:hover, .bar button:focus-visible { background: #3a4152; }
    </style>
    <div class="box hover"></div>
    <div class="box sel"><i style="left:-5px;top:-5px"></i><i style="right:-5px;top:-5px"></i><i style="left:-5px;bottom:-5px"></i><i style="right:-5px;bottom:-5px"></i></div>
    <div class="tag"></div>
    <div class="bar" role="toolbar">
      <button data-a="edit" title="Editar texto (doble clic)">✎</button>
      <button data-a="bold" title="Negrita (Ctrl+B)"><b>B</b></button>
      <button data-a="italic" title="Cursiva (Ctrl+I)"><i>I</i></button>
      <button data-a="underline" title="Subrayado (Ctrl+U)"><u>U</u></button>
      <button data-a="parent" title="Seleccionar el contenedor (Esc)">⤴</button>
      <button data-a="ai" title="Pedir a la IA que lo cambie">✨ IA</button>
    </div>`;
  const hoverBox = shadow.querySelector<HTMLElement>('.hover')!;
  const selBox = shadow.querySelector<HTMLElement>('.sel')!;
  const tagEl = shadow.querySelector<HTMLElement>('.tag')!;
  const bar = shadow.querySelector<HTMLElement>('.bar')!;
  let names: Record<string, string> = {};

  const place = (box: HTMLElement, el: HTMLElement | null) => {
    if (!el || mode !== 'edit' || !el.isConnected) {
      box.style.display = 'none';
      return null;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    return r;
  };
  const label = (el: HTMLElement) => names[el.tagName.toLowerCase()] ?? el.tagName.toLowerCase();
  const draw = () => {
    place(hoverBox, hovered && hovered !== selected ? hovered : null);
    const hr = hovered && hovered !== selected ? hovered.getBoundingClientRect() : null;
    if (hr && mode === 'edit') {
      tagEl.textContent = label(hovered!);
      Object.assign(tagEl.style, {
        display: 'block',
        left: `${Math.max(0, hr.left)}px`,
        top: `${hr.top > 22 ? hr.top - 20 : hr.bottom + 2}px`,
      });
    } else tagEl.style.display = 'none';
    const r = place(selBox, selected);
    if (r && !editing) {
      const editable = selected ? isEditable(selected) : false;
      for (const b of bar.querySelectorAll<HTMLElement>('[data-a="edit"],[data-a="bold"],[data-a="italic"],[data-a="underline"]'))
        b.style.display = editable ? '' : 'none';
      bar.style.display = 'flex';
      const bh = bar.offsetHeight || 32;
      const top = r.top > bh + 8 ? r.top - bh - 6 : Math.min(innerHeight - bh - 4, r.bottom + 6);
      Object.assign(bar.style, { left: `${Math.max(4, Math.min(r.left, innerWidth - bar.offsetWidth - 4))}px`, top: `${top}px` });
    } else bar.style.display = editing ? 'flex' : 'none';
  };
  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };

  // ------------------------------------------------------------ selection

  const styleOf = (el: HTMLElement): Record<string, string> => {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const k of STYLE_KEYS) out[k] = cs.getPropertyValue(k);
    return out;
  };
  const inlineOf = (el: HTMLElement): Record<string, string> => {
    const out: Record<string, string> = {};
    for (let i = 0; i < el.style.length; i++) {
      const k = el.style.item(i);
      out[k] = el.style.getPropertyValue(k);
    }
    return out;
  };
  const describe = (el: HTMLElement): DesignSelection => {
    const r = el.getBoundingClientRect();
    const parents: DesignSelection['parents'] = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const src = srcOf(p);
      if (src && p !== document.documentElement) parents.push({ src, tag: p.tagName.toLowerCase(), text: snippet(p) });
    }
    const clone = el.cloneNode(true) as HTMLElement;
    for (const c of [clone, ...clone.querySelectorAll('*')]) c.removeAttribute(ATTR);
    return {
      src: srcOf(el)!,
      tag: el.tagName.toLowerCase(),
      text: snippet(el),
      editable: isEditable(el),
      value: (el.innerText ?? '').slice(0, 2000),
      style: styleOf(el),
      inline: inlineOf(el),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      parents,
      image: el instanceof HTMLImageElement ? el.getAttribute('src') ?? '' : undefined,
      outer: clone.outerHTML.slice(0, 3000),
    };
  };
  const select = (el: HTMLElement | null, notify = true) => {
    if (editing && editing.el !== el) finishEdit(true);
    selected = el;
    redraw();
    if (notify) post({ type: 'select', selection: el ? describe(el) : null });
  };

  // ------------------------------------------------------------ text editing in place

  const startEdit = (el: HTMLElement) => {
    if (!isEditable(el)) return;
    if (editing?.el === el) return;
    if (editing) finishEdit(true);
    select(el);
    editing = { el, before: el.innerHTML };
    el.contentEditable = 'true';
    el.spellcheck = true;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    redraw();
  };
  const finishEdit = (keep: boolean) => {
    const e = editing;
    if (!e) return;
    editing = null;
    e.el.removeAttribute('contenteditable');
    if (!keep) e.el.innerHTML = e.before;
    else if (e.el.innerHTML !== e.before) post({ type: 'textChanged', src: srcOf(e.el)!, html: e.el.innerHTML });
    getSelection()?.removeAllRanges();
    redraw();
    if (selected === e.el) post({ type: 'select', selection: describe(e.el) });
  };

  // ------------------------------------------------------------ events

  const inUi = (e: Event) => e.composedPath().includes(host);
  const editHere = (e: Event) => editing !== null && e.composedPath().includes(editing.el);

  document.addEventListener(
    'mousemove',
    (e) => {
      if (mode !== 'edit' || inUi(e)) return;
      const el = target(e.target);
      if (el !== hovered) {
        hovered = el;
        redraw();
        post({ type: 'hover', src: srcOf(el) });
      }
    },
    true,
  );
  document.addEventListener('mouseleave', () => {
    hovered = null;
    redraw();
    post({ type: 'hover', src: null });
  });
  for (const type of ['click', 'mousedown', 'mouseup', 'auxclick', 'submit', 'pointerdown']) {
    document.addEventListener(
      type,
      (e) => {
        if (inUi(e)) return;
        if (mode === 'visitor') {
          if (type === 'click') followLink(e);
          return;
        }
        if (editHere(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (type === 'click') select(target(e.target));
      },
      true,
    );
  }
  document.addEventListener(
    'dblclick',
    (e) => {
      if (mode !== 'edit' || inUi(e) || editHere(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = target(e.target);
      if (el) startEdit(el);
    },
    true,
  );
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (mode === 'edit' && !editHere(e)) e.preventDefault();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (mode !== 'edit') return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (editing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finishEdit(false);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finishEdit(true);
        } else if (ctrl && (k === 'b' || k === 'i' || k === 'u')) {
          e.preventDefault();
          document.execCommand(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
        }
        return;
      }
      const key =
        ctrl && k === 'z' && !e.shiftKey ? 'undo'
        : ctrl && (k === 'y' || (k === 'z' && e.shiftKey)) ? 'redo'
        : ctrl && k === 's' ? 'save'
        : ctrl && k === 'k' ? 'ai'
        : e.key === 'Escape' ? 'escape'
        : null;
      if (key) {
        e.preventDefault();
        post({ type: 'key', key });
      } else if (e.key === 'Enter' && selected && isEditable(selected)) {
        e.preventDefault();
        startEdit(selected);
      }
    },
    true,
  );
  // Pasting into a text keeps only the words (no fonts and colors from Word or a web page).
  document.addEventListener(
    'paste',
    (e) => {
      if (!editing) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text);
    },
    true,
  );
  document.addEventListener(
    'focusout',
    (e) => {
      if (editing && e.target === editing.el && !inUi(e as FocusEvent)) {
        const to = (e as FocusEvent).relatedTarget;
        if (!(to instanceof Node && host.contains(to))) finishEdit(true);
      }
    },
    true,
  );
  let scrollTimer = 0;
  addEventListener('scroll', () => {
    redraw();
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => post({ type: 'scroll', y: scrollY }), 150);
  }, true);
  addEventListener('resize', redraw);
  new ResizeObserver(redraw).observe(document.documentElement);

  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('[data-a]')?.getAttribute('data-a');
    if (!a || !selected) return;
    const src = srcOf(selected)!;
    if (a === 'edit') startEdit(selected);
    else if (a === 'parent' || a === 'ai') {
      if (editing) finishEdit(true);
      post({ type: 'action', action: a, src });
    } else format(a as 'bold' | 'italic' | 'underline');
  });

  /** Bold/italic/underline: on the words selected while writing, or on the whole text. */
  const format = (command: 'bold' | 'italic' | 'underline' | 'strikeThrough') => {
    if (!selected || !isEditable(selected)) return;
    if (!editing) {
      startEdit(selected);
    }
    document.execCommand(command);
    finishEdit(true);
  };

  /** Visitor mode: links to other pages of the project change the page shown in the panel. */
  const followLink = (e: Event) => {
    if (LIVE) return; // the app moves between its own screens
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) return;
    e.preventDefault();
    try {
      const url = new URL(href, location.href);
      if (url.origin === location.origin) post({ type: 'navigate', path: url.pathname });
    } catch {
      // not an address: nothing to follow
    }
  };

  // ------------------------------------------------------------ panel → preview

  const hiddenStyle = new Map<HTMLElement, string>();
  addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window.parent) return;
    const cmd = ev.data as DesignPreviewCmd & { zx?: number; names?: Record<string, string> };
    if (!cmd || cmd.zx !== 1) return;
    switch (cmd.type) {
      case 'select':
        select(find(cmd.src), false);
        selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (selected) post({ type: 'select', selection: describe(selected) });
        break;
      case 'hover':
        hovered = find(cmd.src);
        redraw();
        break;
      case 'style': {
        const el = find(cmd.src);
        if (!el) break;
        // Removals first: dropping "padding-top" after setting "padding" would undo part of it.
        const entries = Object.entries(cmd.styles);
        for (const [k, v] of entries) if (v === null || v === '') el.style.removeProperty(k);
        for (const [k, v] of entries) if (v !== null && v !== '') el.style.setProperty(k, v);
        redraw();
        if (el === selected) post({ type: 'select', selection: describe(el) });
        break;
      }
      case 'editText': {
        const el = find(cmd.src);
        if (el) startEdit(el);
        break;
      }
      case 'format':
        format(cmd.command);
        break;
      case 'setHidden': {
        const el = find(cmd.src);
        if (!el) break;
        if (cmd.hidden) {
          hiddenStyle.set(el, el.style.display);
          el.style.display = 'none';
        } else {
          el.style.display = hiddenStyle.get(el) ?? '';
          hiddenStyle.delete(el);
        }
        redraw();
        break;
      }
      case 'mode':
        mode = cmd.mode;
        if (mode === 'visitor') {
          finishEdit(true);
          hovered = null;
        }
        redraw();
        break;
      case 'outlines':
        document.documentElement.toggleAttribute('data-zx-outlines', cmd.on);
        outlineStyle.disabled = !cmd.on;
        break;
      case 'scrollTo':
        scrollTo(0, cmd.y);
        break;
    }
    if (cmd.names) {
      names = cmd.names;
      redraw();
    }
  });

  const outlineStyle = document.createElement('style');
  outlineStyle.setAttribute('data-zx-ui', '');
  outlineStyle.textContent = LIVE
    ? 'body *:not(zx-overlay) { outline: 1px dashed rgba(79,140,255,.55); outline-offset: -1px; }'
    : `[${ATTR}]:not(html):not(body) { outline: 1px dashed rgba(79,140,255,.55); outline-offset: -1px; }`;

  // ------------------------------------------------------------ start

  let treeBudget = 0;
  const tree = (el: Element): DesignLayer[] => {
    const out: DesignLayer[] = [];
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase();
      if (SKIP.has(tag) || c.hasAttribute('data-zx-ui')) continue;
      if (LIVE && --treeBudget < 0) break;
      const src = srcOf(c);
      if (!src) {
        out.push(...tree(c));
        continue;
      }
      // Formatting inside a text is part of that text, not a layer of its own.
      const kids = (INLINE.has(tag) && tag !== 'a') || tag === 'svg' ? [] : tree(c);
      out.push({ src, tag, text: snippet(c), children: kids });
    }
    return out;
  };
  const start = () => {
    document.documentElement.appendChild(host);
    outlineStyle.disabled = true;
    document.head?.appendChild(outlineStyle);
    treeBudget = 3000;
    post({ type: 'ready', title: document.title, tree: document.body ? tree(document.body) : [] });
    if (!LIVE) return;
    // Apps draw (and redraw) their screens after the page loads: the Layers follow.
    let timer = 0;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        treeBudget = 3000;
        post({ type: 'tree', title: document.title, tree: document.body ? tree(document.body) : [] });
        if (selected && !selected.isConnected) select(null);
        redraw();
      }, 400);
    }).observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    let where = '';
    const tell = () => {
      const now = location.pathname + location.search;
      if (now !== where) post({ type: 'location', path: (where = now) });
    };
    tell();
    setInterval(tell, 500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
