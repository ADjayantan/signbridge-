// Vercel Function: POST /api/chat → server/chat.js
import { handleChat } from "../server/chat.js";

export function POST(request) {
  return handleChat(request, process.env);
}
