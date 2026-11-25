import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type", "Access-Control-Allow-Methods":"GET, POST, OPTIONS" };
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
const devices:Record<string,{rate:number}>={
 billiard:{rate:1500},scolia:{rate:2000},darts1:{rate:1000},darts2:{rate:1000},darts3:{rate:1000},foosball1:{rate:2000},foosball2:{rate:2000}
};
function amountFor(start:string,end:string,rate:number){
 const minutes=Math.floor((new Date(end).getTime()-new Date(start).getTime())/60000);
 const halfHours=minutes<=70?2:2+Math.ceil((minutes-70)/30);
 return Math.round(halfHours*rate/2);
}
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const encoder=new TextEncoder();
async function hash(value:string){
 const bytes=await crypto.subtle.digest("SHA-256",encoder.encode(value));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function sign(payload:string,secret:string){
 const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,encoder.encode(payload));
 return btoa(String.fromCharCode(...new Uint8Array(sig))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
async function tokenFor(role:string){
 const exp=Math.floor(Date.now()/1000)+60*60*12;
 const payload=btoa(JSON.stringify({role,exp})).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
 return `${payload}.${await sign(payload,Deno.env.get("TOKEN_SECRET")!)}`;
}
async function authorize(req:Request){
 const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
 if(!token)return null;
 const [payload,sig]=token.split(".");
 if(!payload||!sig||sig!==await sign(payload,Deno.env.get("TOKEN_SECRET")!))return null;
 try{
  const data=JSON.parse(atob(payload.replaceAll("-","+").replaceAll("_","/")));
  if(data.exp<Math.floor(Date.now()/1000)||!["owner","staff"].includes(data.role))return null;
  return data as {role:"owner"|"staff";exp:number};
 }catch{return null}
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const url=new URL(req.url),action=url.searchParams.get("action");
 if(action==="login"&&req.method==="POST"){
  try{
   const {pin}=await req.json(), entered=await hash(String(pin||""));
   const ownerHash=Deno.env.get("OWNER_PIN_SHA256"),staffHash=Deno.env.get("STAFF_PIN_SHA256");
   const role=entered===ownerHash?"owner":entered===staffHash?"staff":null;
   if(!role)return json({error:"Hibás PIN-kód."},401);
   return json({role,token:await tokenFor(role)});
  }catch{return json({error:"Érvénytelen belépési kérés."},400)}
 }
 const user=await authorize(req);
 if(!user)return json({error:"A munkamenet lejárt vagy érvénytelen. Lépj be újra."},401);
 if(action==="payment-log"&&req.method==="GET"){
  if(user.role!=="owner")return json({error:"A fizetési napló csak tulajdonosi jogosultsággal érhető el."},403);
  const {data,error}=await admin.from("guest_tab_payments").select("*").order("settled_at",{ascending:false});
  if(error)return json({error:error.message},500);return json(data||[]);
 }
 if(action==="delete-payment-log"&&req.method==="POST"){
  if(user.role!=="owner")return json({error:"Fizetési naplóbejegyzést csak tulajdonos törölhet."},403);
  const {id}=await req.json();
  if(!id||typeof id!=="string")return json({error:"Hiányzó vagy érvénytelen naplóazonosító."},400);
  const {data,error}=await admin.from("guest_tab_payments").delete().eq("id",id).select("id").maybeSingle();
  if(error)return json({error:error.message},500);
  if(!data)return json({error:"A naplóbejegyzés nem található, vagy már törölték."},404);
  return json({deleted:true,id:data.id});
 }
 if(action==="settle-guest-tab"&&req.method==="POST"){
  const {id}=await req.json();
  if(!id||typeof id!=="string")return json({error:"Hiányzó vagy érvénytelen számlaazonosító."},400);
  const {data,error}=await admin.rpc("settle_guest_tab",{p_tab_id:id,p_settled_by:user.role});
  if(error)return json({error:error.message},400);return json(data);
 }
 if(action==="guest-tabs"&&req.method==="GET"){
  const {data,error}=await admin.from("guest_tabs").select("*,tab_items(*)").order("created_at",{ascending:true});
  if(error)return json({error:error.message},500);return json(data||[]);
 }
 if(action==="create-guest-tab"&&req.method==="POST"){
  const {guest_name}=await req.json();
  if(!String(guest_name||"").trim())return json({error:"A vendég neve kötelező."},400);
  const {data,error}=await admin.from("guest_tabs").insert({guest_name:String(guest_name).trim().slice(0,80)}).select().single();
  if(error)return json({error:error.message},500);return json(data);
 }
 if(action==="add-tab-item"&&req.method==="POST"){
  const {tab_id,item_name}=await req.json();
  if(!tab_id||!String(item_name||"").trim())return json({error:"Hiányzó vendég vagy tételnév."},400);
  const {data,error}=await admin.from("tab_items").insert({tab_id,item_name:String(item_name).trim().slice(0,100),quantity:1}).select().single();
  if(error)return json({error:error.message},500);return json(data);
 }
 if(action==="change-tab-item"&&req.method==="POST"){
  const {id,quantity}=await req.json();
  if(!id||!Number.isInteger(quantity)||quantity<0||quantity>9999)return json({error:"Érvénytelen darabszám."},400);
  if(quantity===0){
   const {error}=await admin.from("tab_items").delete().eq("id",id);
   if(error)return json({error:error.message},500);return json({deleted:true});
  }
  const {data,error}=await admin.from("tab_items").update({quantity}).eq("id",id).select().maybeSingle();
  if(error)return json({error:error.message},500);if(!data)return json({error:"A tétel nem található."},404);return json(data);
 }
 if(action==="delete-guest-tab"&&req.method==="POST"){
  const {id}=await req.json();
  if(!id)return json({error:"Hiányzó számlaazonosító."},400);
  const {data,error}=await admin.from("guest_tabs").delete().eq("id",id).select("id").maybeSingle();
  if(error)return json({error:error.message},500);if(!data)return json({error:"A vendégszámla nem található."},404);return json({deleted:true});
 }
 if(action==="active"&&req.method==="GET"){
  const {data,error}=await admin.from("sessions").select("*").is("ended_at",null).order("started_at");
  if(error)return json({error:error.message},500);return json(data);
 }
 if(action==="history"&&req.method==="GET"){
  if(user.role!=="owner")return json({error:"Ehhez tulajdonosi jogosultság szükséges."},403);
  const all=[];
  for(let from=0;;from+=1000){
   const {data,error}=await admin.from("sessions").select("*").not("ended_at","is",null).order("ended_at",{ascending:false}).range(from,from+999);
   if(error)return json({error:error.message},500);
   const page=data||[];
   all.push(...page);
   if(page.length<1000)break;
  }
  return json(all);
 }
 if(action==="delete-session"&&req.method==="POST"){
  if(user.role!=="owner")return json({error:"Törölni csak tulajdonosi jogosultsággal lehet."},403);
  const {id}=await req.json();
  if(!id||typeof id!=="string")return json({error:"Hiányzó vagy érvénytelen játékazonosító."},400);
  const {data,error}=await admin.from("sessions").delete().eq("id",id).select("id").maybeSingle();
  if(error)return json({error:error.message},500);
  if(!data)return json({error:"A játék nem található, vagy már törölték."},404);
  return json({deleted:true,id:data.id});
 }
 if(action==="start"&&req.method==="POST"){
  const {device_key,guest_name}=await req.json();
  if(!devices[device_key]||!String(guest_name||"").trim())return json({error:"Hiányzó vagy érvénytelen eszköz/vendégnév."},400);
  const {data,error}=await admin.from("sessions").insert({device_key,guest_name:String(guest_name).trim().slice(0,80),hourly_rate:devices[device_key].rate}).select().single();
  if(error)return json({error:error.code==="23505"?"Ez az eszköz már használatban van.":error.message},400);
  return json(data);
 }
 if(action==="finish"&&req.method==="POST"){
  const {device_key}=await req.json();
  if(!devices[device_key])return json({error:"Ismeretlen eszköz."},400);
  const {data:current,error:findError}=await admin.from("sessions").select("*").eq("device_key",device_key).is("ended_at",null).maybeSingle();
  if(findError||!current)return json({error:"Ehhez az eszközhöz nincs aktív stopper."},404);
  const ended=new Date().toISOString(),amount=amountFor(current.started_at,ended,current.hourly_rate);
  const {error}=await admin.from("sessions").update({ended_at:ended,amount}).eq("id",current.id).is("ended_at",null);
  if(error)return json({error:error.message},500);
  return json({amount,ended_at:ended});
 }
 return json({error:"Ismeretlen művelet."},404);
});
