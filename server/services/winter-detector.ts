/**
 * Winter Detector — scans email_messages for VoltSafe Winter mentions
 * and auto-creates winter_support_cases from matched emails.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export const WINTER_KEYWORDS = [
  "voltsafe winter", "vs winter", "winter charger", "winter pedestal",
  "winter unit", "winter product", "winter dock", "winter marina charger",
  "vs-w", "vsw-", "winter ev", "winter charging",
];

export const ISSUE_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /warranty|guarantee|covered|coverage/i,                type: "warranty" },
  { pattern: /not work|doesn.t work|broken|stopped|fail|error|won.t charge|won.t power/i, type: "troubleshooting" },
  { pattern: /replace|replacement|swap|new unit|send me/i,         type: "replacement" },
  { pattern: /complaint|terrible|awful|disappointed|refund|return|angry|frustrated/i, type: "complaint" },
  { pattern: /feature|wish|would be nice|suggestion|improve|add/i, type: "feature_request" },
  { pattern: /retailer|distributor|wholesale|resell|stock|carry|order for store/i, type: "retailer_inquiry" },
  { pattern: /reorder|order more|buy more|purchase again|want to buy/i, type: "reorder_interest" },
];

export const SEVERITY_PATTERNS: Array<{ pattern: RegExp; level: string }> = [
  { pattern: /urgent|asap|immediately|critical|fire|flooding|danger|safety/i, level: "critical" },
  { pattern: /important|serious|major|significant|broken|stopped working/i,   level: "high" },
  { pattern: /inconvenient|minor|small|question|wondering/i,                  level: "low" },
];

export const SENTIMENT_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /terrible|awful|worst|hate|useless|waste|fraud|scam/i, score: -80 },
  { pattern: /disappointed|frustrated|upset|unhappy|poor|bad/i,     score: -50 },
  { pattern: /problem|issue|concern|worried|confused/i,              score: -20 },
  { pattern: /okay|ok|fine|acceptable|average/i,                     score: 0  },
  { pattern: /good|nice|decent|works well|satisfied/i,               score: 30 },
  { pattern: /great|excellent|love|amazing|perfect|fantastic/i,      score: 70 },
];

export function isWinterEmail(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  return WINTER_KEYWORDS.some(kw => text.includes(kw));
}

export function classifyIssueType(subject: string, body: string): string {
  const text = `${subject} ${body}`;
  for (const { pattern, type } of ISSUE_TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "general";
}

export function classifySeverity(subject: string, body: string): string {
  const text = `${subject} ${body}`;
  for (const { pattern, level } of SEVERITY_PATTERNS) {
    if (pattern.test(text)) return level;
  }
  return "medium";
}

export function scoreSentiment(subject: string, body: string): number {
  const text = `${subject} ${body}`;
  let score = 0;
  let matched = 0;
  for (const { pattern, score: s } of SENTIMENT_PATTERNS) {
    if (pattern.test(text)) { score += s; matched++; }
  }
  return matched > 0 ? Math.round(score / matched) : 0;
}

export function generateCaseNumber(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `WIN-${yy}${mm}-${rand}`;
}

interface EmailRow {
  id: number;
  gmail_message_id: string;
  gmail_thread_id: string;
  subject: string;
  body_text: string;
  from_email: string;
  from_name: string;
  received_at: string;
}

/**
 * Scans unprocessed emails for Winter mentions and creates cases.
 * Returns count of new cases created.
 */
export async function scanEmailsForWinter(limitHours = 720): Promise<{
  scanned: number;
  created: number;
  skipped: number;
  cases: any[];
}> {
  const cutoff = new Date(Date.now() - limitHours * 60 * 60 * 1000).toISOString();

  const emailResult = await db.execute(sql.raw(`
    SELECT id, gmail_message_id, gmail_thread_id, subject, body_text,
           from_email, from_name, received_at
    FROM email_messages
    WHERE direction = 'inbound'
      AND received_at > '${cutoff}'
      AND from_email NOT ILIKE '%@voltsafe.com%'
    ORDER BY received_at DESC
    LIMIT 500
  `));

  const emails: EmailRow[] = (emailResult as any).rows ?? [];
  let created = 0;
  let skipped = 0;
  const createdCases: any[] = [];

  for (const email of emails) {
    const subject = email.subject ?? "";
    const body = email.body_text ?? "";

    if (!isWinterEmail(subject, body)) { skipped++; continue; }

    const existsResult = await db.execute(sql.raw(`
      SELECT id FROM winter_support_cases WHERE gmail_thread_id = '${String(email.gmail_thread_id ?? "").replace(/'/g, "''")}'
      LIMIT 1
    `));
    if ((existsResult as any).rows?.length > 0) { skipped++; continue; }

    const issueType   = classifyIssueType(subject, body);
    const severity    = classifySeverity(subject, body);
    const sentiment   = scoreSentiment(subject, body);
    const caseNumber  = generateCaseNumber();
    const excerpt     = body.slice(0, 500).replace(/'/g, "''");
    const subjectSafe = String(subject).replace(/'/g, "''").slice(0, 255);
    const nameSafe    = String(email.from_name ?? "").replace(/'/g, "''").slice(0, 100);
    const emailSafe   = String(email.from_email ?? "").replace(/'/g, "''").slice(0, 200);
    const threadSafe  = String(email.gmail_thread_id ?? "").replace(/'/g, "''");

    const insertResult = await db.execute(sql.raw(`
      INSERT INTO winter_support_cases
        (case_number, customer_name, customer_email, gmail_thread_id,
         issue_type, severity, sentiment_score, subject, body_excerpt,
         auto_detected, status, tags)
      VALUES
        ('${caseNumber}', '${nameSafe}', '${emailSafe}', '${threadSafe}',
         '${issueType}', '${severity}', ${sentiment}, '${subjectSafe}', '${excerpt}',
         true, 'open', ARRAY['auto-detected','winter'])
      RETURNING *
    `));

    const c = (insertResult as any).rows?.[0];
    if (c) { createdCases.push(c); created++; }
  }

  return { scanned: emails.length, created, skipped: emails.length - created, cases: createdCases };
}
