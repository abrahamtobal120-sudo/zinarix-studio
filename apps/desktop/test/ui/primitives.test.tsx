// @vitest-environment jsdom
// Phase 16C: keyboard and focus behavior of the primitives.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  MAX_TOASTS,
  Menu,
  Skeleton,
  Tabs,
  ToastViewport,
  Tooltip,
  clearToasts,
  pushToast,
} from '../../src/renderer/ui';

beforeAll(() => {
  // jsdom lacks what Radix' positioning and pointer code call.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  // ModalShell-style focus helpers skip elements without boxes; give them one.
  Element.prototype.getClientRects = function () {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList;
  };
});

/** Radix moves focus and arms its outside-click listener on a timeout. */
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

afterEach(() => {
  cleanup();
  act(() => clearToasts());
  vi.useRealTimers();
});

describe('Button and IconButton', () => {
  it('is type="button" by default and loading blocks clicks', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Guardar
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Guardar' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('IconButton takes its accessible name from label', () => {
    render(<IconButton label="Cerrar" icon={<svg />} />);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('IconButton without label does not compile', () => {
    // @ts-expect-error label is required
    const el = <IconButton icon={<svg />} />;
    expect(el).toBeTruthy();
  });
});

describe('Field and Input', () => {
  it('wires label, help and error to the control', () => {
    render(
      <Field label="Nombre" help="Como aparece en el chat" error="Falta el nombre">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Nombre');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids.map((id) => document.getElementById(id)!.textContent)).toEqual([
      'Como aparece en el chat',
      'Falta el nombre',
    ]);
  });
});

describe('Dialog', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Abrir</button>
        {open && (
          <Dialog
            label="Ajustes"
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          >
            <button>Primero</button>
            <button>Último</button>
          </Dialog>
        )}
      </>
    );
  }

  it('focus moves in, Escape closes and focus goes back to the opener', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Ajustes' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.closest('.modal-backdrop')).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await tick();
    expect(document.activeElement).toBe(opener);
  });

  it('mounts in the shared #ui-portal', async () => {
    render(<Harness onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.closest('#ui-portal')).toBeTruthy();
  });

  it('a click on the backdrop closes it, a click inside does not', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = await screen.findByRole('dialog');
    await tick();
    const inside = screen.getByRole('button', { name: 'Primero' });
    fireEvent.pointerDown(inside);
    fireEvent.click(inside);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    // A mouse press counts once the click lands (Radix waits for it).
    const backdrop = dialog.closest('.modal-backdrop')!;
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Menu', () => {
  it('opens from the keyboard, arrows move, Enter picks and focus returns', async () => {
    const save = vi.fn();
    const close = vi.fn();
    render(
      <Menu
        trigger={<button>Archivo</button>}
        items={[
          { label: 'Guardar', onSelect: save, shortcut: 'Ctrl+S' },
          { separator: true },
          { label: 'Cerrar', onSelect: close },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Archivo' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['GuardarCtrlS', 'Cerrar']);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    await tick();
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'Enter' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    await tick();
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape closes without picking', async () => {
    const save = vi.fn();
    render(<Menu trigger={<button>Más</button>} items={[{ label: 'Guardar', onSelect: save }]} />);
    const trigger = screen.getByRole('button', { name: 'Más' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const item = await screen.findByRole('menuitem');
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('a submenu opens with the right arrow', async () => {
    render(
      <Menu
        trigger={<button>Ver</button>}
        items={[{ label: 'Tema', items: [{ label: 'Oscuro', onSelect: () => {} }] }]}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Ver' }), { key: 'Enter' });
    const sub = await screen.findByRole('menuitem', { name: /Tema/ });
    sub.focus();
    fireEvent.keyDown(sub, { key: 'ArrowRight' });
    expect(await screen.findByRole('menuitem', { name: 'Oscuro' })).toBeTruthy();
  });
});

describe('Tabs', () => {
  it('arrow keys move between tabs and show their panel', async () => {
    render(
      <Tabs
        label="Secciones"
        items={[
          { value: 'a', label: 'General', content: 'Panel general' },
          { value: 'b', label: 'Avanzado', content: 'Panel avanzado' },
        ]}
      />,
    );
    const [first, second] = screen.getAllByRole('tab');
    expect(first!.getAttribute('aria-selected')).toBe('true');
    first!.focus();
    fireEvent.keyDown(first!, { key: 'ArrowRight' });
    await tick();
    expect(document.activeElement).toBe(second);
    fireEvent.mouseDown(second!);
    fireEvent.focus(second!);
    expect(second!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel avanzado');
  });
});

describe('Tooltip', () => {
  it('shows on keyboard focus', async () => {
    render(
      <Tooltip content="Guardar (Ctrl+S)">
        <button>Guardar</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Guardar' }));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Guardar (Ctrl+S)');
  });
});

describe('Toast', () => {
  it('a new notice does not erase the one before', () => {
    render(<ToastViewport />);
    act(() => {
      pushToast('Guardado');
      pushToast('Copiado');
    });
    expect(screen.getByText('Guardado')).toBeTruthy();
    expect(screen.getByText('Copiado')).toBeTruthy();
  });

  it('"Deshacer" runs its function and closes the notice', () => {
    const undo = vi.fn();
    render(<ToastViewport />);
    act(() => {
      pushToast('Archivo borrado', { action: { label: 'Deshacer', run: undo } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Archivo borrado')).toBeNull();
  });

  it(`keeps at most ${MAX_TOASTS}: the oldest goes`, () => {
    render(<ToastViewport />);
    act(() => {
      for (const t of ['uno', 'dos', 'tres', 'cuatro']) pushToast(t);
    });
    expect(screen.queryByText('uno')).toBeNull();
    for (const t of ['dos', 'tres', 'cuatro']) expect(screen.getByText(t)).toBeTruthy();
  });

  it('errors are announced at once, the rest politely, and they leave on their own', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    act(() => {
      pushToast('Sin conexión', { kind: 'error' });
      pushToast('Listo', { kind: 'ok' });
    });
    expect(screen.getByText('Sin conexión').closest('[role="alert"]')).toBeTruthy();
    expect(screen.getByText('Listo').closest('[aria-live="polite"]')).toBeTruthy();
    act(() => vi.advanceTimersByTime(4100));
    expect(screen.queryByText('Listo')).toBeNull();
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText('Sin conexión')).toBeNull();
  });
});

describe('Badge, Kbd, Skeleton, EmptyState', () => {
  it('render their content', () => {
    render(
      <>
        <Badge tone="ok">Local</Badge>
        <Kbd keys="Ctrl+Shift+P" />
        <Skeleton lines={3} />
        <EmptyState title="Sin cambios" action={<Button>Actualizar</Button>}>
          No hay nada que confirmar.
        </EmptyState>
      </>,
    );
    expect(screen.getByText('Local').className).toContain('ui-badge-ok');
    const kbd = screen.getByLabelText('Ctrl+Shift+P');
    expect([...kbd.querySelectorAll('.ui-kbd-key')].map((k) => k.textContent)).toEqual([
      'Ctrl',
      'Shift',
      'P',
    ]);
    expect(document.querySelectorAll('.ui-skeleton')).toHaveLength(3);
    expect(screen.getByText('Sin cambios')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeTruthy();
  });
});
