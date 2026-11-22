// Builds the Android app of the phone remote (apps/remote-android) as a signed release APK and
// leaves it in apps/desktop/build/remote-app/Zinarix-Remote.apk, where build.mjs picks it up so
// the desktop app ships it (resources/remote-app) and serves it to phones on the same Wi-Fi.
//
//   node scripts/build-remote-apk.mjs
//
// Needs JDK 17 + the Android SDK (JAVA_HOME / ANDROID_HOME, or the portable copy in
// %TEMP%\zs-android) and the permanent signing key: ZX_KEYSTORE + ZX_KEYSTORE_PASSWORD, or
// ~/.zinarix-android/zinarix-remote.jks with password.txt next to it. Android only installs an
// update signed with the same key, so an unsigned build is refused.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(desktop, '..', 'remote-android');
const version = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version;
const win = process.platform === 'win32';
const env = { ...process.env };

const portable = join(tmpdir(), 'zs-android');
// A JRE in JAVA_HOME (no javac) cannot build: use the portable JDK then.
const javac = (home) => existsSync(join(home, 'bin', win ? 'javac.exe' : 'javac'));
if ((!env.JAVA_HOME || !javac(env.JAVA_HOME)) && existsSync(join(portable, 'jdk'))) {
  const jdk = readdirSync(join(portable, 'jdk')).find((d) => d.startsWith('jdk-'));
  if (jdk) env.JAVA_HOME = join(portable, 'jdk', jdk);
}
if (!env.ANDROID_HOME && existsSync(join(portable, 'sdk')))
  env.ANDROID_HOME = join(portable, 'sdk');
if (!env.GRADLE_USER_HOME && existsSync(join(portable, 'gradle-home')))
  env.GRADLE_USER_HOME = join(portable, 'gradle-home');
// Networks that inspect TLS: trust the Windows certificate store (as the rest of the app does).
if (win && !/trustStoreType/.test(env.JAVA_TOOL_OPTIONS ?? ''))
  env.JAVA_TOOL_OPTIONS =
    `${env.JAVA_TOOL_OPTIONS ?? ''} -Djavax.net.ssl.trustStoreType=Windows-ROOT`.trim();

if (!env.ZX_KEYSTORE) {
  const dir = join(homedir(), '.zinarix-android');
  if (existsSync(join(dir, 'zinarix-remote.jks'))) {
    env.ZX_KEYSTORE = join(dir, 'zinarix-remote.jks');
    if (!env.ZX_KEYSTORE_PASSWORD && existsSync(join(dir, 'password.txt')))
      env.ZX_KEYSTORE_PASSWORD = readFileSync(join(dir, 'password.txt'), 'utf8').trim();
  }
}
if (!env.JAVA_HOME) fail('No encontré Java 17 (JAVA_HOME).');
if (!env.ANDROID_HOME) fail('No encontré el SDK de Android (ANDROID_HOME).');
if (!env.ZX_KEYSTORE || !env.ZX_KEYSTORE_PASSWORD)
  fail('Falta la clave de firma (ZX_KEYSTORE y ZX_KEYSTORE_PASSWORD, o ~/.zinarix-android).');

const gradlew = join(project, win ? 'gradlew.bat' : 'gradlew');
const r = spawnSync(gradlew, ['--no-daemon', 'assembleRelease', `-PzxVersion=${version}`], {
  cwd: project,
  env,
  stdio: 'inherit',
  shell: win,
});
if (r.status !== 0) fail(`Gradle terminó con el código ${r.status}.`);

const apk = join(project, 'app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apk)) fail('Gradle no dejó app-release.apk.');
const apksigner = join(
  env.ANDROID_HOME,
  'build-tools',
  '35.0.0',
  win ? 'apksigner.bat' : 'apksigner',
);
if (existsSync(apksigner)) {
  const v = spawnSync(apksigner, ['verify', apk], { env, stdio: 'inherit', shell: win });
  if (v.status !== 0) fail('La APK no pasó la verificación de la firma.');
}
const out = join(desktop, 'build/remote-app');
mkdirSync(out, { recursive: true });
copyFileSync(apk, join(out, 'Zinarix-Remote.apk'));
// The desktop app shows this version next to the download.
writeFileSync(
  join(out, 'Zinarix-Remote.json'),
  `${JSON.stringify({ version }, null, 2)}
`,
);
console.log(
  `Zinarix-Remote.apk ${version} (${Math.round(statSync(apk).size / 1024)} KB) -> build/remote-app`,
);

function fail(msg) {
  console.error(`build-remote-apk: ${msg}`);
  process.exit(1);
}
