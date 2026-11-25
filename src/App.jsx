import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Activity, BarChart3, Clock3, LogOut, Play, Square, RefreshCw, Shield, Users, Wallet, Trash2 } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const DEVICES = [
  { key:"billiard", name:"Billiárd", rate:1500 },
  { key:"scolia", name:"Scolia", rate:2000 },
  { key:"darts1", name:"Darts 1", rate:1000 },
  { key:"darts2", name:"Darts 2", rate:1000 },
  { key:"darts3", name:"Darts 3", rate:1000 },
  { key:"foosball1", name:"Csócsó 1", rate:2000 },
  { key:"foosball2", name:"Csócsó 2", rate:2000 }
];
const money = n => new Intl.NumberFormat("hu-HU").format(n || 0) + " Ft";
const duration = ms => {
  const sec=Math.max(0,Math.floor(ms/1000)), h=Math.floor(sec/3600), m=Math.floor(sec%3600/60), s=sec%60;
  return [h,m,s].map(v=>String(v).padStart(2,"0")).join(":");
};
// First hour is charged in full. Extra half-hours start after the 10-minute grace period.
function amountFor(ms, rate) {
  const minutes=Math.floor(Math.max(0,ms)/60000);
  const halfHours=minutes<=70 ? 2 : 2+Math.ceil((minutes-70)/30);
  return Math.round(halfHours*rate/2);
}
const api = async (action, token, method="GET", body=null) => {
  const res=await fetch(`${SUPABASE_URL}/functions/v1/pos-api?action=${action}`, {
    method, headers: { "Content-Type":"application/json", apikey:SUPABASE_ANON_KEY, ...(token?{Authorization:`Bearer ${token}`}:{}) },
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await res.json();
  if(!res.ok) throw new Error(data.error || "Hiba történt a szerverrel.");
  return data;
};

export default function App() {
  const [session,setSession]=useState(()=>{try{return JSON.parse(localStorage.getItem("lvlup-session")||"null")}catch{return null}});
  const [pin,setPin]=useState("");
  const [error,setError]=useState("");
  const [active,setActive]=useState([]);
  const [history,setHistory]=useState([]);
  const [tabsData,setTabsData]=useState([]);
  const [newTabName,setNewTabName]=useState("");
  const [newItems,setNewItems]=useState({});
  const [names,setNames]=useState({});
  const [now,setNow]=useState(Date.now());
  const [tab,setTab]=useState("timers");
  const [range,setRange]=useState("today");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(false);
  const owner=session?.role==="owner";

  useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(id)},[]);
  useEffect(()=>{session?localStorage.setItem("lvlup-session",JSON.stringify(session)):localStorage.removeItem("lvlup-session")},[session]);

  const loadData=useCallback(async()=>{
    if(!session?.token||!configured)return;
    setLoading(true);
    try {
      const a=await api("active",session.token);
      setActive(a);
      if(session.role==="owner") setHistory(await api("history",session.token));
      setTabsData(await api("guest-tabs",session.token));
    } catch(e) { setMessage(e.message); }
    finally { setLoading(false); }
  },[session]);
  useEffect(()=>{if(session)loadData()},[session,loadData]);
  useEffect(()=>{if(!session)return;const id=setInterval(loadData,5000);return()=>clearInterval(id)},[session,loadData]);

  async function login(e) {
    e.preventDefault();setError("");
    if(!configured){setError("Az online adatbázis beállítása még nincs kész.");return}
    try { const data=await api("login",null,"POST",{pin});setSession(data);setPin("") }
    catch(e){setError(e.message)}
  }
  function logout(){setSession(null);setActive([]);setHistory([]);setTabsData([]);setTab("timers")}

  async function createGuestTab(e){
    e.preventDefault();const guest_name=newTabName.trim();if(!guest_name)return;
    try{await api("create-guest-tab",session.token,"POST",{guest_name});setNewTabName("");await loadData();setMessage("Vendégszámla létrehozva.")}
    catch(e){setMessage(e.message)}
  }
  async function addTabItem(tabId){
    const item_name=(newItems[tabId]||"").trim();if(!item_name)return;
    try{await api("add-tab-item",session.token,"POST",{tab_id:tabId,item_name});setNewItems(v=>({...v,[tabId]:""}));await loadData()}
    catch(e){setMessage(e.message)}
  }
  async function changeTabItem(item,delta){
    try{await api("change-tab-item",session.token,"POST",{id:item.id,quantity:Math.max(0,Number(item.quantity)+delta)});await loadData()}
    catch(e){setMessage(e.message)}
  }
  async function settleGuestTab(row){
    if(!window.confirm("Biztosan törlöd "+row.guest_name+" teljes fogyasztási listáját?"))return;
    try{await api("delete-guest-tab",session.token,"POST",{id:row.id});await loadData();setMessage("A vendégszámla rendezettként törölve.")}
    catch(e){setMessage(e.message)}
  }
  async function runAction(kind,device){
    const guest=(names[device.key]||"").trim();
    if(kind==="start"&&!guest){setMessage("Előbb írd be a vendég nevét.");return}
    try {
      const data=await api(kind,session.token,"POST",{device_key:device.key,guest_name:guest});
      setMessage(kind==="start"?device.name+": elindult.":device.name+": lezárva, fizetendő "+money(data.amount)+".");
      setNames(v=>({...v,[device.key]:""}));
      await loadData();
    } catch(e){setMessage(e.message)}
  }

  async function deleteSession(row){
    const label=row.guest_name||"névtelen vendég";
    if(!window.confirm("Biztosan törlöd "+label+" játékát? A törlés a statisztikákból is eltávolítja, és nem vonható vissza."))return;
    try{await api("delete-session",session.token,"POST",{id:row.id});setMessage("A játék törölve, a statisztikák frissültek.");await loadData()}
    catch(e){setMessage(e.message)}
  }

  const totals=useMemo(()=>{
    const start=range==="all"?null:new Date();
    if(range==="today")start.setHours(0,0,0,0);
    if(range==="week"){start.setHours(0,0,0,0);start.setDate(start.getDate()-((start.getDay()+6)%7))}
    if(range==="month"){start.setHours(0,0,0,0);start.setDate(1)}
    const rows=history.filter(x=>!start||new Date(x.ended_at)>=start);
    return {rows,revenue:rows.reduce((s,x)=>s+Number(x.amount||0),0),
      duration:rows.reduce((s,x)=>s+new Date(x.ended_at)-new Date(x.started_at),0),
      devices:DEVICES.map(d=>({...d,rows:rows.filter(x=>x.device_key===d.key)}))};
  },[history,range]);

  if(!session) return <main className="login-wrap"><form className="login-card" onSubmit={login}>
    <div className="brand-mark"><Activity size={25}/></div><p className="eyebrow">LVL UP • SZOMBATHELY</p>
    <h1>Időmérő rendszer</h1><p className="muted">Belépés a kezelőfelületre</p>
    <label htmlFor="pin">PIN-kód</label><input id="pin" type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value)} placeholder="Írd be a PIN-kódot" required/>
    <button className="primary wide" type="submit">Belépés</button>
    {error&&<p className="error">{error}</p>}
    {!configured&&<p className="notice">A webalkalmazás forrása készen áll, de a Supabase adatbázis és a PIN-kódok beállítása még hátravan.</p>}
  </form></main>;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img className="brand-logo" src="/lvlup-logo.png" alt="LvL Up"/><div><b>Időmérő</b><span>SZOMBATHELY</span></div></div>
      <div className="top-actions"><span className={`role ${owner?"owner":""}`}><Shield size={14}/>{owner?"Tulajdonos":"Pultos"}</span><button className="icon-btn" onClick={loadData} title="Frissítés"><RefreshCw size={17}/></button><button className="icon-btn" onClick={logout} title="Kilépés"><LogOut size={17}/></button></div>
    </header>
    <nav className="tabs"><button className={tab==="timers"?"selected":""} onClick={()=>setTab("timers")}><Clock3 size={17}/> Stopperórák</button>
      {<button className={tab==="guest-tabs"?"selected":""} onClick={()=>setTab("guest-tabs")}><Users size={17}/> Vendégszámlák</button>}
      {owner&&<button className={tab==="stats"?"selected":""} onClick={()=>setTab("stats")}><BarChart3 size={17}/> Statisztikák</button>}
      {owner&&<button className={tab==="history"?"selected":""} onClick={()=>setTab("history")}><Users size={17}/> Napló</button>}
    </nav>
    <main className="content">
      {message&&<div className="toast">{message}<button onClick={()=>setMessage("")}>×</button></div>}
      {tab==="timers"&&<><div className="section-heading"><div><p className="eyebrow">ÉLŐ ÁLLAPOT</p><h1>Eszközök</h1></div><span className="live-dot">● ONLINE</span></div>
        <div className="device-grid">{DEVICES.map(d=>{
          const run=active.find(x=>x.device_key===d.key), elapsed=run?now-new Date(run.started_at).getTime():0;
          return <article className={`device-card ${run?"running":""}`} key={d.key}>
            <div className="device-top"><div><h2>{d.name}</h2><span className="rate">{money(d.rate)} / óra</span></div><span className={`status ${run?"on":""}`}>{run?"FUT":"KÉSZENLÉT"}</span></div>
            {run?<><div className="guest-label">VENDÉG</div><div className="guest-name">{run.guest_name}</div><div className="timer">{duration(elapsed)}</div>
              <div className="charge-row"><span>Jelenlegi díj</span><b>{money(amountFor(elapsed,d.rate))}</b></div>
              <button className="danger wide" onClick={()=>runAction("finish",d)}><Square size={16}/> Vége – lezárás</button>{owner&&<button className="cancel-session wide" onClick={()=>deleteSession(run)}><Trash2 size={15}/> Téves indítás törlése</button>}</>
            :<><div className="timer idle">00:00:00</div><input className="guest-input" placeholder="Vendég neve" value={names[d.key]||""} onChange={e=>setNames(v=>({...v,[d.key]:e.target.value}))}/>
              <button className="primary wide" onClick={()=>runAction("start",d)}><Play size={16} fill="currentColor"/> Start</button></>}
          </article>
        })}</div></>}
      {tab==="guest-tabs"&&<section><div className="section-heading"><div><p className="eyebrow">TÖRZSVENDÉGEK</p><h1>Vendégszámlák</h1></div><span className="muted">{tabsData.length} nyitott számla</span></div>
        <form className="new-tab-form" onSubmit={createGuestTab}><input value={newTabName} onChange={e=>setNewTabName(e.target.value)} placeholder="Vendég neve" maxLength={80} required/><button className="primary" type="submit">+ Új vendég</button></form>
        <div className="tab-grid">{tabsData.map(row=><article className="tab-card" key={row.id}><div className="tab-card-head"><h2>{row.guest_name}</h2><button className="settle-btn" onClick={()=>settleGuestTab(row)}><Trash2 size={15}/> Rendezve / törlés</button></div>
          <div className="tab-items">{(row.tab_items||[]).map(item=><div className="tab-item" key={item.id}><span>{item.item_name}</span><div className="quantity-control"><button onClick={()=>changeTabItem(item,-1)} aria-label="Darabszám csökkentése">−</button><b>{item.quantity}</b><button onClick={()=>changeTabItem(item,1)} aria-label="Darabszám növelése">+</button></div></div>)}
          {!row.tab_items?.length&&<p className="muted empty-items">Még nincs felírt fogyasztás.</p>}</div>
          <form className="add-item-form" onSubmit={e=>{e.preventDefault();addTabItem(row.id)}}><input value={newItems[row.id]||""} onChange={e=>setNewItems(v=>({...v,[row.id]:e.target.value}))} placeholder="Új tétel neve" maxLength={100}/><button className="primary" type="submit">+ Tétel</button></form>
        </article>)}</div>
      </section>}
      {tab==="stats"&&owner&&<section><div className="section-heading"><div><p className="eyebrow">ÁTTEKINTÉS</p><h1>Statisztikák</h1></div><select value={range} onChange={e=>setRange(e.target.value)}><option value="today">Ma</option><option value="week">Ezen a héten</option><option value="month">Ebben a hónapban</option><option value="all">Összes eddigi</option></select></div>
        <div className="stat-grid"><div className="stat-card"><Wallet/><span>Bevétel</span><b>{money(totals.revenue)}</b></div><div className="stat-card"><Activity/><span>Lezárt játék</span><b>{totals.rows.length} db</b></div><div className="stat-card"><Clock3/><span>Összes játékidő</span><b>{duration(totals.duration)}</b></div></div>
        <h2 className="subhead">Eszközönként</h2><div className="table-wrap"><table><thead><tr><th>Eszköz</th><th>Játékok</th><th>Használati idő</th><th>Bevétel</th></tr></thead><tbody>{totals.devices.map(d=><tr key={d.key}><td>{d.name}</td><td>{d.rows.length}</td><td>{duration(d.rows.reduce((s,x)=>s+new Date(x.ended_at)-new Date(x.started_at),0))}</td><td>{money(d.rows.reduce((s,x)=>s+Number(x.amount||0),0))}</td></tr>)}</tbody></table></div>
      </section>}
      {tab==="history"&&owner&&<section><div className="section-heading"><div><p className="eyebrow">KORÁBBI JÁTÉKOK</p><h1>Forgalmi napló</h1></div><span className="muted">{history.length} lezárt játék</span></div>
        <div className="table-wrap"><table><thead><tr><th>Dátum</th><th>Vendég</th><th>Eszköz</th><th>Időtartam</th><th>Fizetendő</th><th>Művelet</th></tr></thead><tbody>{history.map(x=><tr key={x.id}><td>{new Date(x.ended_at).toLocaleString("hu-HU")}</td><td>{x.guest_name}</td><td>{DEVICES.find(d=>d.key===x.device_key)?.name||x.device_key}</td><td>{duration(new Date(x.ended_at)-new Date(x.started_at))}</td><td><b>{money(x.amount)}</b></td><td><button className="icon-btn" title="Játék törlése" onClick={()=>deleteSession(x)}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>
      </section>}
    </main><footer>LvL Up • Időmérő <span>{loading?"Szinkronizálás…":"Adatok szinkronizálva"}</span></footer>
  </div>;
}