import { AccountSwitch } from './AccountSwitch';
import { Icon, type IconName } from './Icon';
import { useCallback, useEffect, useState } from 'react';
import type {
  MailAccount,
  MailDraft,
  MailFolderView,
  MailMessageView,
  MailStatus,
  MailSummaryView,
  MailTarget,
} from '../../shared/api';
import { t } from '../i18n';
import { api, toast } from '../store';

const errText = (e: unknown) =>
  String((e as Error).message ?? e).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    '',
  );

const open = (url: string) => void api().app.openExternal(url);

/** Folder shown first: the inbox. */
const FOLDER_KEY = 'zinarix.mailFolder';

const FOLDER_ICON: Record<string, IconName> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'send',
  '\\Drafts': 'edit',
  '\\Trash': 'trash',
  '\\Junk': 'warning',
  '\\Archive': 'archive',
  '\\Flagged': 'star',
  '\\All': 'mail',
};

/** Folders in the order mail apps show them; the rest follow, by name. */
const FOLDER_ORDER = [
  '\\Inbox',
  '\\Flagged',
  '\\Drafts',
  '\\Sent',
  '\\Junk',
  '\\Trash',
  '\\Archive',
  '\\All',
];

function sortFolders(fs: MailFolderView[]): MailFolderView[] {
  const rank = (f: MailFolderView) => {
    const i = FOLDER_ORDER.indexOf(f.specialUse ?? '');
    return i < 0 ? FOLDER_ORDER.length : i;
  };
  return [...fs].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The inbox is called "INBOX" by every server: show it in the user's language. */
const folderName = (f: { name: string; specialUse?: string | null }) =>
  f.specialUse === '\\Inbox' || f.name.toUpperCase() === 'INBOX' ? t('mlInbox') : f.name;

const EMPTY_ACCOUNT: MailAccount = {
  email: '',
  name: '',
  user: '',
  imapHost: '',
  imapPort: 993,
  smtpHost: '',
  smtpPort: 465,
};

/** Today: the hour; this year: day and month; older: the full date. */
function when(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString();
}

/** "Name <a@b>" → "Name" (the address when there is no name). */
function shortName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(from);
  return m ? m[1] || m[2]! : from;
}

/** Addresses of a "Name <a@b>, c@d" list, lower-cased. */
function addresses(list: string): string[] {
  return [...list.matchAll(/[^\s<>,"]+@[^\s<>,"]+/g)].map((m) => m[0].toLowerCase());
}

const quote = (text: string) =>
  text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

/** The email HTML inside a document that opens links outside and has a light page. */
function srcDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:10px;font:14px/1.45 system-ui,sans-serif;color:#202124;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}

export function MailPanel() {
  // A new body per mailbox: switching leaves nothing of the previous one on screen.
  const [gen, setGen] = useState(0);
  return <MailBody key={gen} reset={() => setGen((g) => g + 1)} />;
}

function MailBody({ reset }: { reset: () => void }) {
  const [st, setSt] = useState<MailStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<MailAccount>(EMPTY_ACCOUNT);
  const [pass, setPass] = useState('');
  const [servers, setServers] = useState(false);
  const [guessed, setGuessed] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  /** An OAuth client is set up for "Sign in with Google" (null: not known yet). */
  const [gReady, setGReady] = useState<boolean | null>(null);
  const [gSetup, setGSetup] = useState(false);
  const [gClient, setGClient] = useState({ id: '', secret: '' });
  const [folders, setFolders] = useState<MailFolderView[]>([]);
  const [folder, setFolder] = useState(() => localStorage.getItem(FOLDER_KEY) ?? 'INBOX');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<{ total: number; messages: MailSummaryView[] } | null>(null);
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState<MailMessageView | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void api().mail.googleReady().then(setGReady);
    void api()
      .mail.status()
      .then((s) => {
        setSt(s);
        // Account kept but its password is gone: only the password has to be typed again.
        if (!s.connected && s.account) {
          setForm({ ...EMPTY_ACCOUNT, ...s.account });
          setGuessed(s.account.email.split('@')[1] ?? '');
        }
      });
  }, []);

  const loadFolders = useCallback(() => {
    void api()
      .mail.folders()
      .then((fs) => {
        setFolders(sortFolders(fs));
        // A saved folder that no longer exists falls back to the inbox.
        setFolder((cur) =>
          fs.some((f) => f.path === cur)
            ? cur
            : (fs.find((f) => f.specialUse === '\\Inbox')?.path ?? fs[0]?.path ?? 'INBOX'),
        );
      })
      .catch((e: unknown) => toast(errText(e)));
  }, []);

  const loadList = useCallback(
    async (more = false) => {
      const next = more ? page + 1 : 0;
      try {
        const r = await api().mail.list(folder, next, search);
        setList((cur) =>
          more && cur ? { total: r.total, messages: [...cur.messages, ...r.messages] } : r,
        );
        setPage(next);
      } catch (e) {
        toast(errText(e));
        if (!more) setList({ total: 0, messages: [] });
      }
    },
    [folder, search, page],
  );

  useEffect(() => {
    if (st?.connected) loadFolders();
  }, [st?.connected, loadFolders]);

  useEffect(() => {
    if (!st?.connected) return;
    setList(null);
    void loadList();
    // Only a new folder or search reloads the list (not a new page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.connected, folder, search]);

  // New mail shows up on its own while the list is on screen.
  useEffect(() => {
    if (!st?.connected || msg || draft || page > 0) return;
    const id = setInterval(() => {
      void api()
        .mail.list(folder, 0, search)
        .then(setList)
        .catch(() => {});
      loadFolders();
    }, 60_000);
    return () => clearInterval(id);
  }, [st?.connected, msg, draft, page, folder, search, loadFolders]);

  /** Servers of a known provider; for any other domain, a guess (imap.domain / smtp.domain). */
  const fillPreset = async (email: string) => {
    const domain = email.trim().toLowerCase().split('@')[1];
    if (!domain || domain === guessed) return;
    setGuessed(domain);
    const p = await api().mail.preset(email);
    if (p) return setForm((f) => ({ ...p, name: f.name }));
    setForm((f) => ({
      ...f,
      user: email.trim(),
      imapHost: `imap.${domain}`,
      imapPort: 993,
      smtpHost: `smtp.${domain}`,
      smtpPort: 465,
    }));
    setServers(true);
  };

  const current = folders.find((f) => f.path === folder);
  const inDrafts = current?.specialUse === '\\Drafts';

  const connect = () =>
    void act('connect', async () => {
      const acc = { ...form, user: form.user || form.email };
      await api().mail.connect(acc, pass);
      setPass('');
      toast(t('mlConnected', { email: acc.email }));
      reset();
    });

  const googleLogin = () =>
    void act('google', async () => {
      const s = await api().mail.googleLogin(form.name || undefined);
      toast(t('mlConnected', { email: s.account?.email ?? '' }));
      reset();
    });

  const saveGoogleClient = () =>
    void act('gclient', async () => {
      await api().mail.setGoogleClient(gClient.id.trim(), gClient.secret.trim());
      setGReady(true);
      setGSetup(false);
    });

  const openMsg = (m: MailSummaryView) =>
    void act(`open:${m.uid}`, async () => {
      const full = await api().mail.open(folder, m.uid);
      // A saved draft opens in the composer, to keep writing it.
      if (current?.specialUse === '\\Drafts') {
        setDraft({
          to: full.to,
          cc: full.cc,
          subject: full.subject,
          text: full.text,
          references: full.references,
          draftUid: full.uid,
        });
        return;
      }
      setMsg(full);
      if (!m.seen) {
        setList(
          (cur) =>
            cur && {
              ...cur,
              messages: cur.messages.map((x) => (x.uid === m.uid ? { ...x, seen: true } : x)),
            },
        );
        loadFolders();
      }
    });

  const patchRow = (uid: number, p: Partial<MailSummaryView>) =>
    setList(
      (cur) =>
        cur && { ...cur, messages: cur.messages.map((x) => (x.uid === uid ? { ...x, ...p } : x)) },
    );

  const reply = (all: boolean) => {
    if (!msg) return;
    const me = st?.account?.email.toLowerCase();
    const cc = all
      ? [...addresses(msg.to), ...addresses(msg.cc)].filter(
          (a) => a !== me && !addresses(msg.replyTo).includes(a),
        )
      : [];
    setDraft({
      to: msg.replyTo,
      cc: cc.join(', '),
      subject: /^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`,
      text: `\n\n${t('mlWrote', { date: new Date(msg.date).toLocaleString(), from: msg.from })}\n${quote(msg.text)}`,
      inReplyTo: msg.messageId,
      references: [...msg.references, ...(msg.messageId ? [msg.messageId] : [])],
    });
  };

  const forward = () => {
    if (!msg) return;
    if (msg.attachments.length) toast(t('mlFwdNoAttach'));
    setDraft({
      to: '',
      cc: '',
      subject: /^fwd?:/i.test(msg.subject) ? msg.subject : `Fwd: ${msg.subject}`,
      text: `\n\n${t('mlFwdHeader')}\n${t('mlFrom')}: ${msg.from}\n${t('mlDate')}: ${new Date(msg.date).toLocaleString()}\n${t('mlSubject')}: ${msg.subject}\n${t('mlTo')}: ${msg.to}\n\n${msg.text}`,
    });
  };

  const send = () => {
    if (!draft) return;
    void act('send', async () => {
      await api().mail.send(draft);
      setDraft(null);
      toast(t('mlSent'));
      if (draft.draftUid) draftsChanged();
    });
  };

  /** Back to the list of the Drafts folder, refreshed (a draft was saved, sent or deleted there). */
  const draftsChanged = () => {
    loadFolders();
    if (inDrafts) void loadList();
  };

  const saveDraft = () => {
    if (!draft) return;
    void act('draft', async () => {
      await api().mail.saveDraft(draft);
      setDraft(null);
      toast(t('mlDraftSaved'));
      draftsChanged();
    });
  };

  const deleteDraft = () => {
    if (!draft?.draftUid || !confirm(t('mlDraftDeleteConfirm'))) return;
    const uid = draft.draftUid;
    void act('draft', async () => {
      await api().mail.deleteDraft(uid);
      setDraft(null);
      draftsChanged();
    });
  };

  const closeDraft = () => {
    const edited = !!draft && !!(draft.text.trim() || draft.subject.trim() || draft.to.trim());
    // A draft opened from the Drafts folder is already saved: closing just leaves it there.
    if (edited && !draft?.draftUid && !confirm(t('mlDiscard'))) return;
    setDraft(null);
  };

  const moveMsg = (uid: number, to: MailTarget, done: string) =>
    void act('move', async () => {
      await api().mail.move(folder, uid, to);
      setList(
        (cur) =>
          cur && { total: cur.total - 1, messages: cur.messages.filter((m) => m.uid !== uid) },
      );
      setMsg(null);
      toast(done);
      loadFolders();
    });

  const title = (
    <div className="sidebar-title">
      <span className="panel-title">{t('mlTitle').toUpperCase()}</span>
      <span className="sidebar-actions">
        {st?.connected && !draft && (
          <>
            <button
              title={t('mlCompose')}
              onClick={() => setDraft({ to: '', cc: '', subject: '', text: '' })}
            >
              <Icon name="edit" size={15} />
            </button>
            <button
              title={t('gitRefresh')}
              onClick={() => {
                loadFolders();
                void loadList();
              }}
            >
              <Icon name="refresh" size={15} />
            </button>
          </>
        )}
      </span>
    </div>
  );

  if (!st) {
    return (
      <div className="explorer">
        {title}
        <div className="git-clean">
          <Icon name="clock" size={13} className="spin-slow" /> {t('mlLoading')}
        </div>
      </div>
    );
  }

  const account = (
    <AccountSwitch
      icon={<Icon name="mail" size={12} />}
      label={st.account?.email ?? ''}
      title={st.account?.user}
      accounts={st.accounts.map((a) => ({ id: a.email, label: a.email }))}
      active={st.account?.email ?? null}
      busy={busy !== null}
      onUse={(email) =>
        void act('use', async () => {
          await api().mail.useAccount(email);
          reset();
        })
      }
      onAdd={() => {
        setForm(EMPTY_ACCOUNT);
        setPass('');
        setGuessed('');
        setServers(false);
        setAdding(true);
      }}
      onLogout={() => {
        if (confirm(t('mlLogoutConfirm', { email: st.account?.email ?? '' })))
          void act('logout', async () => {
            await api().mail.logout();
            reset();
          });
      }}
    />
  );

  if (!st.connected || adding) {
    const field = (key: keyof MailAccount, ph: string, type = 'text') => (
      <input
        type={type}
        value={String(form[key] ?? '')}
        placeholder={ph}
        spellCheck={false}
        onChange={(e) =>
          setForm({ ...form, [key]: type === 'number' ? Number(e.target.value) : e.target.value })
        }
      />
    );
    const ready =
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) &&
      !!pass &&
      !!form.imapHost.trim() &&
      !!form.smtpHost.trim();
    return (
      <div className="explorer">
        {title}
        {!adding && st.accounts.length > 1 && account}
        <div className="sidebar-empty vc-connect ml-connect">
          <p>
            {adding
              ? t('acctAddIntro')
              : st.account?.auth === 'google'
                ? t('mlGoogleAgain')
                : st.account
                  ? t('mlPassAgain')
                  : t('mlIntro')}
          </p>
          {gReady && !gSetup && (
            <button className="primary" disabled={busy !== null} onClick={googleLogin}>
              {busy === 'google' ? t('mlGoogleWaiting') : t('mlGoogle')}
            </button>
          )}
          {gReady === false && !gSetup && (
            <button onClick={() => setGSetup(true)}>{t('mlGoogleSetup')}</button>
          )}
          {gSetup && (
            <div className="ml-servers">
              <p className="vc-hint">{t('mlGoogleSetupHint')}</p>
              <button
                className="link"
                onClick={() => open('https://console.cloud.google.com/apis/credentials')}
              >
                {t('mlGoogleConsole')}
              </button>
              <input
                value={gClient.id}
                placeholder="Client ID (…apps.googleusercontent.com)"
                spellCheck={false}
                onChange={(e) => setGClient({ ...gClient, id: e.target.value })}
              />
              <input
                type="password"
                value={gClient.secret}
                placeholder="Client secret"
                onChange={(e) => setGClient({ ...gClient, secret: e.target.value })}
              />
              <div className="git-connect-actions">
                <button
                  className="primary"
                  disabled={gClient.id.trim().length < 10 || busy !== null}
                  onClick={saveGoogleClient}
                >
                  {busy === 'gclient' ? '…' : t('mlGoogleSave')}
                </button>
                <button onClick={() => setGSetup(false)}>{t('mlCancel')}</button>
              </div>
            </div>
          )}
          {gReady && !gSetup && (
            <button className="link" onClick={() => setGSetup(true)}>
              {t('mlGoogleChange')}
            </button>
          )}
          <p className="vc-hint">{t('mlOrPassword')}</p>
          <input
            type="email"
            value={form.email}
            placeholder={t('mlEmail')}
            spellCheck={false}
            onChange={(e) =>
              setForm({
                ...form,
                email: e.target.value,
                // The login follows the address unless it was changed by hand.
                user: !form.user || form.user === form.email ? e.target.value : form.user,
              })
            }
            onBlur={(e) => void fillPreset(e.target.value)}
          />
          <input
            type="password"
            value={pass}
            placeholder={t('mlPassword')}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ready && !busy) connect();
            }}
          />
          {field('name', t('mlName'))}
          <button className="link" onClick={() => setServers(!servers)}>
            {servers ? '▾' : '▸'} {t('mlServers')}
            {!servers && form.imapHost ? ` · ${form.imapHost}` : ''}
          </button>
          {servers && (
            <div className="ml-servers">
              {field('user', t('mlUser'))}
              <div className="ml-hostport">
                {field('imapHost', 'imap.servidor.com')}
                {field('imapPort', '993', 'number')}
              </div>
              <div className="ml-hostport">
                {field('smtpHost', 'smtp.servidor.com')}
                {field('smtpPort', '465', 'number')}
              </div>
            </div>
          )}
          <button className="primary" disabled={!ready || busy !== null} onClick={connect}>
            {busy === 'connect' ? '…' : t('mlConnect')}
          </button>
          {adding && (
            <button className="link" onClick={() => setAdding(false)}>
              {t('acctCancel')}
            </button>
          )}
          <p className="vc-hint">{t('mlAppPassHint')}</p>
          <button
            className="link"
            onClick={() => open('https://myaccount.google.com/apppasswords')}
          >
            {t('mlGmailPass')}
          </button>
        </div>
      </div>
    );
  }

  if (draft) {
    const set = (p: Partial<MailDraft>) => setDraft({ ...draft, ...p });
    return (
      <div className="explorer">
        {title}
        {account}
        <div className="vc-form ml-compose">
          <input
            value={draft.to}
            placeholder={t('mlTo')}
            spellCheck={false}
            autoFocus={!draft.to}
            onChange={(e) => set({ to: e.target.value })}
          />
          <input
            value={draft.cc ?? ''}
            placeholder={t('mlCc')}
            spellCheck={false}
            onChange={(e) => set({ cc: e.target.value })}
          />
          <input
            value={draft.subject}
            placeholder={t('mlSubject')}
            onChange={(e) => set({ subject: e.target.value })}
          />
          <textarea
            value={draft.text}
            placeholder={t('mlBody')}
            autoFocus={!!draft.to}
            onChange={(e) => set({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.to.trim()) send();
            }}
          />
          <div className="git-connect-actions">
            <button
              className="primary"
              disabled={!addresses(draft.to).length || busy !== null}
              onClick={send}
            >
              <Icon name="send" size={14} /> {busy === 'send' ? '…' : t('mlSend')}
            </button>
            <button disabled={busy !== null} onClick={saveDraft}>
              {busy === 'draft' ? '…' : t('mlSaveDraft')}
            </button>
            <button onClick={closeDraft}>{draft.draftUid ? t('mlClose') : t('mlCancel')}</button>
            {draft.draftUid && (
              <button title={t('mlDraftDelete')} disabled={busy !== null} onClick={deleteDraft}>
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (msg) {
    const role = current?.specialUse ?? null;
    const flagged = list?.messages.find((m) => m.uid === msg.uid)?.flagged ?? false;
    return (
      <div className="explorer">
        {title}
        <div className="git-branchbar ml-actions">
          <button title={t('mlBack')} onClick={() => setMsg(null)}>
            <Icon name="back" size={14} />
          </button>
          <span className="spacer" />
          <button title={t('mlReply')} onClick={() => reply(false)}>
            ↩
          </button>
          <button title={t('mlReplyAll')} onClick={() => reply(true)}>
            ↩↩
          </button>
          <button title={t('mlForward')} onClick={forward}>
            ↪
          </button>
          <button
            title={flagged ? t('mlUnstar') : t('mlStar')}
            onClick={() =>
              void act('flag', async () => {
                await api().mail.setFlag(folder, msg.uid, 'flagged', !flagged);
                patchRow(msg.uid, { flagged: !flagged });
              })
            }
          >
            {flagged ? '★' : '☆'}
          </button>
          <button
            title={t('mlUnread')}
            onClick={() =>
              void act('unread', async () => {
                await api().mail.setFlag(folder, msg.uid, 'seen', false);
                patchRow(msg.uid, { seen: false });
                setMsg(null);
                loadFolders();
              })
            }
          >
            <Icon name="mail" size={14} />
          </button>
          {role === '\\Junk' ? (
            <button
              title={t('mlNotSpam')}
              onClick={() => moveMsg(msg.uid, 'inbox', t('mlMovedInbox'))}
            >
              {t('mlNotSpam')}
            </button>
          ) : role === '\\Trash' ? (
            <button
              title={t('mlRestore')}
              onClick={() => moveMsg(msg.uid, 'inbox', t('mlMovedInbox'))}
            >
              {t('mlRestore')}
            </button>
          ) : (
            <>
              {role !== '\\All' && role !== '\\Archive' && (
                <button
                  title={t('mlArchive')}
                  onClick={() => moveMsg(msg.uid, 'archive', t('mlArchived'))}
                >
                  <Icon name="archive" size={14} />
                </button>
              )}
              {role !== '\\Sent' && role !== '\\Drafts' && (
                <button
                  title={t('mlSpam')}
                  onClick={() => moveMsg(msg.uid, 'junk', t('mlSpammed'))}
                >
                  <Icon name="warning" size={14} />
                </button>
              )}
            </>
          )}
          <button
            title={role === '\\Trash' ? t('mlDeleteForever') : t('mlTrash')}
            onClick={() => {
              if (!confirm(role === '\\Trash' ? t('mlDeleteForeverConfirm') : t('mlTrashConfirm')))
                return;
              void act('trash', async () => {
                await api().mail.trash(folder, msg.uid);
                setList(
                  (cur) =>
                    cur && {
                      total: cur.total - 1,
                      messages: cur.messages.filter((m) => m.uid !== msg.uid),
                    },
                );
                setMsg(null);
                toast(t('mlTrashed'));
                loadFolders();
              });
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
        <div className="ml-head">
          <div className="ml-subject">{msg.subject || t('mlNoSubject')}</div>
          <div className="ml-meta">
            <strong>{msg.from}</strong>
          </div>
          <div className="ml-meta">
            {t('mlTo')}: {msg.to}
            {msg.cc && ` · ${t('mlCc')}: ${msg.cc}`}
          </div>
          <div className="ml-meta">{new Date(msg.date).toLocaleString()}</div>
          {msg.attachments.length > 0 && (
            <div className="ml-attachments">
              {msg.attachments.map((a) => (
                <button
                  key={a.index}
                  title={`${a.contentType} · ${Math.ceil(a.size / 1024)} KB`}
                  onClick={() =>
                    void act('save', async () => {
                      const p = await api().mail.saveAttachment(folder, msg.uid, a.index);
                      if (p) toast(t('mlSaved', { path: p }));
                    })
                  }
                >
                  <Icon name="paperclip" size={12} /> {a.filename}
                </button>
              ))}
            </div>
          )}
        </div>
        {msg.html ? (
          <>
            {/* No scripts and no access to the app: the mail runs in an opaque, sandboxed frame. */}
            <iframe
              className="ml-body"
              title={msg.subject}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={srcDoc(msg.html)}
            />
            <div className="ml-note">{t('mlRemoteBlocked')}</div>
          </>
        ) : (
          <pre className="ml-body ml-text">{msg.text}</pre>
        )}
      </div>
    );
  }

  return (
    <div className="explorer">
      {title}
      {account}
      <div className="ml-folders">
        {(folders.length
          ? folders
          : [{ path: folder, name: folder, specialUse: null, unseen: 0, messages: 0 }]
        ).map((f) => {
          // Drafts show how many there are; the rest, how many are unread.
          const count = f.specialUse === '\\Drafts' ? f.messages : f.unseen;
          return (
            <button
              key={f.path}
              className={`ml-folder${f.path === folder ? ' active' : ''}`}
              title={f.path}
              onClick={() => {
                setFolder(f.path);
                setMsg(null);
                localStorage.setItem(FOLDER_KEY, f.path);
              }}
            >
              <span className="ml-folder-icon">
                <Icon name={FOLDER_ICON[f.specialUse ?? ''] ?? 'tag'} size={12} />
              </span>
              <span className="ml-folder-name">{folderName(f)}</span>
              {count > 0 && <span className="ml-folder-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="vc-toolbar">
        <input
          value={query}
          placeholder={t('mlSearch')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSearch(query.trim());
            if (e.key === 'Escape') {
              setQuery('');
              setSearch('');
            }
          }}
        />
      </div>
      <div className="tree git-list">
        <div className="git-group">
          <span>
            {current ? folderName(current) : folder}{' '}
            <span className="git-count">{list ? list.total : '…'}</span>
          </span>
        </div>
        {!list && (
          <div className="git-clean">
            <Icon name="clock" size={13} className="spin-slow" /> {t('mlLoading')}
          </div>
        )}
        {list?.messages.length === 0 && <div className="git-clean">{t('mlEmpty')}</div>}
        {list?.messages.map((m) => (
          <div
            key={m.uid}
            className={`ml-row${m.seen ? '' : ' unread'}${busy === `open:${m.uid}` ? ' busy' : ''}`}
            title={`${m.from}\n${m.subject}`}
            onClick={() => openMsg(m)}
          >
            <div className="ml-line">
              <span className="ml-from">
                {current?.specialUse === '\\Sent' || inDrafts
                  ? shortName(m.to) || t('mlNoRecipient')
                  : shortName(m.from)}
              </span>
              {m.flagged && <span className="ml-star">★</span>}
              {m.attachments && <Icon name="paperclip" size={11} />}
              <span className="ml-date">{when(m.date)}</span>
            </div>
            <div className="ml-subj">{m.subject || t('mlNoSubject')}</div>
          </div>
        ))}
        {list && list.messages.length < list.total && (
          <div className="sb-pager">
            <button className="link" onClick={() => void loadList(true)}>
              {t('mlMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
