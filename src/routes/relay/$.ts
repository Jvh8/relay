import { createFileRoute } from "@tanstack/react-router";

async function relay(request: Request): Promise<Response> {
  const { handleRelay } = await import("@/lib/relay/upstream.server");
  return handleRelay(request);
}

export const Route = createFileRoute("/relay/$")({
  server: {
    handlers: {
      GET: ({ request }) => relay(request),
      POST: ({ request }) => relay(request),
      PUT: ({ request }) => relay(request),
      PATCH: ({ request }) => relay(request),
      DELETE: ({ request }) => relay(request),
      HEAD: ({ request }) => relay(request),
      OPTIONS: ({ request }) => relay(request),
    },
  },
});
