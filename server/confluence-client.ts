// Confluence integration — uses Replit connector (connection:conn_confluence_01KMDWJVXP6NNV51C1RJTSTXE7)
// NOTE: Atlassian OAuth 2.0 tokens require api.atlassian.com/ex/confluence/{cloudId} as the host,
// NOT the site URL (voltsafe.atlassian.net). Using the site URL causes 401 errors.
import { ConfluenceClient } from 'confluence.js';

let connectionSettings: any = null;
let cloudId: string | null = null;

async function fetchConnectionSettings() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) throw new Error('X-Replit-Token not found for repl/depl');

  const data = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=confluence',
    { headers: { Accept: 'application/json', 'X-Replit-Token': xReplitToken } }
  ).then((res) => res.json());

  connectionSettings = data.items?.[0];

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    connectionSettings = null;
    throw new Error('Confluence not connected');
  }

  // Resolve the cloud ID via Atlassian's accessible-resources if not yet cached
  if (!cloudId) {
    const resources = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
    }).then((r) => r.json());
    const site = Array.isArray(resources) ? resources[0] : null;
    if (!site?.id) throw new Error('Confluence: could not resolve cloud ID');
    cloudId = site.id;
  }

  // The correct host for OAuth 2.0 tokens is api.atlassian.com/ex/confluence/{cloudId}
  const hostName = `https://api.atlassian.com/ex/confluence/${cloudId}`;
  return { accessToken, hostName };
}

async function getAccessToken() {
  if (
    connectionSettings &&
    connectionSettings.settings?.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now() + 60_000
  ) {
    const accessToken =
      connectionSettings.settings.access_token ||
      connectionSettings.settings?.oauth?.credentials?.access_token;
    if (accessToken && cloudId) {
      return { accessToken, hostName: `https://api.atlassian.com/ex/confluence/${cloudId}` };
    }
  }
  return fetchConnectionSettings();
}

// WARNING: Never cache this client — tokens expire.
export async function getUncachableConfluenceClient() {
  const { accessToken, hostName } = await getAccessToken();
  return new ConfluenceClient({
    host: hostName,
    authentication: { oauth2: { accessToken } },
  });
}

// Call this when a Confluence API call gets a 401 to force a token refresh on the next call
export function invalidateConfluenceToken() {
  connectionSettings = null;
  cloudId = null;
}
