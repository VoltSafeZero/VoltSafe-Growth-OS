import { db } from "../db";
import { emailAttachments } from "../../shared/schema";
import type { ParsedAttachment } from "./email-parser";

export async function insertAttachmentsForMessage(messageId: number, attachments: ParsedAttachment[]): Promise<number> {
  if (!attachments || attachments.length === 0) return 0;
  const rows = attachments.map(a => ({
    messageId,
    gmailAttachmentId: a.gmailAttachmentId,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    contentId: a.contentId,
    isInline: a.isInline,
    partId: a.partId,
  }));
  await db.insert(emailAttachments).values(rows);
  return rows.length;
}
