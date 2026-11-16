import { useEffect, useMemo, useState } from 'react';
import { tlic } from '../i18nLicenses';
import './third-party.css';

/** dist/renderer/third-party-notices.json, written at build time by scripts/notices.mjs. */
interface Notices {
  version: string;
  extras: { name: string; kind: string; license: string; homepage: string; text: number }[];
  packages: { name: string; version: string; license: string; homepage: string; text: number }[];
  texts: string[];
}

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ok'; data: Notices };

/** Ayuda → Licencias: every library bundled in this build, with its license text. */
export function ThirdPartyNotices() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    fetch('./third-party-notices.json')
      .then((r) => (r.ok ? (r.json() as Promise<Notices>) : Promise.reject(new Error('404'))))
      .then((data) => live && setLoad({ state: 'ok', data }))
      .catch(() => live && setLoad({ state: 'missing' }));
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => {
    if (load.state !== 'ok') return [];
    const s = q.trim().toLowerCase();
    return load.data.packages.filter(
      (p) => !s || p.name.toLowerCase().includes(s) || p.license.toLowerCase().includes(s),
    );
  }, [load, q]);

  if (load.state === 'loading') return <p className="tp-note">{tlic('licLoading')}</p>;
  if (load.state === 'missing') return <p className="tp-note">{tlic('licMissing')}</p>;
  const { data } = load;
  const text = (i: number) => (i >= 0 ? data.texts[i] : undefined);

  return (
    <section className="tp" aria-labelledby="tp-title">
      <h3 id="tp-title">{tlic('licThirdParty')}</h3>
      <p>{tlic('licThirdPartyIntro')}</p>

      <h4>{tlic('licOther')}</h4>
      <ul className="tp-list">
        {data.extras.map((e) => (
          <Row
            key={e.name}
            name={e.name}
            license={e.license}
            homepage={e.homepage}
            text={text(e.text)}
          />
        ))}
      </ul>

      <h4>{tlic('licPackages', { n: data.packages.length })}</h4>
      <input
        className="tp-filter"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tlic('licFilter')}
        aria-label={tlic('licFilter')}
      />
      {shown.length ? (
        <ul className="tp-list">
          {shown.map((p) => (
            <Row
              key={`${p.name}@${p.version}`}
              name={p.name}
              version={p.version}
              license={p.license}
              homepage={p.homepage}
              text={text(p.text)}
            />
          ))}
        </ul>
      ) : (
        <p className="tp-note">{tlic('licNone', { q })}</p>
      )}
      <p className="tp-note">{tlic('licFull')}</p>
    </section>
  );
}

function Row(props: {
  name: string;
  version?: string;
  license: string;
  homepage: string;
  text?: string;
}) {
  return (
    <li>
      <details>
        <summary>
          <span className="tp-name">{props.name}</span>
          {props.version && <span className="tp-ver">{props.version}</span>}
          <span className="tp-lic">{props.license}</span>
        </summary>
        <div className="tp-body">
          <div className="tp-url">{props.homepage}</div>
          {props.text ? (
            <pre aria-label={tlic('licText')}>{props.text}</pre>
          ) : (
            <p className="tp-note">{tlic('licNoText')}</p>
          )}
        </div>
      </details>
    </li>
  );
}
