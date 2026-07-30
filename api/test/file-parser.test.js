import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { textFromUpload } from "../src/file-parser.js";

function upload(originalname, mimetype, buffer) {
  return { originalname, mimetype, buffer };
}

function simplePdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test("parses plain text formats", async () => {
  assert.equal(await textFromUpload(upload("note.md", "text/markdown", Buffer.from("# 标题\n正文"))), "# 标题\n正文");
  assert.equal(await textFromUpload(upload("data.json", "application/json", Buffer.from('{"ok":true}'))), '{"ok":true}');
});

test("parses PDF text", async () => {
  const text = await textFromUpload(upload("sample.pdf", "application/pdf", simplePdf("PDF parser test")));
  assert.match(text, /PDF parser test/);
});

test("parses DOCX text", async () => {
  const fixture = fileURLToPath(new URL("../../node_modules/mammoth/test/test-data/simple-list.docx", import.meta.url));
  const text = await textFromUpload(upload(
    "sample.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    await readFile(fixture)
  ));
  assert.ok(text.trim().length > 0);
});

test("rejects unsupported binary formats", async () => {
  assert.equal(await textFromUpload(upload("archive.zip", "application/zip", Buffer.from("zip"))), "");
});
