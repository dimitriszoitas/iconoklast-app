import { getAIEnvironment } from "@/lib/ai-env";
import { getConnectionStatus } from "@/lib/remembered-key";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return Response.json(await getConnectionStatus(request, getAIEnvironment()), {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
