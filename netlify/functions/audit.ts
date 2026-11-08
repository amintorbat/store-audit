import handler from "../../api/audit";

// Netlify Functions v2 wrapper: reuses the same handler as the Vercel route.
export default async (request: Request) => handler.fetch(request);

export const config = { path: "/api/audit" };
