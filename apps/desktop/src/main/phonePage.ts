/**
 * The page the phone opens: pairing with the PIN, then the chats of the window (messages,
 * approvals, stop). Self-contained (no files, no outside requests); text is never parsed as
 * HTML.
 */
import { APP_APK, RELAY_PAGE } from './phoneBeacon.js';
import { CONFIG_CSS, CONFIG_ICONS, CONFIG_JS, CONFIG_TEXT } from './phoneConfig.js';
import { TOOLS_CSS, TOOLS_ICONS, TOOLS_JS, TOOLS_TEXT } from './phoneTools.js';

const TEXT = {
  es: {
    connecting: 'Conectando…',
    chats: 'Chats',
    newChat: 'Nuevo chat',
    pairTitle: 'Conecta tu celular',
    pairHint: 'Escribe el PIN que aparece en Zinarix Studio',
    pairWhere: 'Configuración → Celular',
    pin: 'PIN',
    connect: 'Conectar',
    pairWait:
      'Si el PIN es correcto, acepta la conexión en la ventana de Zinarix de la computadora…',
    ask: 'Pregunta o pide un cambio…',
    message: 'Mensaje',
    agent: 'Agente',
    stop: 'Detener',
    send: 'Enviar',
    offline: 'Sin conexión',
    working: 'Trabajando…',
    workingBadge: 'Trabajando',
    online: 'Conectado',
    approve: 'Aprobar',
    deny: 'Rechazar',
    emptyTitle: '¿En qué te ayudo?',
    emptyHint: 'Escribe abajo para hablar con la IA de tu computadora.',
    badPin: 'PIN incorrecto',
    noComputer: 'No se pudo conectar con la computadora',
    projects: 'Proyectos',
    openFolder: 'Abrir carpeta',
    noFolder: 'Sin carpeta',
    openNew: 'Abrir',
    openHere: 'Aquí',
    pull: 'Pull',
    close: 'Cerrar',
    loading: 'Cargando…',
    noRepos:
      'No hay repositorios todavía. Abre o clona uno en Zinarix Studio en la computadora y aparecerá aquí.',
    reposHint:
      '"Abrir" lo abre en una ventana nueva (como en la computadora); "Aquí" lo cambia en la ventana actual.',
    isOpen: 'Abierto',
    changes: 'cambios',
    pulled: 'Actualizado',
    mode: 'Modo',
    modeAsk: 'Preguntar',
    modeAskHint: 'Solo conversa: no lee ni cambia archivos.',
    modePlan: 'Planear',
    modePlanHint: 'Investiga el proyecto sin cambiar nada y termina con un plan.',
    modeAgent: 'Agente',
    modeAgentHint: 'Lee, edita y usa la terminal; cada cambio pide tu aprobación.',
    modeAuto: 'Auto-aprobar',
    modeAutoHint:
      'Edita archivos del proyecto sin preguntar; los comandos siguen pidiendo permiso.',
    modeFull: 'Acceso total',
    modeFullHint:
      'Archivos y comandos sin aprobación. Lo que sale de la computadora sigue preguntando.',
    fullConfirm:
      '¿Activar acceso total? La IA editará archivos y ejecutará comandos sin pedirte permiso.',
    models: 'Modelos de IA',
    model: 'Modelo',
    modelDefault: 'Predeterminado de la app',
    modelDefaultHint: 'Este chat usa el modelo general de Zinarix.',
    searchModels: 'Buscar modelo o proveedor…',
    fAll: 'Todos',
    fLocal: 'Locales',
    fTools: 'Agente',
    fVision: 'Visión',
    fReason: 'Razonamiento',
    fFree: 'Gratis',
    fCheap: 'Baratos',
    useHere: 'Usar en este chat',
    useAll: 'Hacer predeterminado',
    isDefault: 'Predeterminado',
    inChat: 'En este chat',
    local: 'Local',
    free: 'Gratis',
    noModels:
      'No hay modelos conectados. Conecta un proveedor en Zinarix Studio (Configuración → Modelos) o abre Ollama / LM Studio.',
    noMatch: 'Ningún modelo coincide.',
    modelsCount: 'modelos',
    ctx: 'contexto',
    queued: 'en cola',
    clearQueue: 'Vaciar cola',
    today: 'Gasto de hoy',
    closeChat: 'Cerrar chat',
    closeConfirm: '¿Cerrar este chat? Si está trabajando, se detiene.',
    copy: 'Copiar',
    copied: 'Copiado',
    q1: 'Explícame este proyecto en pocas palabras',
    q2: 'Busca errores en el código y propón arreglos',
    q3: 'Resume los cambios sin guardar en git',
    q4: 'Escribe pruebas para lo más importante',
    q5: 'Revisa la seguridad del proyecto',
    providerErr: 'Con error',
    more: 'Ver más',
    settings: 'Ajustes',
    textSize: 'Tamaño del texto',
    sizeS: 'Chico',
    sizeM: 'Mediano',
    sizeL: 'Grande',
    notify: 'Avisarme (vibración y notificación) cuando la IA termine o pida aprobación',
    wake: 'Mantener la pantalla encendida mientras la IA trabaja',
    enterSend: 'Enviar con Enter (Mayús + Enter para salto de línea)',
    deviceName: 'Nombre de este celular',
    save: 'Guardar',
    saved: 'Guardado',
    install: 'Instalar como app',
    installHint:
      'Para tenerlo como app con el mismo enlace: menú del navegador → "Agregar a pantalla de inicio".',
    unpairMe: 'Desconectar este celular',
    changeComputer: 'Cambiar de computadora',
    appOptions: 'Opciones de la app',
    getApp: 'Descargar la app para Android',
    getAppHint:
      'Con la app recibes avisos aunque el celular esté bloqueado, dictas por voz y el enlace se abre solo desde el QR.',
    unpairConfirm: '¿Desconectar este celular? Tendrás que escribir el PIN otra vez.',
    stays:
      'Este celular queda conectado aunque cierres Zinarix: cuando lo abras otra vez se reconecta solo, con el mismo enlace.',
    voice: 'Dictar',
    listening: 'Escuchando… toca otra vez para terminar',
    searchChats: 'Buscar chat…',
    resend: 'Reenviar',
    edit: 'Editar',
    share: 'Compartir',
    cont: 'Continuar',
    contText: 'Continúa',
    approveAll: 'Aprobar todo',
    denyAll: 'Rechazar todo',
    pendingN: '{n} acciones esperan tu aprobación',
    toBottom: 'Ir al final',
    prompts: 'Atajos',
    promptsHint: 'Toca uno para escribirlo en el mensaje. Guarda los que uses seguido.',
    addPrompt: 'Guardar lo escrito como atajo',
    noPromptText: 'Escribe primero el texto en el cuadro de mensaje.',
    del: 'Borrar',
    reconnecting: 'Sin conexión con la computadora. Reintentando…',
    doneNotify: 'La IA terminó de responder',
    approvalNotify: 'La IA pide tu aprobación',
    pairedSince: 'Conectado desde',
    otherWaiting: 'Otro chat espera aprobación',
    words: 'palabras',
  },
  en: {
    connecting: 'Connecting…',
    chats: 'Chats',
    newChat: 'New chat',
    pairTitle: 'Connect your phone',
    pairHint: 'Type the PIN shown in Zinarix Studio',
    pairWhere: 'Settings → Phone',
    pin: 'PIN',
    connect: 'Connect',
    pairWait: 'If the PIN is right, accept the connection in the Zinarix window on the computer…',
    ask: 'Ask or request a change…',
    message: 'Message',
    agent: 'Agent',
    stop: 'Stop',
    send: 'Send',
    offline: 'Offline',
    working: 'Working…',
    workingBadge: 'Working',
    online: 'Connected',
    approve: 'Approve',
    deny: 'Deny',
    emptyTitle: 'How can I help?',
    emptyHint: 'Type below to talk to the AI on your computer.',
    badPin: 'Wrong PIN',
    noComputer: 'Could not reach the computer',
    projects: 'Projects',
    openFolder: 'Open folder',
    noFolder: 'No folder',
    openNew: 'Open',
    openHere: 'Here',
    pull: 'Pull',
    close: 'Close',
    loading: 'Loading…',
    noRepos:
      'No repositories yet. Open or clone one in Zinarix Studio on the computer and it will show up here.',
    reposHint:
      '"Open" opens it in a new window (like on the computer); "Here" swaps the folder of the current window.',
    isOpen: 'Open',
    changes: 'changes',
    pulled: 'Updated',
    mode: 'Mode',
    modeAsk: 'Ask',
    modeAskHint: 'Just talks: does not read or change files.',
    modePlan: 'Plan',
    modePlanHint: 'Investigates the project without changing anything and ends with a plan.',
    modeAgent: 'Agent',
    modeAgentHint: 'Reads, edits and uses the terminal; every change asks for your approval.',
    modeAuto: 'Auto-approve',
    modeAutoHint: 'Edits project files without asking; commands still ask.',
    modeFull: 'Full access',
    modeFullHint: 'Files and commands without approval. What leaves the computer still asks.',
    fullConfirm: 'Turn on full access? The AI will edit files and run commands without asking.',
    models: 'AI models',
    model: 'Model',
    modelDefault: 'App default',
    modelDefaultHint: 'This chat uses the general Zinarix model.',
    searchModels: 'Search model or provider…',
    fAll: 'All',
    fLocal: 'Local',
    fTools: 'Agent',
    fVision: 'Vision',
    fReason: 'Reasoning',
    fFree: 'Free',
    fCheap: 'Cheap',
    useHere: 'Use in this chat',
    useAll: 'Make default',
    isDefault: 'Default',
    inChat: 'In this chat',
    local: 'Local',
    free: 'Free',
    noModels:
      'No models connected. Connect a provider in Zinarix Studio (Settings → Models) or start Ollama / LM Studio.',
    noMatch: 'No model matches.',
    modelsCount: 'models',
    ctx: 'context',
    queued: 'queued',
    clearQueue: 'Clear queue',
    today: 'Spent today',
    closeChat: 'Close chat',
    closeConfirm: 'Close this chat? If it is working, it stops.',
    copy: 'Copy',
    copied: 'Copied',
    q1: 'Explain this project in a few words',
    q2: 'Look for bugs in the code and suggest fixes',
    q3: 'Summarize the uncommitted git changes',
    q4: 'Write tests for the most important parts',
    q5: 'Review the security of the project',
    providerErr: 'Failing',
    more: 'Show more',
    settings: 'Settings',
    textSize: 'Text size',
    sizeS: 'Small',
    sizeM: 'Medium',
    sizeL: 'Large',
    notify: 'Alert me (vibration and notification) when the AI finishes or asks for approval',
    wake: 'Keep the screen on while the AI works',
    enterSend: 'Send with Enter (Shift + Enter for a new line)',
    deviceName: 'Name of this phone',
    save: 'Save',
    saved: 'Saved',
    install: 'Install as an app',
    installHint: 'To keep it as an app with the same link: browser menu → "Add to Home screen".',
    unpairMe: 'Disconnect this phone',
    changeComputer: 'Change computer',
    appOptions: 'App options',
    getApp: 'Get the Android app',
    getAppHint:
      'With the app you get alerts even with the phone locked, dictate by voice, and the QR link opens straight in it.',
    unpairConfirm: 'Disconnect this phone? You will have to type the PIN again.',
    stays:
      'This phone stays connected even if you close Zinarix: when it opens again it reconnects by itself, with the same link.',
    voice: 'Dictate',
    listening: 'Listening… tap again to finish',
    searchChats: 'Search chats…',
    resend: 'Resend',
    edit: 'Edit',
    share: 'Share',
    cont: 'Continue',
    contText: 'Continue',
    approveAll: 'Approve all',
    denyAll: 'Deny all',
    pendingN: '{n} actions wait for your approval',
    toBottom: 'Go to the end',
    prompts: 'Shortcuts',
    promptsHint: 'Tap one to write it in the message. Save the ones you use often.',
    addPrompt: 'Save what you typed as a shortcut',
    noPromptText: 'Type the text in the message box first.',
    del: 'Delete',
    reconnecting: 'No connection with the computer. Retrying…',
    doneNotify: 'The AI finished answering',
    approvalNotify: 'The AI asks for your approval',
    pairedSince: 'Connected since',
    otherWaiting: 'Another chat waits for approval',
    words: 'words',
  },
} as const;

export type PhoneLang = keyof typeof TEXT;

/** The page language from an Accept-Language header (Spanish unless English comes first). */
export function phoneLang(accept: string | undefined): PhoneLang {
  for (const part of (accept ?? '').split(',')) {
    const tag = part.trim().slice(0, 2).toLowerCase();
    if (tag === 'es' || tag === 'en') return tag;
  }
  return 'es';
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function phonePage(
  nonce: string,
  lang: PhoneLang = 'es',
  opts: {
    /** Path of the Android app on this computer, when Zinarix ships it. */ localApk?: string;
  } = {},
): string {
  const T = {
    ...(TEXT[lang] ?? TEXT.es),
    ...(TOOLS_TEXT[lang] ?? TOOLS_TEXT.es),
    ...(CONFIG_TEXT[lang] ?? CONFIG_TEXT.es),
  };
  const h = (k: keyof typeof T) => esc(T[k]);
  // Strings for the page script (constants: "<" escaped so nothing can close the tag).
  const json = JSON.stringify(T).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#131417" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Zinarix Studio</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<style nonce="${nonce}">
/* Same look as the chat of the desktop app (ui/tokens.css: dark / light, chat, tool cards). */
:root{
  --bg:#1a1b1e;--bg-2:#202125;--bg-3:#26272c;--bg-4:#32343c;--border:#33353d;
  --fg:#c8ccd4;--fg-dim:#8a8f9a;--strong:#fff;--hover:#26282e;
  --accent:#3b6fe0;--accent-fg:#fff;--focus:#6c8cff;
  --brand:#5b9bff;--grad:linear-gradient(135deg,#2f6fdb,#2563eb);
  --ok:#83d6a0;--warn:#e0b341;--danger:#f1595b;--code:#141519;
  --sel-soft:color-mix(in srgb,var(--brand) 18%,transparent);
  --ring:0 0 0 2px color-mix(in srgb,var(--focus) 38%,transparent);
  --shadow:0 12px 34px rgba(0,0,0,.55);
}
@media (prefers-color-scheme: light){:root{
  --bg:#fff;--bg-2:#f3f3f3;--bg-3:#ececec;--bg-4:#e4e6f1;--border:#d4d4d4;
  --fg:#333;--fg-dim:#717171;--strong:#000;--hover:#e8e8e8;
  --accent:#005fb8;--focus:#1f5fd0;
  --brand:#1f5fd0;--grad:linear-gradient(135deg,#1f5fd0,#2563eb);
  --ok:#2e7d32;--warn:#8a6d00;--danger:#c72e2e;--code:#f6f8fa;
  --sel-soft:color-mix(in srgb,var(--brand) 14%,transparent);
  --ring:0 0 0 2px color-mix(in srgb,var(--focus) 30%,transparent);
  --shadow:0 12px 30px rgba(0,0,0,.16);
}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:var(--fs,15px)/1.6 system-ui,-apple-system,"Segoe UI",Ubuntu,"Noto Sans",sans-serif;-webkit-font-smoothing:antialiased}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
button,textarea,input{font:inherit;color:inherit}
button{cursor:pointer;border:1px solid transparent;background:var(--bg-4);border-radius:6px;padding:8px 14px}
button:active{background:var(--hover)}
button:disabled{opacity:.45}
button.primary{background:var(--accent);color:var(--accent-fg);border:0;font-weight:500}
button.danger{background:transparent;color:var(--danger);border-color:var(--danger)}
a.btn-link{display:block;text-align:center;text-decoration:none;color:var(--accent-fg);background:var(--accent);border-radius:6px;padding:8px 14px;font-weight:500}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.hide{display:none!important}
.logo{width:28px;height:28px;flex:none;display:block;object-fit:contain}

/* Header */
header{display:flex;align-items:center;gap:4px;padding:6px;padding-top:max(6px,env(safe-area-inset-top));background:var(--bg-2);border-bottom:1px solid var(--border)}
.icon{width:40px;height:40px;padding:0;border-radius:8px;display:grid;place-items:center;background:transparent;color:var(--fg-dim)}
#title{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:2px 6px;background:transparent;line-height:1.3}
#title b{font-size:14px;font-weight:600;color:var(--strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
#title small{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--fg-dim)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--fg-dim)}
.dot.on{background:var(--ok)}

/* Project tabs: one per window (folder) open on the computer */
#tabs{display:flex;gap:6px;overflow-x:auto;padding:6px 8px;background:var(--bg-2);border-bottom:1px solid var(--border);scrollbar-width:none;flex:none}
#tabs::-webkit-scrollbar{display:none}
.tab{flex:none;display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--bg-3);font-size:13px;max-width:62vw;color:var(--fg)}
.tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab svg{width:14px;height:14px;color:var(--fg-dim)}
.tab.cur{background:var(--sel-soft);color:var(--strong);box-shadow:inset 0 0 0 1px var(--brand)}
.tab.cur svg{color:var(--brand)}
.tab.add{background:transparent;border:1px dashed var(--border);color:var(--fg-dim)}

/* Sheet: repositories to open */
#sheet,#msheet{position:fixed;inset:0;z-index:12;background:var(--bg);display:flex;flex-direction:column;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
.shead{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 16px;background:var(--bg-2);border-bottom:1px solid var(--border)}
.shead b{flex:1;color:var(--strong);font-size:15px}
#repos{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.hint{margin:0;color:var(--fg-dim);font-size:12.5px;line-height:1.45}
.repo{border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--bg-2)}
.repo.open{border-color:var(--brand)}
.rtop{display:flex;align-items:center;gap:8px}
.rtop svg{color:var(--brand)}
.rtop b{flex:1;min-width:0;color:var(--strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rmeta{font-size:12px;color:var(--fg-dim);margin-top:4px}
.rpath{font:11px ui-monospace,monospace;color:var(--fg-dim);overflow-wrap:anywhere;margin-top:2px}
.ractions{display:flex;gap:8px;margin-top:10px}
.ractions button{flex:1;padding:9px 6px;font-size:13.5px}
.rout{white-space:pre-wrap;font:11.5px/1.45 ui-monospace,monospace;color:var(--fg-dim);background:var(--code);border:1px solid var(--border);border-radius:6px;padding:6px 8px;margin-top:8px;max-height:140px;overflow:auto}
.rout.bad{color:var(--danger)}

/* Drawer: chat list */
#scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s;z-index:10}
#drawer{position:fixed;top:0;bottom:0;left:0;width:min(84vw,320px);background:var(--bg-2);border-right:1px solid var(--border);z-index:11;transform:translateX(-102%);transition:transform .22s ease;display:flex;flex-direction:column;box-shadow:var(--shadow);padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
body.open #scrim{opacity:1;pointer-events:auto}
body.open #drawer{transform:none}
.dhead{display:flex;align-items:center;gap:10px;padding:16px 16px 12px}
.dhead b{font-size:15px;color:var(--strong)}
.newbtn{margin:0 8px;display:flex;align-items:center;gap:12px;padding:10px 12px;background:transparent;border-radius:8px;text-align:left;color:var(--fg);font-size:14px}
.newbtn svg{color:var(--fg-dim)}
.newbtn:active{background:var(--hover)}
.newbtn.primary{margin:0 12px 10px;justify-content:center;background:var(--grad);color:#fff;font-weight:600;padding:11px}
.newbtn.primary svg{color:#fff}
.dtitle{margin-top:8px;border-top:1px solid var(--border);padding:14px 16px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-dim)}
#list{flex:1;overflow-y:auto;padding:0 8px 12px}
.item{width:100%;display:flex;align-items:center;gap:8px;padding:10px;border-radius:6px;text-align:left;background:transparent;color:var(--fg)}
.item span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item.cur{background:var(--sel-soft);color:var(--strong)}
.badge{flex:none!important;font-size:11px;padding:1px 8px;border-radius:999px;background:var(--bg-4);color:var(--fg-dim)}
.badge.wait{background:color-mix(in srgb,var(--warn) 20%,transparent);color:var(--warn)}

/* Messages (like .turn in the desktop chat) */
#log{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:14px 14px 8px;display:flex;flex-direction:column;gap:20px;user-select:text}
.turn{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}
.user{align-self:flex-end;max-width:88%;padding:9px 13px;border-radius:14px 14px 4px 14px;background:var(--bg-3);border:1px solid var(--border);color:var(--strong);line-height:1.5}
.assistant{align-self:stretch}
.model{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--strong);margin-bottom:6px;white-space:nowrap}
.model .logo{width:20px;height:20px}
pre{white-space:pre;overflow-x:auto;background:var(--code);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin:8px 0;font:12.5px/1.5 ui-monospace,"JetBrains Mono",Menlo,monospace}
code{font:12.5px ui-monospace,"JetBrains Mono",Menlo,monospace;background:var(--bg-4);padding:0 4px;border-radius:3px}
.err{color:var(--danger);font-size:13px;margin-top:6px}
.tool{margin:8px 0 0;border:1px solid var(--border);border-left:3px solid var(--focus);border-radius:4px;background:var(--bg);overflow:hidden;white-space:normal}
.tool.ok{border-left-color:var(--ok)}
.tool.error{border-left-color:var(--danger)}
.tool.approval{border-left-color:var(--warn);box-shadow:0 0 0 1px var(--warn)}
.thead{display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12.5px}
.ticon{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--sel-soft);color:var(--brand);flex:none}
.ticon svg{width:13px;height:13px}
.tname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace}
.tstat{display:grid;place-items:center;color:var(--fg-dim)}
.tstat svg{width:15px;height:15px}
.tool.ok .tstat{color:var(--ok)}
.tool.error .tstat{color:var(--danger)}
.tool.approval .tstat{color:var(--warn)}
.tool.running .tstat svg{animation:spin 1.6s linear infinite}
.tool.approval .tname{white-space:normal;overflow-wrap:anywhere}
.tactions{display:flex;gap:8px;padding:8px;border-top:1px solid var(--border)}
.tactions button{flex:1;padding:10px}
.typing{align-self:flex-start;display:inline-flex;gap:4px;padding:4px 2px}
.typing i{width:6px;height:6px;border-radius:50%;background:var(--brand);animation:dot 1.1s infinite ease-in-out}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
.empty{margin:auto;text-align:center;color:var(--fg-dim);padding:24px;display:flex;flex-direction:column;align-items:center;gap:10px;white-space:normal}
.empty .logo{width:72px;height:72px;filter:drop-shadow(0 0 18px color-mix(in srgb,#2f6bff 45%,transparent))}
.empty b{color:var(--strong);font-size:17px}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes dot{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:none}}

/* Composer (like .chat-input) */
footer{padding:0 10px;padding-bottom:max(10px,env(safe-area-inset-bottom));background:var(--bg)}
.composer{padding:8px 8px 6px;border-radius:10px;background:var(--bg);border:1px solid var(--border);transition:border-color .13s,box-shadow .13s}
.composer:focus-within{border-color:var(--focus);box-shadow:var(--ring)}
textarea{display:block;width:100%;resize:none;max-height:35vh;min-height:24px;border:0;outline:0;background:none;padding:2px 4px;line-height:1.45}
.bar{display:flex;align-items:center;gap:4px;margin-top:6px;min-width:0}
.bar .pill{flex:none}
.bar #model{flex:0 1 auto;min-width:0}
.pill{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:transparent;color:var(--fg-dim);font-size:12.5px}
.pill.on{background:var(--bg-4);color:var(--strong)}
.pill.on svg{color:var(--brand)}
.pill svg{width:15px;height:15px}
.send{margin-left:auto;width:40px;height:34px;padding:0;display:grid;place-items:center;border-radius:8px;flex:none;background:var(--grad)}
.send:disabled{background:var(--bg-4);color:var(--fg-dim);opacity:1}
.send svg{width:18px;height:18px}
.stopb{margin-left:auto;width:40px;height:34px;padding:0;display:grid;place-items:center;border-radius:8px;flex:none}
.stopb svg{width:14px;height:14px}

/* Mode and model pills, queue */
.pill .pl{max-width:34vw;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill.on.m-plan svg{color:var(--focus)}
.pill.on.m-auto svg,.pill.on.m-full svg,.pill.m-full{color:var(--warn)}
#queue{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fg-dim);padding:0 4px 6px}
#queue button{padding:2px 10px;font-size:12px;background:transparent;border-color:var(--border)}

/* Generic sheet body (modes, models) */
.sbody{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.opt{display:flex;align-items:flex-start;gap:12px;text-align:left;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);width:100%}
.opt.cur{border-color:var(--brand);background:var(--sel-soft)}
.opt b{display:block;color:var(--strong);font-size:14.5px}
.opt small{display:block;color:var(--fg-dim);font-size:12.5px;line-height:1.4;margin-top:2px}
.opt svg{margin-top:2px;color:var(--brand)}
.opt.warn svg{color:var(--warn)}
.search{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);outline:0;flex:none}
.search:focus{border-color:var(--focus);box-shadow:var(--ring)}
.chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;padding:5px 12px;border-radius:999px;font-size:12.5px;background:var(--bg-3);border:1px solid transparent}
.chip.on{background:var(--sel-soft);border-color:var(--brand);color:var(--strong)}
.prov{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-dim)}
.prov .badge{text-transform:none;letter-spacing:0}
.mcard{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--bg-2)}
.mcard.cur{border-color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand)}
.mtop{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.mtop b{color:var(--strong);font-size:14px;overflow-wrap:anywhere}
.mref{font:11px ui-monospace,monospace;color:var(--fg-dim);overflow-wrap:anywhere;margin-top:2px}
.mmeta{font-size:12px;color:var(--fg-dim);margin-top:4px}
.tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.tag{font-size:10.5px;padding:1px 7px;border-radius:999px;background:var(--bg-4);color:var(--fg-dim)}
.tag.good{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}
.tag.brand{background:var(--sel-soft);color:var(--brand)}
.mact{display:flex;gap:8px;margin-top:8px}
.mact button{flex:1;padding:8px 6px;font-size:13px}
.more{align-self:center;background:transparent;border-color:var(--border)}

/* Drawer extras */
.item .x{flex:none;width:28px;height:28px;padding:0;display:grid;place-items:center;background:transparent;color:var(--fg-dim);border-radius:6px}
.item .x svg{width:14px;height:14px}
.dfoot{border-top:1px solid var(--border);padding:10px 16px;font-size:12.5px;color:var(--fg-dim);display:flex;justify-content:space-between}
.dfoot b{color:var(--strong)}

/* Message actions and quick ideas */
.tacts{display:flex;gap:6px;margin-top:6px}
.tacts button{padding:3px 10px;font-size:12px;background:transparent;border-color:var(--border);color:var(--fg-dim)}
.quick{display:flex;flex-direction:column;gap:8px;width:100%;max-width:420px;margin-top:8px}
.quick button{text-align:left;background:var(--bg-2);border-color:var(--border);font-size:13.5px}

/* Extras: offline banner, approvals bar, to-bottom, search, settings, prompts */
#offline{background:color-mix(in srgb,var(--warn) 18%,var(--bg-2));color:var(--warn);font-size:12.5px;padding:6px 12px;text-align:center;border-bottom:1px solid var(--border)}
#pending{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;margin:0 0 8px;border:1px solid var(--warn);border-radius:10px;background:color-mix(in srgb,var(--warn) 10%,var(--bg));font-size:13px}
#pending span{flex:1;min-width:140px;color:var(--strong)}
#pending button{padding:6px 12px;font-size:13px}
footer{position:relative}
#tobottom{position:absolute;right:16px;top:-50px;width:40px;height:40px;padding:0;border-radius:50%;display:grid;place-items:center;background:var(--bg-3);border:1px solid var(--border);box-shadow:var(--shadow);color:var(--fg)}
.csearch{margin:0 12px 8px;width:calc(100% - 24px);padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);outline:0}
.csearch:focus{border-color:var(--focus)}
.row{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-2)}
.row label{flex:1;font-size:14px}
.row input[type=checkbox]{width:22px;height:22px;flex:none;accent-color:var(--brand)}
.row input[type=text]{flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);outline:0}
.seg{display:flex;gap:6px}
.seg button{flex:1}
.seg button.on{background:var(--sel-soft);box-shadow:inset 0 0 0 1px var(--brand);color:var(--strong)}
.stitle{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-dim);margin-top:6px}
.prompt{display:flex;gap:8px;align-items:stretch}
.prompt button.ptext{flex:1;text-align:left;background:var(--bg-2);border-color:var(--border);font-size:13.5px;white-space:normal}
.prompt button.pdel{background:transparent;border-color:var(--border);color:var(--fg-dim);padding:0 10px}
.pill.rec{background:color-mix(in srgb,var(--danger) 20%,transparent);color:var(--danger)}
.pill.rec svg{color:var(--danger)}
.ubox{display:flex;flex-direction:column;align-items:flex-end;align-self:flex-end;max-width:88%}
.ubox .user{max-width:100%}
.ubox .tacts{justify-content:flex-end}
h4{margin:10px 0 4px;color:var(--strong);font-size:1.02em}
.li{display:block;padding-left:1.1em;text-indent:-1.1em}

/* Pairing */
#pair{margin:auto;padding:28px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;width:min(380px,100%);text-align:center}
#pair .logo{width:96px;height:96px;margin-bottom:4px;filter:drop-shadow(0 0 24px color-mix(in srgb,#2f6bff 50%,transparent))}
#pair .brand{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;margin-top:-4px}
#pair h1{margin:0;font-size:20px;color:var(--strong)}
#pair p{margin:0;color:var(--fg-dim);font-size:14px}
#pin{width:100%;font-size:28px;letter-spacing:12px;text-indent:12px;text-align:center;font-weight:600;background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:12px;outline:0;margin-top:8px}
#pin:focus{border-color:var(--focus);box-shadow:var(--ring)}
#go{width:100%;padding:12px;font-size:15px;background:var(--grad);font-weight:600}
${TOOLS_CSS}
${CONFIG_CSS}
</style>
</head>
<body>
<header id="head" class="hide">
  <button class="icon" id="menu" aria-label="${h('chats')}"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  <button id="title"><b id="tname">Zinarix</b><small><span class="dot" id="dot"></span><span id="state">${h('connecting')}</span></small></button>
  <button class="icon" id="termb" aria-label="${h('terminal')}"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg></button>
  <button class="icon" id="gear" aria-label="${h('settings')}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg></button>
  <button class="icon" id="new" aria-label="${h('newChat')}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
</header>
<div id="offline" class="hide">${h('reconnecting')}</div>
<div id="tabs" class="hide" role="tablist" aria-label="${h('projects')}"></div>
<div id="scrim"></div>
<nav id="drawer" aria-label="${h('chats')}">
  <div class="dhead"><img class="logo" src="/logo.svg" alt=""><b>Zinarix Studio</b></div>
  <button class="newbtn primary" id="new2"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>${h('newChat')}</button>
  <button class="newbtn" id="open2"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>${h('openFolder')}</button>
  <div class="dtools">
    <button id="files2"><svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/></svg>${h('files')}</button>
    <button id="term2"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>${h('terminal')}</button>
    <button id="git2"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5"/></svg>${h('gitTitle')}</button>
  </div>
  <button class="newbtn" id="config2"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>${h('appConfig')}</button>
  <button class="newbtn" id="models2"><svg viewBox="0 0 24 24"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8Z"/></svg>${h('models')}</button>
  <div class="dtitle">${h('chats')}</div>
  <input id="csearch" class="csearch" type="search" placeholder="${h('searchChats')}" aria-label="${h('searchChats')}">
  <div id="list"></div>
  <div class="dfoot"><span>${h('today')}</span><b id="usd">$0.00</b></div>
</nav>
<div id="pair">
  <img class="logo" src="/logo.svg" alt="">
  <span class="brand">Zinarix Studio</span>
  <h1>${h('pairTitle')}</h1>
  <p>${h('pairHint')}<br><small>${h('pairWhere')}</small></p>
  <input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" aria-label="${h('pin')}">
  <button id="go" class="primary">${h('connect')}</button>
  <p id="pwait" class="hide">${h('pairWait')}</p>
  <div class="err" id="perr"></div>
</div>
<div id="sheet" class="hide" role="dialog" aria-label="${h('openFolder')}">
  <div class="shead"><b>${h('openFolder')}</b><button class="icon" id="sclose" aria-label="${h('close')}"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
  <div id="repos"></div>
</div>
<div id="msheet" class="hide" role="dialog">
  <div class="shead"><b id="mtitle"></b><button class="icon" id="mclose" aria-label="${h('close')}"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
  <div id="mbody" class="sbody"></div>
</div>
<div id="log" class="hide"></div>
<footer id="foot" class="hide">
  <button id="tobottom" class="hide" aria-label="${h('toBottom')}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg></button>
  <div id="pending" class="hide"><span id="pn"></span><button class="primary" id="pyes">${h('approveAll')}</button><button class="danger" id="pno">${h('denyAll')}</button></div>
  <div id="queue" class="hide"><span id="qn"></span><button id="qclear">${h('clearQueue')}</button></div>
  <div class="composer">
    <textarea id="text" rows="1" placeholder="${h('ask')}" aria-label="${h('message')}"></textarea>
    <div class="bar">
      <button class="pill" id="mode" aria-label="${h('mode')}"><svg viewBox="0 0 24 24"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg><span class="pl" id="mlabel">${h('agent')}</span></button>
      <button class="pill on" id="model" aria-label="${h('model')}"><svg viewBox="0 0 24 24"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8Z"/></svg><span class="pl" id="mname">${h('model')}</span></button>
      <button class="pill" id="bolt" aria-label="${h('prompts')}"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7Z"/></svg></button>
      <button class="pill hide" id="mic" aria-label="${h('voice')}"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
      <button class="danger stopb hide" id="stop" aria-label="${h('stop')}" title="${h('stop')}"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg></button>
      <button class="primary send" id="send" aria-label="${h('send')}" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
    </div>
  </div>
</footer>
<script nonce="${nonce}">
const L = ${json};
const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('zx.token') || '';
/*
 * Came through the permanent link (the Zinarix website reads the computer's current address
 * from a gist): #g=<gist>&k=<key>&t=<token>. That page keeps the token, because each new
 * address of the free tunnel is a new site for the phone, with its storage empty.
 */
const RELAY = ${JSON.stringify(RELAY_PAGE)};
const APP_APK = ${JSON.stringify(opts.localApk ?? APP_APK)};
const HASH = new URLSearchParams(location.hash.slice(1));
const KEY = /^[0-9a-f]{32,}$/.test(HASH.get('k') || '') ? HASH.get('k') : '';
const RELAY_G = /^[0-9a-f]{20,40}$/.test(HASH.get('g') || '') ? HASH.get('g') : localStorage.getItem('zx.relay') || '';
if (RELAY_G) localStorage.setItem('zx.relay', RELAY_G);
if (!token && /^[0-9a-f]{64}$/.test(HASH.get('t') || '')) { token = HASH.get('t'); localStorage.setItem('zx.token', token); }
// The token leaves the address bar (and the history) right away.
if (HASH.has('t') || HASH.has('g')) history.replaceState(null, '', location.pathname + (KEY ? '#k=' + KEY : ''));
function toRelay(extra) {
  location.replace(RELAY + '#g=' + RELAY_G + (KEY ? '&k=' + KEY : '') + (extra || ''));
}
/** The Android app (Zinarix Remote) adds notifications, dictation and more; null in a browser. */
const NATIVE = window.ZinarixNative || null;
let snap = null, es = null, stick = true, online = false;
const PANELS = ['head', 'tabs', 'log', 'foot'];
const ICONS = {
${TOOLS_ICONS}
${CONFIG_ICONS}
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  running: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  ok: '<path d="M20 6 9 17l-5-5"/>',
  error: '<path d="M18 6 6 18M6 6l12 12"/>',
  approval: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.3-.6-.6-2.3Z"/>',
  ask: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  plan: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  agent: '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  auto: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  full: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/><path d="M12 8v4M12 16h.01"/>',
  star: '<path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const MODES = [
  ['ask', L.modeAsk, L.modeAskHint],
  ['plan', L.modePlan, L.modePlanHint],
  ['agent', L.modeAgent, L.modeAgentHint],
  ['auto', L.modeAuto, L.modeAutoHint],
  ['full', L.modeFull, L.modeFullHint],
];
/** The models of the computer (fetched when the picker opens; kept for names). */
let models = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
/** The Zinarix logo (served by the computer). */
function logo() {
  const i = el('img', 'logo');
  i.src = '/logo.svg';
  i.alt = '';
  return i;
}
/** A fixed icon from ICONS (never text from the computer). */
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = ICONS[name] || ''; // zinarix-ignore: constant SVG
  return s;
}
/** Text with \`\`\`code blocks\`\`\` and \`inline code\`, built with textContent only. */
function rich(text) {
  const f = document.createDocumentFragment();
  text.split(/\`\`\`[^\\n]*\\n?/).forEach((part, i) => {
    if (i % 2) return void f.append(el('pre', '', part.replace(/\\n$/, '')));
    const lines = part.split('\\n');
    lines.forEach((line, k) => {
      const hd = /^#{1,4}\\s+(.*)$/.exec(line);
      if (hd) return void f.append(el('h4', '', hd[1].replace(/\\*\\*/g, '')));
      const li = /^\\s*[-*]\\s+(.*)$/.exec(line);
      const box = li ? el('span', 'li') : f;
      if (li) box.append('\\u2022 ');
      inline(li ? li[1] : line, box);
      if (li) f.append(box);
      else if (k < lines.length - 1) f.append('\\n');
    });
  });
  return f;
}
/** **bold** and \`code\` inside a line (textContent only). */
function inline(text, into) {
  text.split(/(\`[^\`]+\`|\\*\\*[^*]+\\*\\*)/).forEach((p, j) => {
    if (!(j % 2)) return void into.append(p);
    into.append(p[0] === '*' ? el('b', '', p.slice(2, -2)) : el('code', '', p.slice(1, -1)));
  });
}
async function post(path, data) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(data),
  });
  if (r.status === 401) unpair();
  return r;
}
const act = (a) => post('/api/action', a);

let offTimer = 0, relayTimer = 0;
function setOnline(on) {
  online = on;
  $('dot').classList.toggle('on', on);
  clearTimeout(offTimer);
  // A short hiccup does not flash the banner; a real cut (Zinarix closed, Wi-Fi) does.
  if (on || !token) $('offline').classList.add('hide');
  else offTimer = setTimeout(() => { if (!online && token) $('offline').classList.remove('hide'); }, 2500);
  // A long cut with the permanent link: the computer may be at a new address; ask the website.
  clearTimeout(relayTimer);
  if (!on && token && RELAY_G) relayTimer = setTimeout(() => { if (!online) toRelay(); }, 15000);
  status();
}
function status() {
  const s = !online ? L.offline : snap && snap.busy ? L.working : L.online;
  const f = online ? curFolder() : '';
  $('state').textContent = f ? f + ' \\u00b7 ' + s : s;
}
function drawer(open) { document.body.classList.toggle('open', open); }

function unpair() {
  token = '';
  nativeStatus(false, 0);
  localStorage.removeItem('zx.token');
  if (es) es.close();
  es = null;
  for (const id of PANELS) $(id).classList.add('hide');
  closeSheet();
  fdirty = false;
  closeM();
  $('pair').classList.remove('hide');
  drawer(false);
  setOnline(false);
  $('offline').classList.add('hide');
}
/** The app lists the saved computers by their name. */
function nativeComputer(d) {
  if (!NATIVE || typeof NATIVE.computer !== 'function' || !d || !d.computer) return;
  try { NATIVE.computer(String(d.computer).slice(0, 60)); } catch {}
}
function paired() {
  $('pair').classList.add('hide');
  for (const id of PANELS) $(id).classList.remove('hide');
  connect();
  loadCaps();
  if (NATIVE) fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => (r.ok ? r.json() : null)).then(nativeComputer).catch(() => undefined);
  // Model names for the header and the messages (the picker fetches them again when opened).
  fetch('/api/models', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d && !models) { models = d; if (snap) render(); } })
    .catch(() => undefined);
}
// Through the internet (the https tunnel) live events are held back on the way: long polling.
let polling = 0;
async function poll(gen) {
  let v = -1;
  while (gen === polling && token) {
    try {
      const r = await fetch('/api/poll?v=' + v, { headers: { Authorization: 'Bearer ' + token } });
      if (gen !== polling) return;
      if (r.status === 401) return unpair();
      if (!r.ok) throw new Error();
      setOnline(true);
      if (r.status === 200) { const d = await r.json(); v = d.v; snap = d.snapshot; render(); }
    } catch {
      setOnline(false);
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
}
function connect() {
  if (location.protocol === 'https:') return void poll(++polling);
  if (es) es.close();
  es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.onopen = () => setOnline(true);
  es.onmessage = (m) => { snap = JSON.parse(m.data); render(); };
  es.onerror = () => {
    setOnline(false);
    // A 401 closes the stream for good: check whether the pairing is still valid.
    if (es.readyState === 2)
      fetch('/api/events?token=' + encodeURIComponent(token)).then((r) => {
        if (r.body) r.body.cancel();
        if (r.status === 401) unpair(); else setTimeout(connect, 2000);
      }).catch(() => setTimeout(connect, 3000));
  };
}

/** One tab per window open on the computer (each with its folder), plus "open folder". */
let curWin = null;
function renderTabs() {
  const tabs = $('tabs');
  tabs.textContent = '';
  let cur = null;
  for (const w of snap.windows || []) {
    const b = el('button', 'tab' + (w.current ? ' cur' : ''));
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(!!w.current));
    b.append(icon('folder'), el('span', '', w.name || L.noFolder));
    if (w.path) b.title = w.path;
    b.onclick = () => { if (!w.current) act({ kind: 'window', id: w.id }); };
    if (w.current) cur = b;
    tabs.append(b);
  }
  const add = el('button', 'tab add');
  add.append(icon('plus'), el('span', '', L.openFolder));
  add.onclick = openSheet;
  tabs.append(add);
  const id = cur ? cur.title + '|' + cur.textContent : null;
  if (cur && id !== curWin) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  curWin = id;
}
function curFolder() {
  const w = (snap && snap.windows || []).find((x) => x.current);
  return w ? w.name || L.noFolder : '';
}

/** The repositories of the computer: open one in a new window, here, or pull it. */
function closeSheet() { $('sheet').classList.add('hide'); }
async function openSheet() {
  drawer(false);
  $('sheet').classList.remove('hide');
  const box = $('repos');
  box.textContent = '';
  box.append(el('p', 'hint', L.loading));
  try {
    const r = await fetch('/api/repos', { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) return unpair();
    if (!r.ok) throw new Error();
    const repos = (await r.json()).repos || [];
    box.textContent = '';
    box.append(el('p', 'hint', repos.length ? L.reposHint : L.noRepos));
    for (const repo of repos) box.append(repoCard(repo));
  } catch {
    box.textContent = '';
    box.append(el('p', 'err', L.noComputer));
  }
}
function repoCard(repo) {
  const open = (snap && snap.windows || []).some((w) => w.path === repo.path);
  const c = el('div', 'repo' + (open ? ' open' : ''));
  const top = el('div', 'rtop');
  top.append(icon('folder'), el('b', '', repo.name));
  if (open) top.append(el('span', 'badge', L.isOpen));
  const meta = [
    repo.branch,
    repo.changes ? repo.changes + ' ' + L.changes : '',
    repo.ahead ? '\\u2191' + repo.ahead : '',
    repo.behind ? '\\u2193' + repo.behind : '',
  ].filter(Boolean).join(' \\u00b7 ');
  c.append(top);
  if (meta) c.append(el('div', 'rmeta', meta));
  c.append(el('div', 'rpath', repo.path));
  if (repo.error) c.append(el('div', 'err', repo.error));
  const row = el('div', 'ractions');
  const btnNew = el('button', 'primary', L.openNew);
  const btnHere = el('button', '', L.openHere);
  const btnPull = el('button', '', L.pull);
  const out = el('div', 'rout hide');
  const all = [btnNew, btnHere, btnPull];
  const show = (text, bad) => { out.textContent = text; out.className = 'rout' + (bad ? ' bad' : ''); };
  async function run(path, data) {
    for (const b of all) b.disabled = true;
    try {
      const r = await post(path, data);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || L.noComputer);
      return d;
    } finally { for (const b of all) b.disabled = false; }
  }
  btnNew.onclick = () => run('/api/repos/open', { path: repo.path, newWindow: true })
    .then(closeSheet, (e) => show(e.message, true));
  btnHere.onclick = () => run('/api/repos/open', { path: repo.path })
    .then(closeSheet, (e) => show(e.message, true));
  btnPull.onclick = () => run('/api/repos/pull', { path: repo.path })
    .then((d) => show((d.output || '').trim() || L.pulled, false), (e) => show(e.message, true));
  row.append(btnNew, btnHere, btnPull);
  c.append(row, out);
  return c;
}

function renderList() {
  const list = $('list');
  list.textContent = '';
  const q = $('csearch').value.trim().toLowerCase();
  for (const c of snap.chats) {
    if (q && !(c.title || L.newChat).toLowerCase().includes(q)) continue;
    const b = el('button', 'item' + (c.id === snap.chatId ? ' cur' : ''));
    b.append(el('span', '', c.title || L.newChat));
    if (c.waiting) b.append(el('span', 'badge wait', L.approve));
    else if (c.busy) b.append(el('span', 'badge', L.workingBadge));
    const x = el('span', 'x');
    x.setAttribute('role', 'button');
    x.setAttribute('aria-label', L.closeChat);
    x.append(icon('x'));
    x.onclick = (e) => {
      e.stopPropagation();
      if (confirm(L.closeConfirm)) act({ kind: 'closeChat', chatId: c.id });
    };
    b.append(x);
    b.onclick = () => { drawer(false); if (c.id !== snap.chatId) act({ kind: 'select', chatId: c.id }); };
    list.append(b);
  }
}

/** A full-screen sheet with a title (modes, models). */
function openM(title) {
  drawer(false);
  $('mtitle').textContent = title;
  $('mbody').textContent = '';
  $('msheet').classList.remove('hide');
  $('msheet').classList.remove('term');
  tgen++;
  return $('mbody');
}
function closeM() {
  if (mview === 'file' && fdirty && !confirm(L.unsaved)) return;
  fdirty = false;
  $('msheet').classList.add('hide');
  $('msheet').classList.remove('term');
  tgen++;
  mview = null;
}
let mview = null;

function curMode() { return (snap && snap.mode) || (snap && snap.agent === false ? 'ask' : 'agent'); }
function modeName(m) { const x = MODES.find((y) => y[0] === m); return x ? x[1] : m; }
function openModes() {
  mview = 'modes';
  const box = openM(L.mode);
  const cur = curMode();
  for (const [m, name, hint] of MODES) {
    const b = el('button', 'opt' + (m === cur ? ' cur' : '') + (m === 'auto' || m === 'full' ? ' warn' : ''));
    const txt = el('span');
    txt.append(el('b', '', name), el('small', '', hint));
    b.append(icon(m), txt);
    b.onclick = () => {
      if (m === 'full' && cur !== 'full' && !confirm(L.fullConfirm)) return;
      act({ kind: 'mode', mode: m });
      closeM();
    };
    box.append(b);
  }
}

/** "provider/model" in short words: the label when known, else the part after the provider. */
function shortModel(ref) {
  if (!ref) return L.model;
  const m = models && models.models.find((x) => x.ref === ref);
  if (m && m.label) return m.label;
  const i = ref.indexOf('/');
  return i > 0 ? ref.slice(i + 1) : ref;
}
function price(n) {
  if (n == null) return '?';
  if (n === 0) return '$0';
  return '$' + (n < 0.1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : n.toFixed(0));
}
function ctxText(n) {
  if (!n) return '';
  return (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : Math.round(n / 1000) + 'K') + ' ' + L.ctx;
}
const FILTERS = [
  ['all', L.fAll, () => true],
  ['local', L.fLocal, (m) => m.local],
  ['free', L.fFree, (m) => m.local || (m.inputPrice === 0 && m.outputPrice === 0)],
  ['cheap', L.fCheap, (m) => m.local || (m.inputPrice != null && m.inputPrice <= 1)],
  ['tools', L.fTools, (m) => m.tools],
  ['vision', L.fVision, (m) => m.vision],
  ['reason', L.fReason, (m) => m.reasoning],
];
let mfilter = 'all', mquery = '', mlimit = 80;
async function openModels() {
  mview = 'models';
  const box = openM(L.models);
  box.append(el('p', 'hint', L.loading));
  try {
    const r = await fetch('/api/models', { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) return unpair();
    if (!r.ok) throw new Error();
    models = await r.json();
  } catch {
    if (mview !== 'models') return;
    box.textContent = '';
    box.append(el('p', 'err', L.noComputer));
    return;
  }
  if (mview !== 'models') return;
  box.textContent = '';
  const q = el('input', 'search');
  q.type = 'search';
  q.placeholder = L.searchModels;
  q.value = mquery;
  const chips = el('div', 'chips');
  const list = el('div', 'sbody');
  list.style.padding = '0';
  list.style.overflow = 'visible';
  for (const [id, name] of FILTERS) {
    const c = el('button', 'chip' + (id === mfilter ? ' on' : ''), name);
    c.onclick = () => {
      mfilter = id; mlimit = 80;
      for (const x of chips.children) x.classList.toggle('on', x === c);
      fill(list);
    };
    chips.append(c);
  }
  q.oninput = () => { mquery = q.value; mlimit = 80; fill(list); };
  box.append(q, chips, list);
  fill(list);
}
function modelCard(m) {
  const own = snap && snap.model;
  const shown = snap && snap.shownModel;
  const c = el('div', 'mcard' + (m.ref === shown ? ' cur' : ''));
  const top = el('div', 'mtop');
  top.append(el('b', '', m.label || m.ref));
  if (m.ref === own) top.append(el('span', 'tag brand', L.inChat));
  if (models.defaultModel === m.ref) top.append(el('span', 'tag', L.isDefault));
  c.append(top, el('div', 'mref', m.ref));
  const meta = [
    ctxText(m.context),
    m.local ? L.free : m.inputPrice != null ? price(m.inputPrice) + ' / ' + price(m.outputPrice) + ' /M' : '',
  ].filter(Boolean).join(' \\u00b7 ');
  if (meta) c.append(el('div', 'mmeta', meta));
  const tags = el('div', 'tags');
  if (m.local) tags.append(el('span', 'tag good', L.local));
  if (m.tools) tags.append(el('span', 'tag', L.fTools));
  if (m.vision) tags.append(el('span', 'tag', L.fVision));
  if (m.reasoning) tags.append(el('span', 'tag', L.fReason));
  if (tags.children.length) c.append(tags);
  const row = el('div', 'mact');
  const here = el('button', 'primary', L.useHere);
  const all = el('button', '', L.useAll);
  here.disabled = m.ref === own;
  all.disabled = models.defaultModel === m.ref;
  here.onclick = () => { act({ kind: 'model', ref: m.ref }); closeM(); };
  all.onclick = async () => {
    here.disabled = all.disabled = true;
    try {
      const r = await post('/api/models/default', { ref: m.ref });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || L.noComputer);
      models.defaultModel = m.ref;
      closeM();
    } catch (e) {
      here.disabled = all.disabled = false;
      c.append(el('div', 'err', e.message || L.noComputer));
    }
  };
  row.append(here, all);
  c.append(row);
  return c;
}
function fill(list) {
  list.textContent = '';
  const all = models.models || [];
  // App default: the chat follows the general model.
  const own = snap && snap.model;
  const d = el('button', 'opt' + (!own ? ' cur' : ''));
  const dt = el('span');
  dt.append(el('b', '', L.modelDefault), el('small', '', (models.defaultModel ? shortModel(models.defaultModel) + ' \\u00b7 ' : '') + L.modelDefaultHint));
  d.append(icon('star'), dt);
  d.onclick = () => { act({ kind: 'model', ref: null }); closeM(); };
  list.append(d);
  if (!all.length) return void list.append(el('p', 'hint', L.noModels));
  const pass = FILTERS.find((f) => f[0] === mfilter)[2];
  const words = mquery.toLowerCase().split(/\\s+/).filter(Boolean);
  const found = all.filter((m) => pass(m) && words.every((w) => (m.ref + ' ' + (m.label || '')).toLowerCase().includes(w)));
  list.append(el('p', 'hint', found.length + ' / ' + all.length + ' ' + L.modelsCount));
  if (!found.length) return void list.append(el('p', 'hint', L.noMatch));
  // Grouped by provider; the chat's model and the local ones first.
  const shown = snap && snap.shownModel;
  found.sort((a, b) => (b.ref === shown) - (a.ref === shown) || (b.local - a.local) || a.provider.localeCompare(b.provider) || (a.label || a.ref).localeCompare(b.label || b.ref));
  let prov = null;
  for (const m of found.slice(0, mlimit)) {
    if (m.provider !== prov) {
      prov = m.provider;
      const h = el('div', 'prov', prov);
      if ((models.errors || []).some((e) => e.provider === prov)) h.append(el('span', 'badge wait', L.providerErr));
      list.append(h);
    }
    list.append(modelCard(m));
  }
  if (found.length > mlimit) {
    const more = el('button', 'more', L.more + ' (' + (found.length - mlimit) + ')');
    more.onclick = () => { mlimit += 120; fill(list); };
    list.append(more);
  }
}

/** Copies text on any page (navigator.clipboard needs https; the local address is http). */
function copyText(text, btn) {
  const done = () => { btn.textContent = L.copied; setTimeout(() => { btn.textContent = L.copy; }, 1400); };
  if (navigator.clipboard && window.isSecureContext)
    return void navigator.clipboard.writeText(text).then(done, () => undefined);
  const t = el('textarea');
  t.value = text;
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.append(t);
  t.select();
  try { document.execCommand('copy'); done(); } catch {}
  t.remove();
}
function renderTool(tool) {
  const c = el('div', 'tool ' + tool.status);
  const head = el('div', 'thead');
  const ic = el('span', 'ticon');
  ic.append(icon('tool'));
  const st = el('span', 'tstat');
  st.append(icon(tool.status));
  head.append(ic, el('span', 'tname', tool.title), st);
  c.append(head);
  if (tool.status === 'approval') {
    const row = el('div', 'tactions');
    const yes = el('button', 'primary', L.approve);
    const no = el('button', 'danger', L.deny);
    yes.onclick = () => { yes.disabled = no.disabled = true; act({ kind: 'decide', toolCallId: tool.id, decision: 'approve' }); };
    no.onclick = () => { yes.disabled = no.disabled = true; act({ kind: 'decide', toolCallId: tool.id, decision: 'deny' }); };
    row.append(yes, no);
    c.append(row);
  }
  return c;
}
function render() {
  if (!snap) return;
  renderTabs();
  renderList();
  const cur = snap.chats.find((c) => c.id === snap.chatId);
  $('tname').textContent = (cur && cur.title) || L.newChat;
  const mode = curMode();
  const mb = $('mode');
  mb.className = 'pill m-' + mode + (mode !== 'ask' ? ' on' : '');
  mb.replaceChild(icon(mode), mb.firstChild);
  $('mlabel').textContent = modeName(mode);
  $('mname').textContent = shortModel(snap.shownModel);
  $('model').title = snap.shownModel || '';
  const q = snap.queued || 0;
  $('queue').classList.toggle('hide', !q);
  $('qn').textContent = q + ' ' + L.queued;
  $('usd').textContent = '$' + (snap.todayUsd || 0).toFixed(snap.todayUsd && snap.todayUsd < 1 ? 3 : 2);
  // An open picker shows the chat's new model / mode as soon as it changes.
  if (mview === 'modes') openModes();
  status();
  $('stop').classList.toggle('hide', !snap.busy);
  $('send').classList.toggle('hide', snap.busy);
  const log = $('log');
  stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.textContent = '';
  if (!snap.turns.length) {
    const e = el('div', 'empty');
    e.append(logo(), el('b', '', L.emptyTitle), el('span', '', L.emptyHint));
    const quick = el('div', 'quick');
    for (const k of ['q1', 'q2', 'q3', 'q4', 'q5']) {
      const b = el('button', '', L[k]);
      b.onclick = () => { $('text').value = L[k]; grow(); $('text').focus(); };
      quick.append(b);
    }
    e.append(quick);
    log.append(e);
  }
  for (const t of snap.turns) {
    let m;
    if (t.role === 'user') {
      const u = el('div', 'turn user');
      u.append(t.text);
      m = el('div', 'ubox');
      m.append(u);
      const row = el('div', 'tacts');
      const ed = el('button', '', L.edit);
      ed.onclick = () => { $('text').value = t.text; grow(); saveDraft(); $('text').focus(); };
      const rs = el('button', '', L.resend);
      rs.disabled = !!snap.busy;
      rs.onclick = () => { stick = true; act({ kind: 'send', text: t.text }); };
      row.append(ed, rs);
      m.append(row);
    } else {
      m = el('div', 'turn assistant');
      const h = el('div', 'model');
      h.append(logo(), t.model ? shortModel(t.model) : 'Zinarix');
      if (t.model) h.title = t.model;
      m.append(h, rich(t.text));
      if (t.text) {
        const row = el('div', 'tacts');
        const cp = el('button', '', L.copy);
        cp.onclick = () => copyText(t.text, cp);
        row.append(cp);
        if (navigator.share) {
          const sh = el('button', '', L.share);
          sh.onclick = () => navigator.share({ text: t.text }).catch(() => undefined);
          row.append(sh);
        }
        if (t === snap.turns[snap.turns.length - 1] && !snap.busy) {
          const ct = el('button', '', L.cont);
          ct.onclick = () => { stick = true; act({ kind: 'send', text: L.contText }); };
          row.append(ct);
        }
        m.append(row);
      }
    }
    if (t.error) m.append(el('div', 'err', t.error));
    for (const tool of t.tools) m.append(renderTool(tool));
    log.append(m);
  }
  if (snap.busy) { const d = el('div', 'typing'); d.append(el('i'), el('i'), el('i')); log.append(d); }
  if (stick) log.scrollTop = log.scrollHeight;
  toBottom();
  // Every action of this chat waiting for approval: one tap for all of them.
  const waiting = pendingTools();
  $('pending').classList.toggle('hide', waiting.length < 2);
  $('pn').textContent = L.pendingN.replace('{n}', String(waiting.length));
  // The draft of each chat stays when switching chats (and after closing the page).
  if (snap.chatId !== draftChat) {
    draftChat = snap.chatId;
    $('text').value = localStorage.getItem('zx.draft.' + draftChat) || '';
    grow();
  }
  alertChanges(waiting);
  keepAwake();
}

function pendingTools() {
  const out = [];
  for (const t of snap.turns) for (const tool of t.tools) if (tool.status === 'approval') out.push(tool);
  return out;
}
function decideAll(decision) {
  for (const tool of pendingTools()) act({ kind: 'decide', toolCallId: tool.id, decision });
  $('pending').classList.add('hide');
}
let draftChat = null;
function saveDraft() {
  if (!draftChat) return;
  const v = $('text').value;
  if (v) localStorage.setItem('zx.draft.' + draftChat, v);
  else localStorage.removeItem('zx.draft.' + draftChat);
}
function toBottom() {
  const log = $('log');
  $('tobottom').classList.toggle('hide', log.scrollHeight - log.scrollTop - log.clientHeight < 160);
}

/** Settings of this phone (kept in the browser). */
const PREFS = Object.assign({ size: 'm', notify: true, wake: false, enter: false }, JSON.parse(localStorage.getItem('zx.prefs') || '{}'));
function savePrefs() { localStorage.setItem('zx.prefs', JSON.stringify(PREFS)); applyPrefs(); }
function applyPrefs() {
  document.documentElement.style.setProperty('--fs', PREFS.size === 's' ? '13.5px' : PREFS.size === 'l' ? '17.5px' : '15px');
}
applyPrefs();

/** Vibration, a notification and the tab title when the AI ends or asks while you look away. */
let lastBusy = null, lastAsk = '', lastOther = false;
function alertChanges(waiting) {
  const ask = waiting.map((t) => t.id).join(',');
  const other = snap.chats.some((c) => c.waiting && c.id !== snap.chatId);
  const n = waiting.length + snap.chats.filter((c) => c.waiting && c.id !== snap.chatId).length;
  document.title = (n ? '(' + n + ') ' : '') + 'Zinarix Studio';
  nativeStatus(snap.chats.some((c) => c.busy) || !!snap.busy, n);
  if (lastBusy !== null && PREFS.notify) {
    if ((ask && ask !== lastAsk) || (other && !lastOther)) ping(ask ? L.approvalNotify : L.otherWaiting);
    else if (lastBusy && !snap.busy) ping(L.doneNotify);
  }
  lastBusy = snap.busy; lastAsk = ask; lastOther = other;
}
function ping(text) {
  if (NATIVE) {
    // The app knows whether it is on screen: it vibrates, or posts a system notification.
    try { NATIVE.vibrate(document.hidden ? 300 : 60); NATIVE.notify(text); } catch {}
    return;
  }
  if (!document.hidden) { if (navigator.vibrate) navigator.vibrate(60); return; }
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  try {
    if (window.Notification && Notification.permission === 'granted') new Notification('Zinarix Studio', { body: text, tag: 'zinarix' });
  } catch {}
}

/**
 * The app keeps a fixed notification ("the AI is working", with Stop) while the AI works or
 * waits: it keeps the app awake in the background, so the alerts arrive.
 */
let lastNative = '';
function nativeStatus(busy, waiting) {
  if (!NATIVE || typeof NATIVE.status !== 'function') return;
  const k = (busy ? 1 : 0) + ':' + waiting;
  if (k === lastNative) return;
  lastNative = k;
  try { NATIVE.status(busy, waiting, curFolder() || ''); } catch {}
}
/** What the app asks of the panel: Stop from the notification, shared text, its shortcuts. */
window.__zxStop = () => { if (token) act({ kind: 'stop' }); return !!token; };
window.__zxNewChat = () => { if (token) act({ kind: 'newChat' }); return !!token; };
window.__zxCompose = (text) => {
  if (!token) return false;
  const t = $('text');
  t.value = t.value.trim() ? t.value.replace(/\\s*$/, '') + '\\n\\n' + text : text;
  grow();
  saveDraft();
  t.focus();
  return true;
};
window.__zxDictate = () => { if (!token || !Speech) return !!token; if (!rec) dictate(); return true; };

/** The screen stays on while the AI works (only where the browser allows it: https). */
let lock = null;
function keepAwake() {
  if (NATIVE) { try { NATIVE.keepAwake(!!(PREFS.wake && snap && snap.busy)); } catch {} return; }
  const want = PREFS.wake && snap && snap.busy && !document.hidden && navigator.wakeLock;
  if (want && !lock) {
    lock = 'pending';
    navigator.wakeLock.request('screen').then((l) => { lock = l; l.addEventListener('release', () => { lock = null; }); }, () => { lock = null; });
  } else if (!want && lock && lock !== 'pending') { lock.release().catch(() => undefined); lock = null; }
}
document.addEventListener('visibilitychange', () => { if (snap) keepAwake(); });

/** "Install as an app" (Chrome / Edge on Android offer it; else the browser menu). */
let installEv = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEv = e; });

function check(label, key, onChange) {
  const r = el('div', 'row');
  const c = el('input');
  c.type = 'checkbox';
  c.id = 'p-' + key;
  c.checked = !!PREFS[key];
  const l = el('label', '', label);
  l.htmlFor = c.id;
  c.onchange = () => { PREFS[key] = c.checked; savePrefs(); if (onChange) onChange(c.checked); };
  r.append(c, l);
  return r;
}
async function openSettings() {
  mview = 'settings';
  const box = openM(L.settings);
  box.append(el('div', 'stitle', L.textSize));
  const seg = el('div', 'seg');
  for (const [k, name] of [['s', L.sizeS], ['m', L.sizeM], ['l', L.sizeL]]) {
    const b = el('button', PREFS.size === k ? 'on' : '', name);
    b.onclick = () => { PREFS.size = k; savePrefs(); for (const x of seg.children) x.classList.toggle('on', x === b); };
    seg.append(b);
  }
  box.append(seg);
  box.append(check(L.notify, 'notify', (on) => {
    if (on && NATIVE) { try { NATIVE.askNotify(); } catch {} }
    else if (on && window.Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => undefined);
  }));
  if (navigator.wakeLock || NATIVE) box.append(check(L.wake, 'wake', () => keepAwake()));
  box.append(check(L.enterSend, 'enter'));
  box.append(el('div', 'stitle', L.deviceName));
  const nr = el('div', 'row');
  const name = el('input');
  name.type = 'text';
  name.maxLength = 60;
  const sv = el('button', '', L.save);
  sv.onclick = async () => {
    const v = name.value.trim();
    if (!v) return;
    const r = await post('/api/rename', { name: v }).catch(() => null);
    if (r && r.ok) { sv.textContent = L.saved; setTimeout(() => { sv.textContent = L.save; }, 1400); }
  };
  nr.append(name, sv);
  box.append(nr);
  const since = el('p', 'hint', '');
  box.append(since);
  fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) { name.value = d.name || ''; nativeComputer(d); since.textContent = L.pairedSince + ': ' + new Date(d.at).toLocaleString(); } })
    .catch(() => undefined);
  if (caps.config !== false) {
    const cb = el('button', '', L.appConfig);
    cb.onclick = () => openConfig();
    box.append(cb);
  }
  box.append(el('p', 'hint', L.stays));
  if (NATIVE) {
    const cc = el('button', '', L.changeComputer);
    cc.onclick = () => { try { NATIVE.setup(); } catch {} };
    box.append(cc);
    if (typeof NATIVE.options === 'function') {
      const ob = el('button', '', L.appOptions);
      ob.onclick = () => { try { NATIVE.options(); } catch {} };
      box.append(ob);
    }
  } else if (/Android/i.test(navigator.userAgent)) {
    const a = el('a', 'btn-link', L.getApp);
    a.href = APP_APK;
    a.target = '_blank';
    a.rel = 'noopener';
    box.append(a, el('p', 'hint', L.getAppHint));
  }
  if (NATIVE) {
    // Already an app.
  } else if (installEv) {
    const ib = el('button', 'primary', L.install);
    ib.onclick = () => { installEv.prompt(); installEv = null; ib.remove(); };
    box.append(ib);
  } else if (!window.matchMedia('(display-mode: standalone)').matches) box.append(el('p', 'hint', L.installHint));
  const out = el('button', 'danger', L.unpairMe);
  out.onclick = async () => {
    if (!confirm(L.unpairConfirm)) return;
    await post('/api/unpair', {}).catch(() => undefined);
    unpair();
  };
  box.append(out);
}

/** Saved prompts: the user's own plus a few ideas. */
function loadPrompts() { try { return JSON.parse(localStorage.getItem('zx.prompts') || '[]'); } catch { return []; } }
function openPrompts() {
  mview = 'prompts';
  const box = openM(L.prompts);
  box.append(el('p', 'hint', L.promptsHint));
  const add = el('button', 'primary', L.addPrompt);
  add.onclick = () => {
    const v = $('text').value.trim();
    if (!v) return void alert(L.noPromptText);
    const list = loadPrompts().filter((x) => x !== v);
    list.unshift(v);
    localStorage.setItem('zx.prompts', JSON.stringify(list.slice(0, 50)));
    openPrompts();
  };
  box.append(add);
  const use = (v) => { $('text').value = v; grow(); saveDraft(); closeM(); $('text').focus(); };
  const mine = loadPrompts();
  for (const v of mine) {
    const r = el('div', 'prompt');
    const b = el('button', 'ptext', v);
    b.onclick = () => use(v);
    const d = el('button', 'pdel', L.del);
    d.onclick = () => { localStorage.setItem('zx.prompts', JSON.stringify(loadPrompts().filter((x) => x !== v))); openPrompts(); };
    r.append(b, d);
    box.append(r);
  }
  for (const k of ['q1', 'q2', 'q3', 'q4', 'q5']) {
    if (mine.includes(L[k])) continue;
    const b = el('button', 'ptext', L[k]);
    const r = el('div', 'prompt');
    b.onclick = () => use(L[k]);
    r.append(b);
    box.append(r);
  }
}

/** Dictation with the phone's voice recognition (where the browser has it). */
/** In the Android app: the phone's own voice typing (a dialog), with the same shape as the web API. */
class NativeSpeech {
  start() {
    window.__zxDictated = (text) => {
      window.__zxDictated = null;
      if (text && this.onresult) this.onresult({ results: [[{ transcript: text }]] });
      if (this.onend) this.onend();
    };
    NATIVE.dictate(this.lang || '');
  }
  stop() {}
}
// The app first: Android's WebView has webkitSpeechRecognition too, but it fails there (no
// microphone permission for pages), so the phone's own voice typing must win.
const Speech = (NATIVE && (() => { try { return NATIVE.canDictate(); } catch { return false; } })() ? NativeSpeech : null) ||
  window.SpeechRecognition || window.webkitSpeechRecognition || null;
/** The phone's back button (in the app): close the sheet or the menu first. */
window.__zxBack = () => {
  if (!$('msheet').classList.contains('hide')) { closeM(); return true; }
  if (document.body.classList.contains('open')) { drawer(false); return true; }
  return false;
};
let rec = null;
function dictate() {
  if (rec) return void rec.stop();
  rec = new Speech();
  rec.lang = document.documentElement.lang === 'en' ? 'en-US' : 'es-MX';
  rec.interimResults = true;
  rec.continuous = true;
  const base = $('text').value ? $('text').value.replace(/\\s*$/, ' ') : '';
  rec.onresult = (e) => {
    let said = '';
    for (const r of e.results) said += r[0].transcript;
    $('text').value = base + said;
    grow();
  };
  rec.onend = rec.onerror = () => {
    rec = null;
    $('mic').classList.remove('rec');
    $('text').placeholder = L.ask;
    saveDraft();
  };
  $('mic').classList.add('rec');
  $('text').placeholder = L.listening;
  try { rec.start(); } catch { rec = null; $('mic').classList.remove('rec'); }
}

function send() {
  const text = $('text').value.trim();
  if (!text) return;
  $('text').value = '';
  grow();
  saveDraft();
  stick = true;
  act({ kind: 'send', text });
}
function grow() {
  const t = $('text');
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
  $('send').disabled = !t.value.trim();
}

$('go').onclick = async () => {
  if ($('go').disabled) return;
  $('perr').textContent = '';
  // The answer waits until the user accepts (or rejects) the device on the computer.
  $('go').disabled = true;
  $('pwait').classList.remove('hide');
  try {
    const key = KEY || undefined;
    const r = await post('/api/pair', { pin: $('pin').value, key });
    if (!r.ok) { $('perr').textContent = (await r.json().catch(() => ({}))).error || L.badPin; return; }
    token = (await r.json()).token;
    localStorage.setItem('zx.token', token);
    // The website keeps the token for the next addresses (it comes right back here).
    if (RELAY_G) return void toRelay('&save=' + token);
    paired();
  } catch { $('perr').textContent = L.noComputer; }
  finally { $('go').disabled = false; $('pwait').classList.add('hide'); }
};
$('pin').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('pin').oninput = (e) => { e.target.value = e.target.value.replace(/\\D/g, ''); if (e.target.value.length === 6) $('go').click(); };
$('menu').onclick = $('title').onclick = () => drawer(true);
$('scrim').onclick = () => drawer(false);
$('new').onclick = $('new2').onclick = () => { drawer(false); act({ kind: 'newChat' }); };
$('mode').onclick = openModes;
$('model').onclick = openModels;
$('models2').onclick = openModels;
$('mclose').onclick = closeM;
$('qclear').onclick = () => act({ kind: 'clearQueue' });
$('stop').onclick = () => act({ kind: 'stop' });
$('open2').onclick = openSheet;
$('sclose').onclick = closeSheet;
$('send').onclick = send;
$('text').oninput = () => { grow(); saveDraft(); };
$('text').onkeydown = (e) => {
  if (PREFS.enter && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!snap || !snap.busy) send(); }
};
$('gear').onclick = openSettings;
$('bolt').onclick = openPrompts;
$('pyes').onclick = () => decideAll('approve');
$('pno').onclick = () => decideAll('deny');
$('tobottom').onclick = () => { const l = $('log'); l.scrollTop = l.scrollHeight; stick = true; toBottom(); };
$('log').addEventListener('scroll', toBottom, { passive: true });
$('csearch').oninput = () => { if (snap) renderList(); };
if (Speech) { $('mic').classList.remove('hide'); $('mic').onclick = dictate; }
$('files2').onclick = () => openFiles();
$('term2').onclick = $('termb').onclick = () => openTerm();
$('git2').onclick = openGit;
$('config2').onclick = () => openConfig();
$('menu').addEventListener('click', loadCaps);
${TOOLS_JS}
${CONFIG_JS}
if (token) paired();
</script>
</body>
</html>`;
}
