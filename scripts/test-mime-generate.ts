/**
 * Called by tests/mime-output.test.cjs via execSync("npx tsx scripts/test-mime-generate.ts").
 * Outputs a single JSON line to stdout containing decoded raw MIME strings for each
 * test case so the CJS test can parse and assert on the actual MIME structure.
 */
import { buildMimeRawDebug } from "../server/gmail.js";

const FROM = "sender@test.com";
const TO   = "to@test.com";
const SUBJ = "MIME Test";

// Minimal PNG bytes so the Buffer is non-empty.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const img1: Parameters<typeof buildMimeRawDebug>[8][0] = {
  cid: "vsigtest1abc", mimeType: "image/png", data: PNG, filename: "logo.png",
};
const img2: Parameters<typeof buildMimeRawDebug>[8][0] = {
  cid: "vsigtest2abc", mimeType: "image/jpeg", data: PNG, filename: "watch-demo.jpg",
};
const att1: Parameters<typeof buildMimeRawDebug>[4][0] = {
  name: "doc.pdf", mimeType: "application/pdf", data: PNG,
};

// Case A — no inline images, no attachments → multipart/alternative
const caseA = buildMimeRawDebug(FROM, TO, SUBJ, "<p>Hello</p>", [], undefined, undefined, undefined, []);

// Case B1 — one inline image, no attachments → multipart/related (root)
const caseB1 = buildMimeRawDebug(
  FROM, TO, SUBJ,
  `<p>Hi</p><!--vs-sig-start--><img src="cid:vsigtest1abc"/><!--vs-sig-end-->`,
  [], undefined, undefined, undefined, [img1],
);

// Case B2 — two inline images, no attachments → multipart/related (root) + 2 CID parts
const caseB2 = buildMimeRawDebug(
  FROM, TO, SUBJ,
  `<p>Hi</p><!--vs-sig-start--><img src="cid:vsigtest1abc"/><img src="cid:vsigtest2abc"/><!--vs-sig-end-->`,
  [], undefined, undefined, undefined, [img1, img2],
);

// Case C — one inline image + one real attachment → mixed → [related → [html, CID], att]
const caseC = buildMimeRawDebug(
  FROM, TO, SUBJ,
  `<p>See below</p><!--vs-sig-start--><img src="cid:vsigtest1abc"/><!--vs-sig-end-->`,
  [att1], undefined, undefined, undefined, [img1],
);

// Case D — attachment only, no inline images → mixed → [alternative → [plain, html], att]
const caseD = buildMimeRawDebug(
  FROM, TO, SUBJ,
  "<p>See attachment</p>",
  [att1], undefined, undefined, undefined, [],
);

process.stdout.write(JSON.stringify({ caseA, caseB1, caseB2, caseC, caseD }) + "\n");
