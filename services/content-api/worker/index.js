const studentOrigin = "https://biola-sinh-hoc-thpt.helenlopezj669.chatgpt.site";
const adminOrigin = "https://biobilingual-admin-portal.helenlopezj669.chatgpt.site";
const allowedOrigins = new Set([studentOrigin, adminOrigin]);
const googleClientId = "519568222612-mvds8a054h1hn49ej5guk1hk9piv0arb.apps.googleusercontent.com";
const googleJwksUrl = "https://www.googleapis.com/oauth2/v3/certs";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

const allowedStateKeys = new Set([
  "bioedu_site_content",
  "bioedu_media_library",
  "bioedu_mindmap",
  "bioedu_theory_files",
  "bioedu_entertainment",
  "bioedu_vocab_bank",
  "bioedu_materials_library",
  "bioedu_exam_bank",
  "bioedu_exams",
  "bioedu_course_structure",
]);

const classSubjects = new Set([
  "Toán 1",
  "Toán 2",
  "Hóa",
  "Sinh",
  "Văn 1",
  "Văn 2",
  "Sử",
  "Địa",
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(request, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request),
  });
}

function clean(value, maxLength = 300) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function requestOrigin(request) {
  return request.headers.get("Origin") || "";
}

function isAdminOrigin(request) {
  return requestOrigin(request) === adminOrigin;
}

function isStudentOrigin(request) {
  return requestOrigin(request) === studentOrigin;
}

function validGrade(value) {
  const grade = clean(value, 2);
  return ["10", "11", "12"].includes(grade) ? grade : "";
}

function validClass(grade, value) {
  const className = clean(value, 40);
  const prefix = `${grade} `;
  if (!grade || !className.startsWith(prefix)) return "";
  return classSubjects.has(className.slice(prefix.length)) ? className : "";
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 2_000_000) throw new Error("Payload too large");
  return text ? JSON.parse(text) : {};
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyGoogleCredential(credential) {
  const parts = clean(credential, 10000).split(".");
  if (parts.length !== 3) throw new Error("Invalid Google credential");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Invalid Google credential");

  const keyResponse = await fetch(googleJwksUrl, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!keyResponse.ok) throw new Error("Google verification unavailable");
  const { keys = [] } = await keyResponse.json();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Google verification key not found");
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  const audienceMatches = Array.isArray(payload.aud)
    ? payload.aud.includes(googleClientId)
    : payload.aud === googleClientId;
  const issuerMatches = payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com";
  const validExpiry = Number(payload.exp) * 1000 > Date.now();
  if (!verified || !audienceMatches || !issuerMatches || !validExpiry || payload.email_verified !== true || !payload.sub || !payload.email) {
    throw new Error("Invalid Google credential");
  }
  return {
    sub: clean(payload.sub, 180),
    email: clean(payload.email, 180).toLowerCase(),
    name: clean(payload.name, 120),
    picture: clean(payload.picture, 1000),
  };
}

async function authenticateStudent(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const sessionHash = await sha256Hex(token);
  const session = await env.DB.prepare(
    "SELECT google_sub, email, name, picture, expires_at FROM student_sessions WHERE session_hash = ?",
  ).bind(sessionHash).first();
  if (!session || Date.parse(session.expires_at) <= Date.now()) return null;
  return {
    sub: session.google_sub,
    email: session.email,
    name: session.name,
    picture: session.picture,
    expiresAt: session.expires_at,
  };
}

async function googleLogin(request, env) {
  if (!isStudentOrigin(request)) return json(request, { error: "Forbidden" }, 403);
  const body = await readBody(request);
  let user;
  try {
    user = await verifyGoogleCredential(body.credential);
  } catch {
    return json(request, { error: "Không thể xác thực tài khoản Google" }, 401);
  }
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = encodeBase64Url(tokenBytes);
  const sessionHash = await sha256Hex(token);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
  await env.DB.prepare(
    "INSERT INTO student_sessions (session_hash, google_sub, email, name, picture, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(sessionHash, user.sub, user.email, user.name, user.picture, createdAt, expiresAt).run();
  return json(request, { token, user, expiresAt });
}

async function sessionInfo(request, env) {
  if (!isStudentOrigin(request)) return json(request, { error: "Forbidden" }, 403);
  const user = await authenticateStudent(request, env);
  return user ? json(request, { user }) : json(request, { error: "Unauthorized" }, 401);
}

async function stateRoute(request, env, url) {
  const key = clean(url.searchParams.get("key"), 80);
  if (!allowedStateKeys.has(key)) return json(request, { error: "Invalid key" }, 400);

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT value, updated_at FROM app_state WHERE key = ?")
      .bind(key)
      .first();
    return json(request, {
      key,
      value: row ? parseJson(row.value, null) : null,
      updatedAt: row?.updated_at || null,
    });
  }

  if (request.method === "PUT") {
    if (!isAdminOrigin(request)) return json(request, { error: "Forbidden" }, 403);
    const body = await readBody(request);
    const serialized = JSON.stringify(body.value ?? null);
    if (serialized.length > 1_900_000) return json(request, { error: "Payload too large" }, 413);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(key, serialized, now).run();
    return json(request, { ok: true, key, updatedAt: now });
  }

  return json(request, { error: "Method not allowed" }, 405);
}

async function saveStudent(request, env) {
  if (!isStudentOrigin(request)) return json(request, { error: "Forbidden" }, 403);
  const authenticatedUser = await authenticateStudent(request, env);
  if (!authenticatedUser) return json(request, { error: "Unauthorized" }, 401);
  const body = await readBody(request);
  const name = clean(body.name, 120);
  const email = authenticatedUser.email;
  const school = clean(body.school, 180);
  const grade = validGrade(body.grade || body.block);
  const className = validClass(grade, body.className || body.class);
  const id = email;

  if (!id || !name || !email || !email.includes("@") || !grade || !className) {
    return json(request, { error: "Invalid student profile" }, 400);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO students (id, name, email, school, grade, class_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, school = excluded.school, grade = excluded.grade, class_name = excluded.class_name, updated_at = excluded.updated_at",
  ).bind(id, name, email, school, grade, className, now).run();
  return json(request, { ok: true, id, updatedAt: now });
}

async function saveResult(request, env) {
  if (!isStudentOrigin(request)) return json(request, { error: "Forbidden" }, 403);
  const authenticatedUser = await authenticateStudent(request, env);
  if (!authenticatedUser) return json(request, { error: "Unauthorized" }, 401);
  const body = await readBody(request);
  const student = await env.DB.prepare(
    "SELECT id, name, grade, class_name FROM students WHERE id = ?",
  ).bind(authenticatedUser.email).first();
  if (!student) return json(request, { error: "Student profile required" }, 400);
  const studentId = student.id;
  const studentName = student.name;
  const grade = student.grade;
  const className = student.class_name;
  const sourceId = clean(body.sourceId || body.examId || body.worksheetId || body.activityId || "activity", 180);
  const sourceTitle = clean(body.sourceTitle || body.title || "Bài học", 240);
  const sourceType = clean(body.sourceType || body.type || "practice", 60);
  const score = Number(body.score);
  const maxScore = Number(body.maxScore ?? body.total ?? 10);
  const wrongQuestions = Array.isArray(body.wrongQuestions)
    ? body.wrongQuestions.slice(0, 100)
    : [];

  if (!studentId || !studentName || !grade || !className || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    return json(request, { error: "Invalid learning result" }, 400);
  }

  const completedAt = clean(body.completedAt, 40) || new Date().toISOString();
  const id = clean(body.id, 180) || crypto.randomUUID();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO results (id, student_id, student_name, grade, class_name, source_id, source_title, source_type, score, max_score, wrong_questions, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    studentId,
    studentName,
    grade,
    className,
    sourceId,
    sourceTitle,
    sourceType,
    score,
    maxScore,
    JSON.stringify(wrongQuestions),
    completedAt,
  ).run();
  return json(request, { ok: true, id });
}

async function adminStudents(request, env) {
  if (!isAdminOrigin(request)) return json(request, { error: "Forbidden" }, 403);
  const { results = [] } = await env.DB.prepare(
    "SELECT id, name, email, school, grade, class_name, updated_at FROM students ORDER BY grade, class_name, name",
  ).all();
  return json(request, {
    value: results.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      gmail: row.email,
      school: row.school,
      grade: row.grade,
      block: row.grade,
      className: row.class_name,
      class: row.class_name,
      updatedAt: row.updated_at,
    })),
  });
}

async function adminResults(request, env, url) {
  if (!isAdminOrigin(request)) return json(request, { error: "Forbidden" }, 403);
  const sourceId = clean(url.searchParams.get("sourceId"), 180);
  const statement = sourceId
    ? env.DB.prepare("SELECT * FROM results WHERE source_id = ? ORDER BY completed_at DESC").bind(sourceId)
    : env.DB.prepare("SELECT * FROM results ORDER BY completed_at DESC LIMIT 2000");
  const { results = [] } = await statement.all();
  return json(request, {
    value: results.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      studentName: row.student_name,
      name: row.student_name,
      grade: row.grade,
      className: row.class_name,
      sourceId: row.source_id,
      examId: row.source_id,
      sourceTitle: row.source_title,
      title: row.source_title,
      sourceType: row.source_type,
      score: row.score,
      maxScore: row.max_score,
      wrongQuestions: parseJson(row.wrong_questions, []),
      completedAt: row.completed_at,
    })),
  });
}

async function leaderboard(request, env, url) {
  const period = ["week", "month", "all"].includes(url.searchParams.get("period"))
    ? url.searchParams.get("period")
    : "week";
  const grade = validGrade(url.searchParams.get("grade"));
  const since = new Date();
  if (period === "week") since.setUTCDate(since.getUTCDate() - 7);
  if (period === "month") since.setUTCDate(since.getUTCDate() - 30);

  const filters = [];
  const bindings = [];
  if (period !== "all") {
    filters.push("completed_at >= ?");
    bindings.push(since.toISOString());
  }
  if (grade) {
    filters.push("grade = ?");
    bindings.push(grade);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const sql = `SELECT student_id, student_name, grade, class_name, ROUND(SUM(CASE WHEN max_score > 0 THEN score * 100.0 / max_score ELSE 0 END)) AS points, COUNT(DISTINCT substr(completed_at, 1, 10)) AS streak FROM results ${where} GROUP BY student_id, student_name, grade, class_name ORDER BY points DESC, streak DESC, student_name ASC LIMIT 100`;
  const { results = [] } = await env.DB.prepare(sql).bind(...bindings).all();
  return json(request, {
    value: results.map((row, index) => ({
      rank: index + 1,
      studentId: row.student_id,
      name: row.student_name,
      grade: row.grade,
      className: row.class_name,
      points: Number(row.points) || 0,
      streak: Number(row.streak) || 0,
    })),
  });
}

async function recordVisit(request, env) {
  if (!isStudentOrigin(request)) return json(request, { error: "Forbidden" }, 403);
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    "INSERT INTO daily_metrics (day, visits) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET visits = visits + 1",
  ).bind(day).run();
  return json(request, { ok: true, day });
}

async function stats(request, env) {
  if (!isAdminOrigin(request)) return json(request, { error: "Forbidden" }, 403);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const [students, results, visits] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM students").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM results").first(),
    env.DB.prepare("SELECT COALESCE(SUM(visits), 0) AS total FROM daily_metrics WHERE day >= ?")
      .bind(since.toISOString().slice(0, 10))
      .first(),
  ]);
  return json(request, {
    students: Number(students?.total) || 0,
    results: Number(results?.total) || 0,
    visits30d: Number(visits?.total) || 0,
  });
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      const url = new URL(request.url);
      if (url.pathname === "/api/state") return stateRoute(request, env, url);
      if (url.pathname === "/api/auth/google" && request.method === "POST") return googleLogin(request, env);
      if (url.pathname === "/api/auth/session" && request.method === "GET") return sessionInfo(request, env);
      if (url.pathname === "/api/student" && request.method === "POST") return saveStudent(request, env);
      if (url.pathname === "/api/result" && request.method === "POST") return saveResult(request, env);
      if (url.pathname === "/api/students" && request.method === "GET") return adminStudents(request, env);
      if (url.pathname === "/api/results" && request.method === "GET") return adminResults(request, env, url);
      if (url.pathname === "/api/leaderboard" && request.method === "GET") return leaderboard(request, env, url);
      if (url.pathname === "/api/visit" && request.method === "POST") return recordVisit(request, env);
      if (url.pathname === "/api/stats" && request.method === "GET") return stats(request, env);
      if (url.pathname === "/health") return json(request, { ok: true });
      return json(request, { error: "Not found" }, 404);
    } catch (error) {
      const status = error?.message === "Payload too large" ? 413 : 500;
      return json(request, { error: status === 413 ? error.message : "Server error" }, status);
    }
  },
};
