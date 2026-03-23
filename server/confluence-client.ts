// Confluence integration — uses Replit connector (connection:conn_confluence_01KMDWJVXP6NNV51C1RJTSTXE7)
import { ConfluenceClient } from 'confluence.js';

let connectionSettings: any = null;

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
  const hostName = connectionSettings?.settings?.site_url;

  if (!connectionSettings || !accessToken || !hostName) {
    connectionSettings = null;
    throw new Error('Confluence not connected');
  }

  return { accessToken, hostName };
}

async function getAccessToken() {
  // Use cached token only if it hasn't expired yet
  if (
    connectionSettings &&
    connectionSettings.settings?.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now() + 60_000
  ) {
    const accessToken =
      connectionSettings.settings.access_token ||
      connectionSettings.settings?.oauth?.credentials?.access_token;
    const hostName = connectionSettings.settings.site_url;
    if (accessToken && hostName) return { accessToken, hostName };
  }

  // Cache is stale or missing — fetch fresh from Replit connectors
  return fetchConnectionSettings();
}

// WARNING: Never cache this client — tokens expire.
// On 401, clears cache and retries once automatically.
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
}
