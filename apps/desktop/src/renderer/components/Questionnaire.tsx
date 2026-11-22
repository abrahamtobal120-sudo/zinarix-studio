import { useState } from 'react';
import { lang } from '../i18n';
import {
  recommend,
  saveProfile,
  USES,
  type AiWay,
  type Answers,
  type Help,
  type Level,
  type Look,
  type Use,
} from '../profile';
import { getState, setState, setTheme, toast, updatePrefs } from '../store';
import { Icon, type IconName } from './Icon';
import { ModalShell } from './ModalShell';
import './questionnaire.css';

/**
 * Before the app is used for the first time: five quick questions, and Zinarix sets itself up
 * for that person (the panels they need in the bar, theme, how much the AI does alone, help).
 * Can be skipped, and repeated from Settings → Apariencia.
 */

const es = {
  label: 'Cuestionario de inicio',
  hello: 'Hagamos Zinarix a tu medida',
  helloLead: 'Responde 5 preguntas rápidas y la app se acomoda a lo que haces: los paneles que vas a usar, el tema y cuánto te ayuda la IA.',
  q1: '¿Qué quieres hacer con Zinarix?',
  q1Hint: 'Elige todo lo que aplique.',
  q2: '¿Cuánta experiencia tienes programando?',
  q3: '¿Cómo quieres usar la IA?',
  q4: '¿Cuánto quieres que haga la IA sola?',
  q5: '¿Qué apariencia prefieres?',
  web: 'Páginas y apps web',
  mobile: 'Apps de celular',
  games: 'Videojuegos',
  hardware: 'Arduino y electrónica',
  arch3d: 'Arquitectura y diseño 3D (SketchUp)',
  print3d: 'CAD e impresión 3D',
  video: 'Video y redes sociales',
  graphics: 'Diseño gráfico y logos',
  data: 'Datos y notebooks',
  cloud: 'Servidores, Docker y nube',
  office: 'Correo y tareas de oficina',
  new: 'Nunca he programado',
  newHint: 'Explícame todo paso a paso.',
  some: 'Un poco',
  someHint: 'Sé lo básico.',
  pro: 'Soy profesional',
  proHint: 'Ve directo al grano.',
  local: 'Gratis en mi compu',
  localHint: 'Ollama / LM Studio, nada sale de la PC.',
  keys: 'Con mis claves de API',
  keysHint: 'OpenAI, Anthropic, Google, OpenRouter…',
  cli: 'Con mi suscripción',
  cliHint: 'Claude Code, Codex o Gemini CLI.',
  unsure: 'No sé todavía',
  unsureHint: 'Te ayudamos a elegir.',
  auto: 'Que lo haga todo',
  autoHint: 'Edita archivos sin preguntar (lo que sale de la PC sí pregunta).',
  ask: 'Que me pregunte antes',
  askHint: 'Apruebo cada cambio y comando.',
  chat: 'Solo platicar',
  chatHint: 'Responde, no toca mis archivos.',
  dark: 'Oscura',
  light: 'Clara',
  back: 'Atrás',
  next: 'Siguiente',
  skip: 'Saltar',
  start: 'Empezar',
  finish: 'Listo, armar mi app',
  pickOne: 'Elige al menos una opción.',
  done: 'Zinarix quedó listo para ti. Puedes repetir el cuestionario en Configuración.',
};
const en: typeof es = {
  label: 'Getting started questionnaire',
  hello: 'Let’s make Zinarix yours',
  helloLead: 'Answer 5 quick questions and the app adapts to what you do: the panels you will use, the theme and how much the AI helps.',
  q1: 'What do you want to do with Zinarix?',
  q1Hint: 'Pick everything that applies.',
  q2: 'How much programming experience do you have?',
  q3: 'How do you want to use AI?',
  q4: 'How much should the AI do on its own?',
  q5: 'Which look do you prefer?',
  web: 'Websites and web apps',
  mobile: 'Phone apps',
  games: 'Video games',
  hardware: 'Arduino and electronics',
  arch3d: 'Architecture and 3D design (SketchUp)',
  print3d: 'CAD and 3D printing',
  video: 'Video and social media',
  graphics: 'Graphic design and logos',
  data: 'Data and notebooks',
  cloud: 'Servers, Docker and cloud',
  office: 'Mail and office tasks',
  new: 'I have never coded',
  newHint: 'Explain everything step by step.',
  some: 'A little',
  someHint: 'I know the basics.',
  pro: 'I am a professional',
  proHint: 'Get straight to the point.',
  local: 'Free on my computer',
  localHint: 'Ollama / LM Studio, nothing leaves the PC.',
  keys: 'With my API keys',
  keysHint: 'OpenAI, Anthropic, Google, OpenRouter…',
  cli: 'With my subscription',
  cliHint: 'Claude Code, Codex or Gemini CLI.',
  unsure: 'Not sure yet',
  unsureHint: 'We help you choose.',
  auto: 'Do everything',
  autoHint: 'Edits files without asking (what leaves the PC still asks).',
  ask: 'Ask me first',
  askHint: 'I approve every change and command.',
  chat: 'Just chat',
  chatHint: 'Answers, does not touch my files.',
  dark: 'Dark',
  light: 'Light',
  back: 'Back',
  next: 'Next',
  skip: 'Skip',
  start: 'Start',
  finish: 'Done, build my app',
  pickOne: 'Pick at least one option.',
  done: 'Zinarix is ready for you. You can repeat the questionnaire in Settings.',
};
type K = keyof typeof es;
const tq = (k: K) => (lang === 'en' ? en : es)[k];

const USE_ICON: Record<Use, IconName> = {
  web: 'globe',
  mobile: 'smartphone',
  games: 'gamepad',
  hardware: 'cpu',
  arch3d: 'home',
  print3d: 'compass',
  video: 'film',
  graphics: 'palette',
  data: 'chart',
  cloud: 'cloud',
  office: 'mail',
};

function Choice<T extends string>({
  options,
  value,
  onPick,
}: {
  options: { id: T; icon: IconName; hint?: K }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="quiz-cards" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          className={`onb-card quiz-card${value === o.id ? ' on' : ''}`}
          onClick={() => onPick(o.id)}
        >
          <Icon name={o.icon} size={20} />
          <b>{tq(o.id as K)}</b>
          {o.hint && <span>{tq(o.hint)}</span>}
        </button>
      ))}
    </div>
  );
}

/** What the answers change in the app. */
async function apply(a: Answers, then: () => void): Promise<void> {
  const r = recommend(a);
  saveProfile({ answers: a, ...r, at: Date.now() });
  try {
    localStorage.setItem('zs.chatMode', a.help === 'auto' ? 'auto' : a.help === 'ask' ? 'agent' : 'ask');
    localStorage.setItem('zs.agentMode', a.help === 'chat' ? 'off' : 'on');
  } catch {
    // storage unavailable: the chat keeps its default mode
  }
  const theme = getState().settings.theme;
  const dark = theme !== 'light' && !theme.includes('light');
  if ((a.look === 'light') === dark) await setTheme(a.look).catch(() => undefined);
  await updatePrefs({
    helperBubble: a.level !== 'pro',
    minimap: a.level === 'pro',
    wordWrap: a.level === 'new',
  }).catch(() => undefined);
  if (r.start) setState({ sidebar: r.start as never });
  toast(tq('done'));
  then();
}

export function Questionnaire({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [uses, setUses] = useState<Use[]>([]);
  const [level, setLevel] = useState<Level>('some');
  const [ai, setAi] = useState<AiWay>('unsure');
  const [help, setHelp] = useState<Help>('ask');
  const [look, setLook] = useState<Look>('dark');
  const [busy, setBusy] = useState(false);
  const steps = 6;
  const skip = () => {
    saveProfile({
      answers: { uses: [], level, ai, help, look },
      pinned: [],
      start: null,
      at: Date.now(),
    });
    onDone();
  };
  const toggle = (u: Use) => setUses((v) => (v.includes(u) ? v.filter((x) => x !== u) : [...v, u]));
  const next = () => {
    if (step === 1 && uses.length === 0) return toast(tq('pickOne'));
    if (step < steps - 1) return setStep(step + 1);
    setBusy(true);
    void apply({ uses, level, ai, help, look }, onDone).finally(() => setBusy(false));
  };
  return (
    <ModalShell
      onClose={skip}
      onBackdrop={null}
      backdropClassName="onboarding-backdrop"
      className="onboarding quiz"
      label={tq('label')}
    >
      <div className="onb-dots" aria-hidden="true">
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />
        ))}
      </div>
      {step === 0 && (
        <div className="onb-step center">
          <img className="onb-logo" src="./logo.svg" alt="" />
          <h1>{tq('hello')}</h1>
          <p className="onb-lead">{tq('helloLead')}</p>
        </div>
      )}
      {step === 1 && (
        <div className="onb-step">
          <h2>{tq('q1')}</h2>
          <p className="dim">{tq('q1Hint')}</p>
          <div className="quiz-uses">
            {USES.map((u) => (
              <button
                key={u}
                role="checkbox"
                aria-checked={uses.includes(u)}
                className={`quiz-use${uses.includes(u) ? ' on' : ''}`}
                onClick={() => toggle(u)}
              >
                <Icon name={uses.includes(u) ? 'check' : USE_ICON[u]} size={16} /> {tq(u)}
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="onb-step">
          <h2>{tq('q2')}</h2>
          <Choice
            value={level}
            onPick={setLevel}
            options={[
              { id: 'new', icon: 'lightbulb', hint: 'newHint' },
              { id: 'some', icon: 'code', hint: 'someHint' },
              { id: 'pro', icon: 'bolt', hint: 'proHint' },
            ]}
          />
        </div>
      )}
      {step === 3 && (
        <div className="onb-step">
          <h2>{tq('q3')}</h2>
          <Choice
            value={ai}
            onPick={setAi}
            options={[
              { id: 'local', icon: 'cpu', hint: 'localHint' },
              { id: 'keys', icon: 'key', hint: 'keysHint' },
              { id: 'cli', icon: 'terminal', hint: 'cliHint' },
              { id: 'unsure', icon: 'info', hint: 'unsureHint' },
            ]}
          />
        </div>
      )}
      {step === 4 && (
        <div className="onb-step">
          <h2>{tq('q4')}</h2>
          <Choice
            value={help}
            onPick={setHelp}
            options={[
              { id: 'auto', icon: 'agent', hint: 'autoHint' },
              { id: 'ask', icon: 'check', hint: 'askHint' },
              { id: 'chat', icon: 'message', hint: 'chatHint' },
            ]}
          />
        </div>
      )}
      {step === 5 && (
        <div className="onb-step">
          <h2>{tq('q5')}</h2>
          <Choice
            value={look}
            onPick={setLook}
            options={[
              { id: 'dark', icon: 'moon' },
              { id: 'light', icon: 'sun' },
            ]}
          />
        </div>
      )}
      <div className="onb-nav">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)}>{tq('back')}</button>
        ) : (
          <button className="link" onClick={skip}>
            {tq('skip')}
          </button>
        )}
        <button className="primary" disabled={busy} onClick={next}>
          {step === 0 ? tq('start') : step === steps - 1 ? tq('finish') : tq('next')}
        </button>
      </div>
    </ModalShell>
  );
}

