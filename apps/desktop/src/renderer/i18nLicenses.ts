import { lang } from './i18n';

/** Strings of the third-party list in Ayuda → Licencias (Fase 20), kept apart from i18n.ts. */
const es = {
  licThirdParty: 'Software de terceros',
  licThirdPartyIntro:
    'Zinarix incluye estas bibliotecas de código abierto. La lista sale de lo que realmente va dentro de la app en esta versión.',
  licOther: 'Fuentes, iconos y programas',
  licPackages: 'Bibliotecas ({n})',
  licFilter: 'Buscar por nombre o licencia',
  licNone: 'Ninguna coincide con «{q}»',
  licText: 'Texto de la licencia',
  licNoText: 'El paquete no trae archivo de licencia. Consulta su página.',
  licLoading: 'Cargando la lista…',
  licMissing: 'La lista no está en esta compilación. Se genera al compilar la app.',
  licFull: 'El archivo completo, THIRD_PARTY_NOTICES.md, está en la carpeta de instalación.',
};

type LicKey = keyof typeof es;

const en: Record<LicKey, string> = {
  licThirdParty: 'Third-party software',
  licThirdPartyIntro:
    'Zinarix includes these open-source libraries. The list comes from what actually ships inside this version of the app.',
  licOther: 'Fonts, icons and programs',
  licPackages: 'Libraries ({n})',
  licFilter: 'Search by name or license',
  licNone: 'Nothing matches “{q}”',
  licText: 'License text',
  licNoText: 'The package has no license file. See its page.',
  licLoading: 'Loading the list…',
  licMissing: 'The list is not in this build. It is generated when the app is built.',
  licFull: 'The full file, THIRD_PARTY_NOTICES.md, is in the installation folder.',
};

export function tlic(key: LicKey, vars: Record<string, string | number> = {}): string {
  const dict = lang === 'en' ? en : es;
  return dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
