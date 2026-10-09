// Cloudflare Worker for the AP student tutor.
// Bindings needed: AI (Workers AI), CHATS (KV namespace)
// Secrets needed: TEACHER_USER, TEACHER_PASS

const ORIGIN = "https://andrewholmes2011.github.io";

const TUTOR = `You are a patient tutor for students of any age in any class (math, science, English, history, languages, coding, cybersecurity, and more).
Your job is to teach HOW to do things, not to hand over answers.
- Explain the concept first, in plain language, with a short example on a DIFFERENT problem than the student's.
- Break the task into steps and guide the student through them. Ask one guiding question at a time.
- If a student pastes an assignment or asks "just give me the answer/code/essay", do not write the full solution. Explain the approach, give hints, and ask them to try the next step.
- If the student shares their own attempt, point out what is right, find the mistake or gap, and explain why. Short snippets or one worked step are fine; a complete solution or finished essay is not.
- Match the level to the student. If it's unclear, ask what grade or course they're in.
- Check understanding at the end with a quick question.`;

const GENERAL = "You are a helpful assistant for a teacher. Answer directly and completely, including full solutions and code.";

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type,X-User,X-Pass",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const norm = (n) => String(n || "").trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 40);

const isTeacher = (req, env) =>
  !!env.TEACHER_PASS &&
  req.headers.get("X-User") === env.TEACHER_USER &&
  req.headers.get("X-Pass") === env.TEACHER_PASS;

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const path = new URL(req.url).pathname;
    const body = await req.json().catch(() => ({}));
    const teacher = isTeacher(req, env);

    if (path === "/login") return teacher ? json({ ok: true }) : json({ ok: false }, 401);

    if (path === "/check") {
      if (!teacher) return json({ error: "Teachers only." }, 403);
      const key = norm(body.name);
      if (!key) return json({ error: "Give a student name." }, 400);
      const list = await env.CHATS.list({ prefix: `chat:${key}:` });
      const chats = await Promise.all(list.keys.map((k) => env.CHATS.get(k.name, "json")));
      return json({ chats });
    }

    if (path === "/chat") {
      const key = norm(body.name);
      const subject = String(body.subject || "").slice(0, 60);
      if (!teacher && !key) return json({ error: "Enter your name first." }, 400);
      const msgs = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant"))
        .slice(-12)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
      if (!msgs.length) return json({ error: "Empty message." }, 400);

      const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "system", content: teacher ? GENERAL : TUTOR + (subject ? `\nThe student says this is for: ${subject}.` : "") }, ...msgs],
        max_tokens: 700,
      });
      const reply = out.response || "Sorry, I couldn't answer that. Try again.";

      if (!teacher) {
        await env.CHATS.put(
          `chat:${key}:${Date.now()}`,
          JSON.stringify({ name: body.name, q: msgs[msgs.length - 1].content, a: reply, t: new Date().toISOString() }),
          { expirationTtl: 60 * 60 * 24 * 180 }
        );
      }
      return json({ reply });
    }

    return json({ error: "Not found" }, 404);
  },
};
