// The PDF that goes with a "statement ready" email, made from the figures the
// database put in the queued email (this member's own part of the saved
// statement). Relative imports with .ts extensions so the tests can run it in
// plain Node.
import type { CostStatement } from "../costs.ts";
import { LONDON_TZ, londonDateKey } from "../datetime.ts";
import { buildStatementPdf } from "../statement-pdf.ts";
import { statementPdfInput } from "../statement-pdf-input.ts";
import type { QueuedNotification } from "./email.ts";

const stampFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// null for any other email, or if the PDF cannot be made (the email then goes
// out without it).
export async function statementAttachment(
  n: QueuedNotification,
  now: Date = new Date(),
): Promise<{ filename: string; content: string } | null> {
  if (n.event !== "statement_ready") return null;
  try {
    const statement = n.payload as unknown as CostStatement;
    const member = statement.members?.[0];
    const month = String(statement.month ?? "").slice(0, 7);
    if (!member || !/^\d{4}-\d{2}$/.test(month)) return null;
    const registration =
      typeof n.payload.registration === "string" && n.payload.registration !== "" ? n.payload.registration : n.group_name;
    const bytes = await buildStatementPdf(
      statementPdfInput(
        statement,
        [member],
        {
          groupName: n.group_name,
          registration,
          month,
          thisMonth: londonDateKey(now).slice(0, 7),
          printedAt: stampFormat.format(now).replace(" at ", ", "),
        },
        false,
      ),
    );
    return {
      filename: `${registration}-statement-${month}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_"),
      content: Buffer.from(bytes).toString("base64"),
    };
  } catch (error) {
    console.error("Could not make the statement PDF:", error instanceof Error ? error.message : error);
    return null;
  }
}
