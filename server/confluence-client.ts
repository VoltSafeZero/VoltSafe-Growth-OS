// Confluence integration — uses Replit connector (connection:conn_confluence_01KMDWJVXP6NNV51C1RJTSTXE7)
import { ConfluenceClient } from 'confluence.js';

let connectionSettings: any;

async function getAccessToken() {
  if (
    connectionSettings &&
    connectionSettings.settings.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return {
      accessToken: connectionSettings.settings.access_token,
      hostName: connectionSettings.settings.site_url,
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) throw new Error('X-Replit-Token not found for repl/depl');

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=confluence',
    {
      headers: { Accept: 'application/json', 'X-Replit-Token': xReplitToken },
    }
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;
  const hostName = connectionSettings?.settings?.site_url;

  if (!connectionSettings || !accessToken || !hostName) {
    throw new Error('Confluence not connected');
  }

  return { accessToken, hostName };
}

// WARNING: Never cache this client — tokens expire.
export async function getUncachableConfluenceClient() {
  const { accessToken, hostName } = await getAccessToken();
  return new ConfluenceClient({
    host: hostName,
    authentication: { oauth2: { accessToken } },
  });
}
