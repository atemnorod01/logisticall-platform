import { unzipSync, strFromU8 } from "fflate";
export const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export function attachmentMime(name: string, declared: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "webm" && declared.split(";")[0] === "audio/webm") return "audio/webm";
  const known: Record<string, string> = {
    docx: DOCX,
    xlsx: XLSX,
    csv: "text/csv",
    txt: "text/plain",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  return known[extension ?? ""] ?? declared;
}
export function validateOffice(data: Uint8Array, mime: string): boolean {
  if (mime !== DOCX && mime !== XLSX) return false;
  const main = mime === DOCX ? "word/document.xml" : "xl/workbook.xml";
  try {
    let total = 0,
      entries = 0;
    const content = unzipSync(data, {
      filter: (entry) => {
        total += entry.originalSize;
        entries++;
        if (
          total > 64 * 1024 * 1024 ||
          entry.originalSize > 16 * 1024 * 1024 ||
          entries > 3000 ||
          /vbaProject|\.bin$/i.test(entry.name)
        )
          throw Error("Unsupported office archive");
        return entry.name === main || entry.name === "[Content_Types].xml";
      },
    });
    return (
      !!content[main] &&
      !!content["[Content_Types].xml"] &&
      /<(?:\w+:)?(?:document|workbook)\b/.test(strFromU8(content[main]!))
    );
  } catch {
    return false;
  }
}
