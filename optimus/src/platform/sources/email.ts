import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { AccessError, type EmailSource } from '../../core/sources/types';
import type { EmailMessage } from '../../core/types';
import { b64urlEncode, buildRfc822, fromGmail, fromGraph, gmailQuery, type GraphMessage } from '../../core/email/format';
import { oauthTokens } from '../secrets';

/**
 * Email via OAuth: Gmail (Google Sign-In + Gmail REST) and Outlook
 * (Microsoft identity platform + Graph). Tokens live in secure storage.
 * Personal data only goes to Google/Microsoft (the user's own mail
 * providers) and, in snippets, to Claude via the proxy.
 */

WebBrowser.maybeCompleteAuthSession();

const extra = (Constants.expoConfig?.extra ?? {}) as { googleWebClientId?: string; microsoftClientId?: string };
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
const GRAPH_SCOPES = ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Mail.Send'];
const MS_DISCOVERY = 'https://login.microsoftonline.com/common/v2.0';

interface MsTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

// ---------- Gmail ----------

let googleConfigured = false;
function configureGoogle() {
  if (googleConfigured) return;
  GoogleSignin.configure({ scopes: GMAIL_SCOPES, webClientId: extra.googleWebClientId || undefined, offlineAccess: false });
  googleConfigured = true;
}

export async function connectGmail(): Promise<string> {
  configureGoogle();
  await GoogleSignin.hasPlayServices();
  let res: Awaited<ReturnType<typeof GoogleSignin.signIn>>;
  try {
    res = await GoogleSignin.signIn();
  } catch (e) {
    // DEVELOPER_ERROR means Google doesn't know this app yet: the one-time Google Cloud setup is missing.
    if (/DEVELOPER_ERROR|10:/.test(String((e as { code?: unknown; message?: string })?.code ?? '') + String((e as Error)?.message ?? ''))) {
      throw new Error('Gmail needs a one-time Google setup before it can connect (SETUP_CHECKLIST.md, section 4). Everything else works without it.');
    }
    throw e;
  }
  if (res.type !== 'success') throw new Error('Google sign-in was cancelled.');
  return res.data.user.email;
}

export async function disconnectGmail(): Promise<void> {
  configureGoogle();
  await GoogleSignin.signOut().catch(() => null);
}

async function gmailToken(): Promise<string | null> {
  configureGoogle();
  if (!GoogleSignin.hasPreviousSignIn()) return null;
  const silent = await GoogleSignin.signInSilently();
  if (silent.type !== 'success') return null;
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

async function gmailFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (res.status === 401) throw new AccessError('email', 'not-connected', 'Gmail sign-in expired');
  if (!res.ok) throw new Error(`Gmail error ${res.status}`);
  return res.json();
}

async function gmailGet(token: string, id: string): Promise<EmailMessage & { messageIdHeader?: string }> {
  return fromGmail(await gmailFetch(token, `messages/${id}?format=full`));
}

// ---------- Outlook ----------

export async function connectOutlook(): Promise<void> {
  if (!extra.microsoftClientId) throw new Error('Outlook isn’t set up yet: add the Microsoft client ID (see SETUP_CHECKLIST.md).');
  const discovery = await AuthSession.fetchDiscoveryAsync(MS_DISCOVERY);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'optimus', path: 'oauth' });
  const request = new AuthSession.AuthRequest({ clientId: extra.microsoftClientId, scopes: GRAPH_SCOPES, redirectUri, usePKCE: true });
  const result = await request.promptAsync(discovery);
  if (result.type !== 'success') throw new Error('Microsoft sign-in was cancelled.');
  const tokens = await AuthSession.exchangeCodeAsync(
    { clientId: extra.microsoftClientId, code: result.params.code, redirectUri, extraParams: { code_verifier: request.codeVerifier ?? '' } },
    discovery,
  );
  await oauthTokens.set('outlook', { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000 } satisfies MsTokens);
}

export async function disconnectOutlook(): Promise<void> {
  await oauthTokens.remove('outlook');
}

async function outlookToken(): Promise<string | null> {
  const t = await oauthTokens.get<MsTokens>('outlook');
  if (!t) return null;
  if (t.expiresAt - 60_000 > Date.now()) return t.accessToken;
  if (!t.refreshToken || !extra.microsoftClientId) return null;
  const discovery = await AuthSession.fetchDiscoveryAsync(MS_DISCOVERY);
  const fresh = await AuthSession.refreshAsync({ clientId: extra.microsoftClientId, refreshToken: t.refreshToken, scopes: GRAPH_SCOPES }, discovery);
  const next: MsTokens = { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken ?? t.refreshToken, expiresAt: Date.now() + (fresh.expiresIn ?? 3600) * 1000 };
  await oauthTokens.set('outlook', next);
  return next.accessToken;
}

async function graph(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (res.status === 401) throw new AccessError('email', 'not-connected', 'Outlook sign-in expired');
  if (!res.ok) throw new Error(`Outlook error ${res.status}`);
  return res.status === 202 || res.status === 204 ? null : res.json();
}

// ---------- Combined source ----------

export function createEmailSource(): EmailSource {
  async function tokens() {
    const [g, o] = await Promise.all([gmailToken().catch(() => null), outlookToken().catch(() => null)]);
    if (!g && !o) throw new AccessError('email', 'not-connected');
    return { g, o };
  }

  return {
    async accounts() {
      const { g, o } = await tokens().catch(() => ({ g: null, o: null }));
      return [...(g ? (['gmail'] as const) : []), ...(o ? (['outlook'] as const) : [])];
    },

    async search(q) {
      const { g, o } = await tokens();
      const limit = q.limit ?? 15;
      const results: EmailMessage[] = [];
      if (g) {
        const list = await gmailFetch(g, `messages?maxResults=${limit}&q=${encodeURIComponent(gmailQuery(q))}`);
        for (const { id } of list.messages ?? []) results.push(await gmailGet(g, id));
      }
      if (o) {
        const filters = [q.unreadOnly ? 'isRead eq false' : '', q.since ? `receivedDateTime ge ${new Date(q.since).toISOString()}` : '', q.until ? `receivedDateTime le ${new Date(q.until).toISOString()}` : '', q.from ? `from/emailAddress/address eq '${q.from.replace(/'/g, "''")}'` : ''].filter(Boolean);
        const params = [`$top=${limit}`, '$select=id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,importance'];
        if (q.query) params.push(`$search="${encodeURIComponent(q.query.replace(/"/g, ''))}"`);
        else params.push('$orderby=receivedDateTime desc');
        if (filters.length && !q.query) params.push(`$filter=${encodeURIComponent(filters.join(' and '))}`);
        const res = await graph(o, `mailFolders/inbox/messages?${params.join('&')}`);
        let items = ((res?.value ?? []) as GraphMessage[]).map(fromGraph);
        if (q.query) items = items.filter((m) => (!q.unreadOnly || m.unread) && (!q.since || m.date >= q.since) && (!q.from || m.from === q.from));
        results.push(...items);
      }
      return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
    },

    async get(id) {
      const { g, o } = await tokens();
      if (id.startsWith('gmail:') && g) return gmailGet(g, id.slice(6));
      if (id.startsWith('outlook:') && o) {
        const m = (await graph(o, `messages/${id.slice(8)}`)) as GraphMessage;
        return fromGraph(m);
      }
      return null;
    },

    async send(draft) {
      const { g, o } = await tokens();
      const replyTo = draft.inReplyToId;
      const useOutlook = replyTo ? replyTo.startsWith('outlook:') : !g && !!o;
      if (useOutlook && o) {
        if (replyTo) {
          await graph(o, `messages/${replyTo.slice(8)}/reply`, { method: 'POST', body: JSON.stringify({ message: { toRecipients: draft.to.map((a) => ({ emailAddress: { address: a } })) }, comment: draft.body }) });
        } else {
          await graph(o, 'sendMail', { method: 'POST', body: JSON.stringify({ message: { subject: draft.subject, body: { contentType: 'Text', content: draft.body }, toRecipients: draft.to.map((a) => ({ emailAddress: { address: a } })) } }) });
        }
        return { id: `outlook:sent:${Date.now()}` };
      }
      if (!g) throw new AccessError('email', 'not-connected');
      const original = replyTo?.startsWith('gmail:') ? await gmailGet(g, replyTo.slice(6)) : null;
      const raw = b64urlEncode(buildRfc822(draft, original ?? undefined));
      const sent = await gmailFetch(g, 'messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(original ? { threadId: original.threadId } : {}) }) });
      return { id: `gmail:${sent.id}` };
    },
  };
}
