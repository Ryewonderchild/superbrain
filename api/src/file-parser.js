import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export async function textFromUpload(file) {
  const name = file.originalname.toLowerCase();
  if (file.mimetype === "application/pdf" || name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: file.buffer });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (
    file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || name.endsWith(".docx")
  ) {
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  if (
    file.mimetype.startsWith("text/")
    || file.mimetype === "application/json"
    || [".md", ".txt", ".csv", ".json"].some((extension) => name.endsWith(extension))
  ) {
    return file.buffer.toString("utf8");
  }
  return "";
}
