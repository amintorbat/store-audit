import { runAudit, explainError } from "../audit-core";

export default {
  async fetch(request: Request) {
    const url = new URL(request.url).searchParams.get("url")?.trim();

    if (!url || url.length > 300) {
      return Response.json(
        {
          error: "Enter a store URL (up to 300 characters)",
        },
        { status: 400 },
      );
    }

    try {
      return Response.json(await runAudit(url));
    } catch (e) {
      return Response.json({ error: explainError(e) }, { status: 502 });
    }
  },
};
