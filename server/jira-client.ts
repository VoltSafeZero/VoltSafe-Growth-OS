// Jira integration — uses Replit connector (connection:conn_jira_01KMDWB1XHKVX8843KR8G3P12Y)
import { Version3Client } from 'jira.js';

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
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=jira',
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
    throw new Error('Jira not connected');
  }

  return { accessToken, hostName };
}

// WARNING: Never cache this client — tokens expire.
export async function getUncachableJiraClient() {
  const { accessToken, hostName } = await getAccessToken();
  return new Version3Client({
    host: hostName,
    authentication: { oauth2: { accessToken } },
  });
}
