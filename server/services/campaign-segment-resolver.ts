import { db } from "../db";
import { sql } from "drizzle-orm";

export interface FilterClause {
  id?: string;
  field: string;
  operator: string;
  value: string;
}

export interface ResolvedCandidate {
  contactId: number;
  accountId: number | null;
  name: string;
  email: string | null;
  title: string | null;
  roleType: string | null;
  accountName: string | null;
  marinaPersona: string | null;
  adoptionStage: string | null;
  primaryPain: string | null;
  region: string | null;
  stateProvince: string | null;
  country: string | null;
  doNotEmail: boolean;
  emailBounced: boolean;
  emailUnsubscribed: boolean;
}

export interface RecipientResult {
  contactId: number;
  accountId: number | null;
  name: string;
  email: string;
  title: string | null;
  roleType: string | null;
  accountName: string | null;
  marinaPersona: string | null;
  adoptionStage: string | null;
  primaryPain: string | null;
  region: string | null;
  status: "eligible" | "excluded" | "already_enrolled";
  exclusionReason: string | null;
}

export interface ResolveResult {
  recipients: RecipientResult[];
  totalMatched: number;
  eligibleCount: number;
  excludedCount: number;
  alreadyEnrolledCount: number;
  exclusionBreakdown: Record<string, number>;
}

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

function normDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^@/, "");
}

function domainOf(email: string): string {
  const parts = email.split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : "";
}

function isValidEmail(email: string): boolean {
  return email.includes("@") && domainOf(email).includes(".");
}

function isInternalEmail(email: string): boolean {
  const dom = domainOf(email);
  return dom === "voltsafe.com" || dom === "voltsafe.test";
}

function buildWhereClause(filters: FilterClause[]): string {
  const parts: string[] = [];

  for (const f of filters) {
    const val = f.value?.trim() ?? "";
    switch (f.field) {
      case "marina_persona":
        if (val) parts.push(`a.marina_persona = ${sqlStr(val)}`);
        break;
      case "adoption_stage":
        if (val) parts.push(`a.adoption_stage = ${sqlStr(val)}`);
        break;
      case "primary_pain":
        if (val) parts.push(`a.primary_pain = ${sqlStr(val)}`);
        break;
      case "state_province":
        if (val) parts.push(`a.state_province ILIKE ${sqlStr("%" + val + "%")}`);
        break;
      case "country":
        if (val) parts.push(`a.country ILIKE ${sqlStr("%" + val + "%")}`);
        break;
      case "city":
        if (val) parts.push(`a.city ILIKE ${sqlStr("%" + val + "%")}`);
        break;
      case "slip_count_gte": {
        const n = parseInt(val, 10);
        if (!isNaN(n)) parts.push(`a.slip_count >= ${n}`);
        break;
      }
      case "lead_status":
        if (val) parts.push(`a.lead_status = ${sqlStr(val)}`);
        break;
      case "ownership_type":
        if (val) parts.push(`a.ownership_type = ${sqlStr(val)}`);
        break;
      case "no_activity_days": {
        const n = parseInt(val, 10);
        if (!isNaN(n)) parts.push(`(a.last_interaction_at IS NULL OR a.last_interaction_at < NOW() - INTERVAL '${n} days')`);
        break;
      }
      case "contact_role":
        if (val) parts.push(`(c.role_type ILIKE ${sqlStr("%" + val + "%")} OR c.title ILIKE ${sqlStr("%" + val + "%")})`);
        break;
      case "has_email":
        parts.push(`(c.email IS NOT NULL AND c.email != '')`);
        break;
      case "not_unsubscribed":
        parts.push(`(c.email_unsubscribed = false OR c.email_unsubscribed IS NULL)`);
        break;
      case "not_bounced":
        parts.push(`(c.email_bounced = false OR c.email_bounced IS NULL)`);
        break;
      case "not_suppressed":
        break;
    }
  }

  return parts.length > 0 ? "AND " + parts.join(" AND ") : "";
}

function sqlStr(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

export async function resolveSegmentRecipients(
  campaignId: number,
  filtersJson: FilterClause[] | null,
  previewLimit = 5000
): Promise<ResolveResult> {
  const filters: FilterClause[] = Array.isArray(filtersJson) ? filtersJson : [];
  const whereExtra = buildWhereClause(filters);

  const candidateRows = await db.execute<{
    contact_id: number;
    account_id: number | null;
    name: string;
    email: string | null;
    title: string | null;
    role_type: string | null;
    account_name: string | null;
    marina_persona: string | null;
    adoption_stage: string | null;
    primary_pain: string | null;
    region: string | null;
    state_province: string | null;
    country: string | null;
    do_not_email: boolean;
    email_bounced: boolean;
    email_unsubscribed: boolean;
  }>(sql.raw(`
    SELECT
      c.id               AS contact_id,
      c.account_id,
      c.name,
      c.email,
      c.title,
      c.role_type,
      a.name             AS account_name,
      a.marina_persona,
      a.adoption_stage,
      a.primary_pain,
      a.region,
      a.state_province,
      a.country,
      c.do_not_email,
      c.email_bounced,
      c.email_unsubscribed
    FROM contacts c
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE 1=1
    ${whereExtra}
    LIMIT ${previewLimit}
  `));

  const suppRows = await db.execute<{ email: string | null; domain: string | null }>(
    sql.raw(`SELECT email, domain FROM campaign_suppression`)
  );
  const suppressedEmails = new Set<string>();
  const suppressedDomains = new Set<string>();
  for (const row of suppRows.rows) {
    if (row.email) suppressedEmails.add(normEmail(row.email));
    if (row.domain) suppressedDomains.add(normDomain(row.domain));
  }

  const enrolledRows = await db.execute<{ email: string }>(
    sql.raw(`SELECT email FROM campaign_recipients WHERE campaign_id = ${campaignId}`)
  );
  const alreadyEnrolledEmails = new Set<string>(
    enrolledRows.rows.map(r => normEmail(r.email))
  );

  const results: RecipientResult[] = [];
  const seenEmails = new Set<string>();
  const exclusionBreakdown: Record<string, number> = {};

  function bump(reason: string) {
    exclusionBreakdown[reason] = (exclusionBreakdown[reason] ?? 0) + 1;
  }

  for (const row of candidateRows.rows) {
    const raw: ResolvedCandidate = {
      contactId: row.contact_id,
      accountId: row.account_id ?? null,
      name: row.name,
      email: row.email ?? null,
      title: row.title ?? null,
      roleType: row.role_type ?? null,
      accountName: row.account_name ?? null,
      marinaPersona: row.marina_persona ?? null,
      adoptionStage: row.adoption_stage ?? null,
      primaryPain: row.primary_pain ?? null,
      region: row.region ?? null,
      stateProvince: row.state_province ?? null,
      country: row.country ?? null,
      doNotEmail: !!row.do_not_email,
      emailBounced: !!row.email_bounced,
      emailUnsubscribed: !!row.email_unsubscribed,
    };

    const base: Omit<RecipientResult, "status" | "exclusionReason"> = {
      contactId: raw.contactId,
      accountId: raw.accountId,
      name: raw.name,
      email: raw.email ?? "",
      title: raw.title,
      roleType: raw.roleType,
      accountName: raw.accountName,
      marinaPersona: raw.marinaPersona,
      adoptionStage: raw.adoptionStage,
      primaryPain: raw.primaryPain,
      region: raw.region,
    };

    const exclude = (reason: string) => {
      bump(reason);
      results.push({ ...base, status: "excluded", exclusionReason: reason });
    };

    if (!raw.email || raw.email.trim() === "") {
      exclude("missing_email");
      continue;
    }

    const normE = normEmail(raw.email);
    const domain = domainOf(normE);
    base.email = normE;

    if (!isValidEmail(normE)) {
      exclude("invalid_email");
      continue;
    }
    if (isInternalEmail(normE)) {
      exclude("internal_voltsafe_email");
      continue;
    }
    if (raw.doNotEmail) {
      exclude("do_not_email");
      continue;
    }
    if (raw.emailBounced) {
      exclude("bounced");
      continue;
    }
    if (raw.emailUnsubscribed) {
      exclude("unsubscribed");
      continue;
    }
    if (suppressedEmails.has(normE)) {
      exclude("suppressed_email");
      continue;
    }
    if (domain && suppressedDomains.has(domain)) {
      exclude("suppressed_domain");
      continue;
    }
    if (alreadyEnrolledEmails.has(normE)) {
      bump("already_enrolled");
      results.push({ ...base, status: "already_enrolled", exclusionReason: "already_enrolled" });
      continue;
    }
    if (seenEmails.has(normE)) {
      exclude("duplicate_email");
      continue;
    }

    seenEmails.add(normE);
    results.push({ ...base, status: "eligible", exclusionReason: null });
  }

  const eligibleCount = results.filter(r => r.status === "eligible").length;
  const alreadyEnrolledCount = results.filter(r => r.status === "already_enrolled").length;
  const excludedCount = results.filter(r => r.status === "excluded").length;

  return {
    recipients: results,
    totalMatched: candidateRows.rows.length,
    eligibleCount,
    excludedCount,
    alreadyEnrolledCount,
    exclusionBreakdown,
  };
}
