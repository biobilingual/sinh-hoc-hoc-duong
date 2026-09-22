import { createClient } from "npm:@supabase/supabase-js@2";

const studentOrigin = "https://biobilingual.com";
const wwwStudentOrigin = "https://www.biobilingual.com";
const legacyStudentOrigin = "https://biola-sinh-hoc-thpt.helenlopezj669.chatgpt.site";
const adminOrigin = "https://biobilingual-admin-portal.helenlopezj669.chatgpt.site";
const githubOrigin = "https://trankienquoc90-debug.github.io";
const allowedOrigins = new Set([studentOrigin, wwwStudentOrigin, legacyStudentOrigin, adminOrigin, githubOrigin, "http://localhost:3000", "http://127.0.0.1:5500"]);
const googleClientId = "519568222612-mvds8a054h1hn49ej5guk1hk9piv0arb.apps.googleusercontent.com";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const adminSessionLifetimeMs = 12 * 60 * 60 * 1000;

const allowedStateKeys = new Set([
  "bioedu_site_content","bioedu_media_library","bioedu_mindmap","bioedu_theory_files",
  "bioedu_entertainment","bioedu_vocab_bank","bioedu_materials_library","bioedu_exam_bank",
  "bioedu_exams","bioedu_course_structure","bioedu_vocab_audio"
]);

const classSubjects = new Set(["Toán 1","Toán 2","Hóa","Sinh","Văn 1","Văn 2","Sử","Địa"]);
const storageBuckets = new Set([
  "vocabulary-media","vocabulary-audio","biology-images","learning-resources",
  "learning-videos","worksheets","mindmaps","music","avatars"
]);

function adminClient() {
  const secretMap = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = secretMap.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(Deno.env.get("SUPABASE_URL") || "", key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const h: Record<string,string> = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  };
  if (allowedOrigins.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders(req) });
}

function clean(value: unknown, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}
function isAdminOrigin(req: Request) {
  const origin = req.headers.get("Origin");
  return origin === studentOrigin || origin === wwwStudentOrigin || origin === adminOrigin || origin === githubOrigin;
}
function isStudentOrigin(req: Request) { const o=req.headers.get("Origin"); return o === studentOrigin || o === wwwStudentOrigin || o === legacyStudentOrigin || o === githubOrigin; }
function validGrade(value: unknown) {
  const n = Number(value);
  return [10,11,12].includes(n) ? n : 0;
}
function validClass(grade: number, value: unknown) {
  const className = clean(value, 40);
  const prefix = grade + " ";
  if (!grade || !className.startsWith(prefix)) return "";
  return classSubjects.has(className.slice(prefix.length)) ? className : "";
}
async function readBody(req: Request) {
  const text = await req.text();
  if (text.length > 2_000_000) throw new Error("Payload too large");
  return text ? JSON.parse(text) : {};
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
}
function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function verifyGoogleCredential(credential: string) {
  const response = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
  if (!response.ok) throw new Error("Invalid Google credential");
  const p = await response.json();
  const audOk = p.aud === googleClientId;
  const issOk = p.iss === "accounts.google.com" || p.iss === "https://accounts.google.com";
  const expOk = Number(p.exp) * 1000 > Date.now();
  if (!audOk || !issOk || !expOk || p.email_verified !== "true" || !p.sub || !p.email) throw new Error("Invalid Google credential");
  return { sub: clean(p.sub,180), email: clean(p.email,180).toLowerCase(), name: clean(p.name,120), picture: clean(p.picture,1000) };
}
async function authenticateStudent(req: Request) {
  const raw = req.headers.get("Authorization") || "";
  const bearer = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!bearer) return null;
  const hash = await sha256Hex(bearer);
  const sb = adminClient();
  const { data, error } = await sb.from("student_sessions").select("google_sub,email,name,picture,expires_at").eq("session_hash", hash).maybeSingle();
  if (error || !data || Date.parse(data.expires_at) <= Date.now()) return null;
  return { sub:data.google_sub,email:data.email,name:data.name,picture:data.picture,expiresAt:data.expires_at };
}

async function authenticateAdmin(req: Request) {
  if (!isAdminOrigin(req)) return null;
  const raw = req.headers.get("Authorization") || "";
  const bearer = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!bearer) return null;
  const hash = await sha256Hex(bearer);
  const sb = adminClient();
  const { data:session, error } = await sb.from("admin_sessions")
    .select("admin_email,expires_at").eq("session_hash",hash).maybeSingle();
  if (error || !session || Date.parse(session.expires_at) <= Date.now()) return null;
  const { data:admin } = await sb.from("admin_accounts")
    .select("email,display_name,active").eq("email",session.admin_email).eq("active",true).maybeSingle();
  return admin ? { email:admin.email,name:admin.display_name,expiresAt:session.expires_at } : null;
}

async function googleAdminLogin(req: Request) {
  if (!isAdminOrigin(req)) return json(req,{error:"Forbidden"},403);
  const body = await readBody(req);
  let user;
  try { user = await verifyGoogleCredential(clean(body.credential,12000)); }
  catch { return json(req,{error:"Không thể xác thực tài khoản Google"},401); }
  const sb = adminClient();
  const { data:admin } = await sb.from("admin_accounts")
    .select("email,display_name,active").eq("email",user.email).eq("active",true).maybeSingle();
  if (!admin) return json(req,{error:"Tài khoản này không có quyền quản trị"},403);
  const sessionToken = token();
  const hash = await sha256Hex(sessionToken);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now()+adminSessionLifetimeMs).toISOString();
  const { error } = await sb.from("admin_sessions").insert({
    session_hash:hash,admin_email:admin.email,created_at:createdAt,expires_at:expiresAt
  });
  if (error) return json(req,{error:error.message},500);
  return json(req,{token:sessionToken,user:{email:admin.email,name:admin.display_name||user.name},expiresAt});
}

async function adminSessionInfo(req: Request) {
  const admin = await authenticateAdmin(req);
  return admin ? json(req,{user:admin}) : json(req,{error:"Unauthorized"},401);
}

async function adminLogout(req: Request) {
  const raw = req.headers.get("Authorization") || "";
  const bearer = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (bearer) {
    const hash = await sha256Hex(bearer);
    await adminClient().from("admin_sessions").delete().eq("session_hash",hash);
  }
  return json(req,{ok:true});
}

async function stateRoute(req: Request, url: URL) {
  const key = clean(url.searchParams.get("key"), 80);
  if (!allowedStateKeys.has(key)) return json(req,{error:"Invalid key"},400);
  const sb = adminClient();
  if (req.method === "GET") {
    const { data, error } = await sb.from("app_state").select("value,updated_at").eq("key",key).maybeSingle();
    if (error) return json(req,{error:error.message},500);
    return json(req,{key,value:data?.value ?? null,updatedAt:data?.updated_at ?? null});
  }
  if (req.method === "PUT") {
    if (!await authenticateAdmin(req)) return json(req,{error:"Unauthorized"},401);
    const body = await readBody(req);
    const serialized = JSON.stringify(body.value ?? null);
    if (serialized.length > 1_900_000) return json(req,{error:"Payload too large"},413);
    const updatedAt = new Date().toISOString();
    const { error } = await sb.from("app_state").upsert({key,value:body.value ?? null,updated_at:updatedAt},{onConflict:"key"});
    if (error) return json(req,{error:error.message},500);
    return json(req,{ok:true,key,updatedAt});
  }
  return json(req,{error:"Method not allowed"},405);
}

async function googleLogin(req: Request) {
  if (!isStudentOrigin(req)) return json(req,{error:"Forbidden"},403);
  const body = await readBody(req);
  let user;
  try { user = await verifyGoogleCredential(clean(body.credential,12000)); }
  catch { return json(req,{error:"Không thể xác thực tài khoản Google"},401); }
  const sessionToken = token();
  const hash = await sha256Hex(sessionToken);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now()+sessionLifetimeMs).toISOString();
  const sb = adminClient();
  const { error } = await sb.from("student_sessions").insert({
    session_hash:hash,google_sub:user.sub,email:user.email,name:user.name,picture:user.picture,
    created_at:createdAt,expires_at:expiresAt
  });
  if (error) return json(req,{error:error.message},500);
  return json(req,{token:sessionToken,user,expiresAt});
}
async function sessionInfo(req: Request) {
  const user = await authenticateStudent(req);
  return user ? json(req,{user}) : json(req,{error:"Unauthorized"},401);
}
async function saveStudent(req: Request) {
  if (!isStudentOrigin(req)) return json(req,{error:"Forbidden"},403);
  const auth = await authenticateStudent(req);
  if (!auth) return json(req,{error:"Unauthorized"},401);
  const body = await readBody(req);
  const grade = validGrade(body.grade ?? body.block);
  const className = validClass(grade, body.className ?? body.class);
  const name = clean(body.name,120);
  const school = clean(body.school,180);
  if (!name || !grade || !className) return json(req,{error:"Invalid student profile"},400);
  const sb = adminClient();
  const updatedAt = new Date().toISOString();
  const { error } = await sb.from("student_accounts").upsert({
    id:auth.email,name,email:auth.email,school,grade,class_name:className,updated_at:updatedAt
  },{onConflict:"id"});
  if (error) return json(req,{error:error.message},500);
  return json(req,{ok:true,id:auth.email,updatedAt});
}
async function saveResult(req: Request) {
  if (!isStudentOrigin(req)) return json(req,{error:"Forbidden"},403);
  const auth = await authenticateStudent(req);
  if (!auth) return json(req,{error:"Unauthorized"},401);
  const sb = adminClient();
  const { data:student } = await sb.from("student_accounts").select("*").eq("id",auth.email).maybeSingle();
  if (!student) return json(req,{error:"Student profile required"},400);
  const b = await readBody(req);
  const maxScore = Number(b.maxScore ?? b.total ?? 10);
  const score = Number(b.score);
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return json(req,{error:"Invalid learning result"},400);
  const id = clean(b.id,180) || crypto.randomUUID();
  const { error } = await sb.from("learning_results").upsert({
    id,student_id:student.id,student_name:student.name,grade:student.grade,class_name:student.class_name,
    source_id:clean(b.sourceId ?? b.examId ?? b.worksheetId ?? b.activityId ?? "activity",180),
    source_title:clean(b.sourceTitle ?? b.title ?? "Bài học",240),
    source_type:clean(b.sourceType ?? b.type ?? "practice",60),
    score,max_score:maxScore,wrong_questions:Array.isArray(b.wrongQuestions)?b.wrongQuestions.slice(0,100):[],
    completed_at:clean(b.completedAt,40) || new Date().toISOString()
  },{onConflict:"id"});
  if (error) return json(req,{error:error.message},500);
  return json(req,{ok:true,id});
}
async function adminStudents(req: Request) {
  if (!await authenticateAdmin(req)) return json(req,{error:"Unauthorized"},401);
  const { data,error } = await adminClient().from("student_accounts").select("*").order("grade").order("class_name").order("name");
  if (error) return json(req,{error:error.message},500);
  return json(req,{value:(data||[]).map(r=>({id:r.id,name:r.name,email:r.email,gmail:r.email,school:r.school,grade:String(r.grade),block:String(r.grade),className:r.class_name,class:r.class_name,updatedAt:r.updated_at}))});
}
async function adminResults(req: Request, url: URL) {
  if (!await authenticateAdmin(req)) return json(req,{error:"Unauthorized"},401);
  let q = adminClient().from("learning_results").select("*").order("completed_at",{ascending:false}).limit(2000);
  const sourceId = clean(url.searchParams.get("sourceId"),180);
  if (sourceId) q = q.eq("source_id",sourceId);
  const { data,error } = await q;
  if (error) return json(req,{error:error.message},500);
  return json(req,{value:(data||[]).map(r=>({id:r.id,studentId:r.student_id,studentName:r.student_name,name:r.student_name,grade:String(r.grade),className:r.class_name,sourceId:r.source_id,examId:r.source_id,sourceTitle:r.source_title,title:r.source_title,sourceType:r.source_type,score:Number(r.score),maxScore:Number(r.max_score),wrongQuestions:r.wrong_questions||[],completedAt:r.completed_at}))});
}
async function leaderboard(req: Request, url: URL) {
  const period = ["week","month","all"].includes(url.searchParams.get("period")||"") ? url.searchParams.get("period")! : "week";
  const grade = validGrade(url.searchParams.get("grade"));
  let q = adminClient().from("learning_results").select("student_id,student_name,grade,class_name,score,max_score,completed_at");
  if (period !== "all") {
    const since = new Date(); since.setUTCDate(since.getUTCDate()-(period==="week"?7:30));
    q = q.gte("completed_at",since.toISOString());
  }
  if (grade) q = q.eq("grade",grade);
  const { data,error } = await q;
  if (error) return json(req,{error:error.message},500);
  const map = new Map<string,any>();
  for (const r of data||[]) {
    const cur = map.get(r.student_id)||{studentId:r.student_id,name:r.student_name,grade:String(r.grade),className:r.class_name,points:0,days:new Set<string>()};
    cur.points += Number(r.max_score)>0 ? Number(r.score)*100/Number(r.max_score):0;
    cur.days.add(String(r.completed_at).slice(0,10)); map.set(r.student_id,cur);
  }
  const value=[...map.values()].map(x=>({...x,points:Math.round(x.points),streak:x.days.size})).sort((a,b)=>b.points-a.points||b.streak-a.streak||a.name.localeCompare(b.name,"vi")).slice(0,100).map((x,i)=>({rank:i+1,studentId:x.studentId,name:x.name,grade:x.grade,className:x.className,points:x.points,streak:x.streak}));
  return json(req,{value});
}
async function visit(req: Request) {
  if (!isStudentOrigin(req)) return json(req,{error:"Forbidden"},403);
  const sb=adminClient(); const day=new Date().toISOString().slice(0,10);
  const { data } = await sb.from("daily_metrics").select("visits").eq("day",day).maybeSingle();
  const { error } = await sb.from("daily_metrics").upsert({day,visits:Number(data?.visits||0)+1},{onConflict:"day"});
  if(error) return json(req,{error:error.message},500);
  return json(req,{ok:true,day});
}
async function stats(req: Request) {
  if (!await authenticateAdmin(req)) return json(req,{error:"Unauthorized"},401);
  const sb=adminClient(); const since=new Date(); since.setUTCDate(since.getUTCDate()-30);
  const [{count:students},{count:results},{data:visits,error}] = await Promise.all([
    sb.from("student_accounts").select("*",{count:"exact",head:true}),
    sb.from("learning_results").select("*",{count:"exact",head:true}),
    sb.from("daily_metrics").select("visits").gte("day",since.toISOString().slice(0,10))
  ]);
  if(error) return json(req,{error:error.message},500);
  return json(req,{students:students||0,results:results||0,visits30d:(visits||[]).reduce((s,r)=>s+Number(r.visits||0),0)});
}
async function upload(req: Request, url: URL) {
  if (!await authenticateAdmin(req)) return json(req,{error:"Unauthorized"},401);
  const bucket=clean(url.searchParams.get("bucket"),60);
  if(!storageBuckets.has(bucket)) return json(req,{error:"Invalid bucket"},400);
  const form=await req.formData(); const file=form.get("file");
  if(!(file instanceof File)) return json(req,{error:"Missing file"},400);
  const max=bucket==="avatars"?5*1024*1024:50*1024*1024;
  if(file.size>max) return json(req,{error:"File too large"},413);
  const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(-120);
  const path=new Date().toISOString().slice(0,10)+"/"+crypto.randomUUID()+"-"+safe;
  const sb=adminClient();
  const { error }=await sb.storage.from(bucket).upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false,cacheControl:"3600"});
  if(error) return json(req,{error:error.message},500);
  const { data }=sb.storage.from(bucket).getPublicUrl(path);
  return json(req,{ok:true,bucket,path,url:data.publicUrl,name:file.name,size:file.size,type:file.type});
}

Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:corsHeaders(req)});
  try {
    const url=new URL(req.url);
    const route=url.pathname.replace(/^\/biobilingual-api/,"");
    if(route==="/api/state") return stateRoute(req,url);
    if(route==="/api/auth/admin/google"&&req.method==="POST") return googleAdminLogin(req);
    if(route==="/api/auth/admin/session"&&req.method==="GET") return adminSessionInfo(req);
    if(route==="/api/auth/admin/logout"&&req.method==="POST") return adminLogout(req);
    if(route==="/api/auth/google"&&req.method==="POST") return googleLogin(req);
    if(route==="/api/auth/session"&&req.method==="GET") return sessionInfo(req);
    if(route==="/api/student"&&req.method==="POST") return saveStudent(req);
    if(route==="/api/result"&&req.method==="POST") return saveResult(req);
    if(route==="/api/students"&&req.method==="GET") return adminStudents(req);
    if(route==="/api/results"&&req.method==="GET") return adminResults(req,url);
    if(route==="/api/leaderboard"&&req.method==="GET") return leaderboard(req,url);
    if(route==="/api/visit"&&req.method==="POST") return visit(req);
    if(route==="/api/stats"&&req.method==="GET") return stats(req);
    if(route==="/api/upload"&&req.method==="POST") return upload(req,url);
    if(route==="/health") return json(req,{ok:true,backend:"supabase"});
    return json(req,{error:"Not found",route},404);
  } catch(e) {
    const msg=e instanceof Error?e.message:"Unknown error";
    return json(req,{error:msg},msg==="Payload too large"?413:500);
  }
});
