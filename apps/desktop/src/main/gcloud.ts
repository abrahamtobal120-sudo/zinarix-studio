import { AccountList, type SavedAccount } from './accounts.js';
import type { GoogleAuth } from './googleMail.js';
import type {
  GCloudBucket,
  GCloudDataset,
  GCloudLogEntry,
  GCloudObject,
  GCloudProject,
  GCloudQueryResult,
  GCloudService,
  GCloudSqlInstance,
  GCloudStatus,
  GCloudTable,
} from '../shared/api.js';

/**
 * Google Cloud with "Sign in with Google": the same OAuth client as Gmail (Google Cloud →
 * Credentials → "Desktop app"), asking for the cloud-platform scope. One login reaches every
 * API enabled in the user's projects (BigQuery, Cloud Storage, Cloud SQL, Logging…); what the
 * account may do is what its IAM roles allow. Refresh tokens stay in the main process, one
 * TokenStore per account.
 */

export const CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const MAX_ROWS = 500;
/** Upper bound of bytes a BigQuery query from the panel may bill (10 GB, about US$0.06). */
const MAX_BYTES_BILLED = 10 * 1024 ** 3;

/** APIs the panel and the chat tools use: turned on by themselves in the chosen project. */
export const NEEDED_APIS = [
  'cloudresourcemanager.googleapis.com',
  'serviceusage.googleapis.com',
  'bigquery.googleapis.com',
  'bigquerystorage.googleapis.com',
  'storage.googleapis.com',
  'storage-api.googleapis.com',
  'sqladmin.googleapis.com',
  'logging.googleapis.com',
];

/** Google refused the token (as opposed to a network or server failure). */
class AuthError extends Error {}

/**
 * An API is off in the project Google bills the call to. With "Sign in with Google" that is
 * usually the project of the OAuth client itself, not one of the user's projects.
 */
class ServiceDisabledError extends Error {
  constructor(
    message: string,
    readonly service: string,
    /** Project number or id ("151420956067"), without the "projects/" prefix. */
    readonly consumer: string,
  ) {
    super(message);
  }
}

type GoogleErrorBody = {
  error?:
    | {
        message?: string;
        details?: { reason?: string; metadata?: { service?: string; consumer?: string } }[];
      }
    | string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function checkProject(id: string): string {
  if (!/^[\w.:-]{1,100}$/.test(id)) throw new Error('Id de proyecto de Google Cloud no válido.');
  return id;
}
function checkName(id: string, what: string): string {
  if (!/^[\w.-]{1,1024}$/.test(id)) throw new Error(`${what} no válido.`);
  return id;
}
function checkService(name: string): string {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) throw new Error('Nombre de API no válido.');
  return name;
}

const enc = encodeURIComponent;

export class GCloud {
  private readonly accounts: AccountList;

  constructor(
    private readonly dir: string,
    private readonly google: GoogleAuth,
    private readonly pinned?: SavedAccount,
  ) {
    this.accounts = new AccountList(dir, 'gcloud');
  }

  accountList(): { accounts: SavedAccount[]; active: string | null } {
    return { accounts: this.accounts.list(), active: this.accounts.active()?.id ?? null };
  }

  /** The same service on one connected account (by id or address), without switching the panel. */
  forAccount(account?: string): GCloud {
    if (!account) return this;
    const list = this.accounts.list();
    const acc = list.find((a) => a.id === account) ?? list.find((a) => a.label === account);
    if (!acc) throw new Error(`No connected Google Cloud account "${account}".`);
    return new GCloud(this.dir, this.google, acc);
  }

  private refresh(): string | null {
    const acc = this.pinned ?? this.accounts.active();
    return acc ? this.accounts.token(acc.id) : null;
  }

  /** Consumer projects where we already tried to turn an API on this session ("project|api"). */
  private readonly enableTried = new Set<string>();

  /**
   * Every Google call goes through here. If Google answers that the API is off in the project
   * it bills to (often the OAuth client's own project, not one of the user's), it tries once
   * per session to turn that API on there and retries while the change spreads. Works for any
   * API (BigQuery, Storage, SQL, Logging, Resource Manager…). If it can't, a clear message.
   */
  private async req<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    try {
      return await this.send<T>(url, init);
    } catch (e) {
      if (!(e instanceof ServiceDisabledError)) throw e;
      const key = `${e.consumer}|${e.service}`;
      if (!this.enableTried.has(key)) {
        this.enableTried.add(key);
        let enabled = false;
        try {
          await this.send(
            `https://serviceusage.googleapis.com/v1/projects/${enc(e.consumer)}/services/${enc(e.service)}:enable`,
            { method: 'POST', body: {} },
          );
          enabled = true;
        } catch {
          /* no permission on that project: fall through to the clear message */
        }
        // Google says it may take a few minutes to apply; retry for about half a minute.
        if (enabled)
          for (let i = 0; i < 6; i++) {
            await sleep(5_000);
            try {
              return await this.send<T>(url, init);
            } catch (again) {
              if (!(again instanceof ServiceDisabledError)) throw again;
            }
          }
      }
      throw new ServiceDisabledError(
        `La API "${e.service}" está desactivada en el proyecto ${e.consumer}. ` +
          `Actívala en https://console.cloud.google.com/apis/library/${e.service}?project=${e.consumer}, ` +
          `espera un par de minutos y vuelve a intentar. (Google: ${e.message})`,
        e.service,
        e.consumer,
      );
    }
  }

  private async send<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const refresh = this.refresh();
    if (!refresh) throw new Error('Inicia sesión con Google en el panel de Google Cloud primero.');
    let token: string;
    try {
      token = await this.google.accessToken(refresh);
    } catch (e) {
      throw new AuthError((e as Error).message);
    }
    const r = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      let disabled: { service?: string; consumer?: string } | undefined;
      try {
        const e = JSON.parse(text) as GoogleErrorBody;
        if (typeof e.error === 'string') msg = e.error;
        else if (e.error) {
          if (e.error.message) msg = e.error.message;
          disabled = e.error.details?.find((d) => d.reason === 'SERVICE_DISABLED')?.metadata;
        }
      } catch {
        /* not JSON */
      }
      if (r.status === 401) throw new AuthError(`Google rechazó la sesión (${msg}).`);
      if (disabled?.service && disabled.consumer)
        throw new ServiceDisabledError(
          msg,
          disabled.service,
          disabled.consumer.replace(/^projects\//, ''),
        );
      throw new Error(msg);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  async status(): Promise<GCloudStatus> {
    const active = this.accounts.active();
    const base: GCloudStatus = {
      ready: !!this.google.client(),
      connected: false,
      user: active?.label || null,
      accounts: this.accounts.list(),
      active: active?.id ?? null,
    };
    if (!this.refresh()) return base;
    try {
      await this.google.accessToken(this.refresh()!);
      return { ...base, connected: true };
    } catch (e) {
      const msg = (e as Error).message || String(e);
      // Revoked or expired login: show the sign-in again. Anything else: keep it and retry.
      if (/caduc|revoc|invalid_grant/i.test(msg)) return base;
      return { ...base, offline: msg };
    }
  }

  /** Keeps a Google sign-in that granted the cloud-platform scope (from either panel). */
  addAccount(refresh: string, email: string): void {
    this.accounts.add(refresh, email);
  }

  private readonly prepared = new Set<string>();

  /**
   * Turns on, in one call, the APIs Zinarix needs that the project still has off. Once per
   * account and project each session. Returns the ones it turned on.
   */
  async prepare(project: string): Promise<string[]> {
    const key = `${(this.pinned ?? this.accounts.active())?.id ?? ''}|${checkProject(project)}`;
    if (this.prepared.has(key)) return [];
    const on = new Set((await this.services(project)).map((s) => s.name));
    const missing = NEEDED_APIS.filter((n) => !on.has(n));
    if (missing.length)
      await this.req(
        `https://serviceusage.googleapis.com/v1/projects/${enc(project)}/services:batchEnable`,
        { method: 'POST', body: { serviceIds: missing } },
      );
    this.prepared.add(key);
    return missing;
  }

  async useAccount(id: string): Promise<GCloudStatus> {
    this.accounts.use(id);
    return this.status();
  }

  async logout(id?: string): Promise<GCloudStatus> {
    const target = id ?? this.accounts.active()?.id;
    if (target) {
      const refresh = this.accounts.token(target);
      if (refresh) await this.google.revoke(refresh);
      this.accounts.remove(target);
    }
    return this.status();
  }

  // ---- Projects and APIs ----

  async projects(): Promise<GCloudProject[]> {
    try {
      return await this.projectsFromResourceManager();
    } catch (e) {
      if (!(e instanceof ServiceDisabledError)) throw e;
      // Cloud Resource Manager is off and could not be turned on: BigQuery also lists projects.
      try {
        return await this.projectsFromBigQuery();
      } catch {
        throw e; // already the clear message with the link
      }
    }
  }

  private async projectsFromBigQuery(): Promise<GCloudProject[]> {
    const out: GCloudProject[] = [];
    let page = '';
    do {
      const j = await this.req<{
        projects?: {
          projectReference?: { projectId?: string };
          friendlyName?: string;
          numericId?: string;
        }[];
        nextPageToken?: string;
      }>(
        `https://bigquery.googleapis.com/bigquery/v2/projects?maxResults=1000${page ? `&pageToken=${enc(page)}` : ''}`,
      );
      for (const p of j.projects ?? []) {
        const id = p.projectReference?.projectId;
        if (id) out.push({ id, name: p.friendlyName || id, number: p.numericId ?? '' });
      }
      page = j.nextPageToken ?? '';
    } while (page && out.length < 1000);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async projectsFromResourceManager(): Promise<GCloudProject[]> {
    const out: GCloudProject[] = [];
    let page = '';
    do {
      const j = await this.req<{
        projects?: { projectId: string; name?: string; projectNumber?: string }[];
        nextPageToken?: string;
      }>(
        `https://cloudresourcemanager.googleapis.com/v1/projects?filter=${enc('lifecycleState:ACTIVE')}&pageSize=200${page ? `&pageToken=${enc(page)}` : ''}`,
      );
      for (const p of j.projects ?? [])
        out.push({ id: p.projectId, name: p.name ?? p.projectId, number: p.projectNumber ?? '' });
      page = j.nextPageToken ?? '';
    } while (page && out.length < 1000);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** APIs of a project: the enabled ones, or every one Google offers (all = true). */
  async services(project: string, all = false): Promise<GCloudService[]> {
    const out: GCloudService[] = [];
    let page = '';
    do {
      const j = await this.req<{
        services?: { config?: { name?: string; title?: string }; state?: string }[];
        nextPageToken?: string;
      }>(
        `https://serviceusage.googleapis.com/v1/projects/${enc(checkProject(project))}/services?pageSize=200${all ? '' : `&filter=${enc('state:ENABLED')}`}${page ? `&pageToken=${enc(page)}` : ''}`,
      );
      for (const s of j.services ?? [])
        if (s.config?.name)
          out.push({
            name: s.config.name,
            title: s.config.title || s.config.name,
            enabled: s.state === 'ENABLED',
          });
      page = j.nextPageToken ?? '';
    } while (page && out.length < 5000);
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Turns an API on or off for a project (Google finishes it in the background). */
  async setService(project: string, service: string, enable: boolean): Promise<void> {
    await this.req(
      `https://serviceusage.googleapis.com/v1/projects/${enc(checkProject(project))}/services/${enc(checkService(service))}:${enable ? 'enable' : 'disable'}`,
      { method: 'POST', body: enable ? {} : { disableDependentServices: false } },
    );
  }

  // ---- BigQuery ----

  async datasets(project: string): Promise<GCloudDataset[]> {
    const j = await this.req<{
      datasets?: { datasetReference: { datasetId: string }; location?: string }[];
    }>(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${enc(checkProject(project))}/datasets?all=true&maxResults=1000`,
    );
    return (j.datasets ?? []).map((d) => ({
      id: d.datasetReference.datasetId,
      location: d.location ?? '',
    }));
  }

  async tables(project: string, dataset: string): Promise<GCloudTable[]> {
    const j = await this.req<{
      tables?: { tableReference: { tableId: string }; type?: string }[];
    }>(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${enc(checkProject(project))}/datasets/${enc(checkName(dataset, 'Dataset'))}/tables?maxResults=1000`,
    );
    return (j.tables ?? []).map((x) => ({ id: x.tableReference.tableId, type: x.type ?? 'TABLE' }));
  }

  /**
   * Runs standard SQL on BigQuery (billed to the project) and returns up to MAX_ROWS rows.
   * Queries that would bill more than MAX_BYTES_BILLED fail instead of running.
   */
  async query(project: string, sql: string): Promise<GCloudQueryResult> {
    const p = enc(checkProject(project));
    const started = Date.now();
    type Answer = {
      jobComplete?: boolean;
      jobReference?: { jobId: string; location?: string };
      schema?: { fields?: { name: string }[] };
      rows?: { f: { v: unknown }[] }[];
      totalRows?: string;
      totalBytesProcessed?: string;
      numDmlAffectedRows?: string;
    };
    let j = await this.req<Answer>(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${p}/queries`,
      {
        method: 'POST',
        body: {
          query: sql,
          useLegacySql: false,
          maxResults: MAX_ROWS,
          timeoutMs: 30_000,
          // Cost guard: BigQuery refuses (without billing) a query that would scan more than this.
          maximumBytesBilled: String(MAX_BYTES_BILLED),
        },
      },
    );
    // Long queries: wait for the job (up to about two minutes).
    for (let i = 0; !j.jobComplete && j.jobReference && i < 12; i++) {
      const loc = j.jobReference.location ? `&location=${enc(j.jobReference.location)}` : '';
      j = await this.req<Answer>(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${p}/queries/${enc(j.jobReference.jobId)}?maxResults=${MAX_ROWS}&timeoutMs=10000${loc}`,
      );
    }
    if (!j.jobComplete)
      throw new Error('La consulta de BigQuery sigue corriendo; revisa la consola.');
    const columns = (j.schema?.fields ?? []).map((f) => f.name);
    const cell = (v: unknown): string | null =>
      v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return {
      columns,
      rows: (j.rows ?? []).map((r) => r.f.map((c) => cell(c.v))),
      total: Number(j.totalRows ?? j.numDmlAffectedRows ?? 0),
      ms: Date.now() - started,
      bytes: Number(j.totalBytesProcessed ?? 0),
    };
  }

  // ---- Cloud Storage ----

  async buckets(project: string): Promise<GCloudBucket[]> {
    const j = await this.req<{
      items?: { name: string; location?: string; storageClass?: string; timeCreated?: string }[];
    }>(
      `https://storage.googleapis.com/storage/v1/b?project=${enc(checkProject(project))}&maxResults=1000`,
    );
    return (j.items ?? []).map((b) => ({
      name: b.name,
      location: b.location ?? '',
      storageClass: b.storageClass ?? '',
      created: b.timeCreated ? Date.parse(b.timeCreated) : null,
    }));
  }

  /** One "folder" level of a bucket: subfolders first, then files. */
  async objects(bucket: string, prefix = ''): Promise<GCloudObject[]> {
    const j = await this.req<{
      prefixes?: string[];
      items?: { name: string; size?: string; updated?: string; contentType?: string }[];
    }>(
      `https://storage.googleapis.com/storage/v1/b/${enc(checkName(bucket, 'Bucket'))}/o?delimiter=/&maxResults=500&prefix=${enc(prefix)}`,
    );
    return [
      ...(j.prefixes ?? []).map((name) => ({
        name,
        folder: true,
        size: 0,
        updated: null,
        type: '',
      })),
      ...(j.items ?? [])
        .filter((o) => o.name !== prefix)
        .map((o) => ({
          name: o.name,
          folder: false,
          size: Number(o.size ?? 0),
          updated: o.updated ? Date.parse(o.updated) : null,
          type: o.contentType ?? '',
        })),
    ];
  }

  // ---- Cloud SQL ----

  async sqlInstances(project: string): Promise<GCloudSqlInstance[]> {
    const j = await this.req<{
      items?: {
        name: string;
        databaseVersion?: string;
        region?: string;
        state?: string;
        settings?: { tier?: string; activationPolicy?: string };
        ipAddresses?: { ipAddress: string; type?: string }[];
      }[];
    }>(`https://sqladmin.googleapis.com/v1/projects/${enc(checkProject(project))}/instances`);
    return (j.items ?? []).map((i) => ({
      name: i.name,
      version: i.databaseVersion ?? '',
      region: i.region ?? '',
      state: i.settings?.activationPolicy === 'NEVER' ? 'STOPPED' : (i.state ?? ''),
      tier: i.settings?.tier ?? '',
      ip:
        i.ipAddresses?.find((a) => a.type === 'PRIMARY')?.ipAddress ??
        i.ipAddresses?.[0]?.ipAddress ??
        '',
    }));
  }

  /** Starts (ALWAYS) or stops (NEVER) a Cloud SQL instance. */
  async sqlPower(project: string, instance: string, on: boolean): Promise<void> {
    await this.req(
      `https://sqladmin.googleapis.com/v1/projects/${enc(checkProject(project))}/instances/${enc(checkName(instance, 'Instancia'))}`,
      { method: 'PATCH', body: { settings: { activationPolicy: on ? 'ALWAYS' : 'NEVER' } } },
    );
  }

  // ---- Cloud Logging ----

  /** The newest log entries of a project (filter in the Logging query language). */
  async logs(project: string, filter = ''): Promise<GCloudLogEntry[]> {
    const j = await this.req<{
      entries?: {
        timestamp?: string;
        severity?: string;
        textPayload?: string;
        jsonPayload?: Record<string, unknown>;
        protoPayload?: Record<string, unknown>;
        resource?: { type?: string };
        logName?: string;
      }[];
    }>('https://logging.googleapis.com/v2/entries:list', {
      method: 'POST',
      body: {
        resourceNames: [`projects/${checkProject(project)}`],
        orderBy: 'timestamp desc',
        pageSize: 100,
        ...(filter.trim() ? { filter: filter.trim() } : {}),
      },
    });
    return (j.entries ?? []).map((e) => {
      const json = e.jsonPayload ?? e.protoPayload;
      const msg =
        e.textPayload ??
        (json && typeof json.message === 'string'
          ? json.message
          : json
            ? JSON.stringify(json)
            : '');
      return {
        time: e.timestamp ? Date.parse(e.timestamp) : null,
        severity: e.severity ?? 'DEFAULT',
        text: msg.slice(0, 4000),
        resource: e.resource?.type ?? e.logName?.split('/').pop() ?? '',
      };
    });
  }
}
