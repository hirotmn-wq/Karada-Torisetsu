import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import supabase from "./supabase.js";
import Auth from "./Auth.jsx";


const TAGS = [
  {id:"eating_out",label:"会食",    dmg:2,  icon:"🍽", cat:"仕事系"},
  {id:"stress",    label:"修羅場",  dmg:4,  icon:"🔥", cat:"仕事系"},
  {id:"trip",      label:"出張",    dmg:3,  icon:"✈️", cat:"仕事系"},
  {id:"drinking",  label:"飲酒",    dmg:3,  icon:"🍺", cat:"食事系"},
  {id:"ramen",     label:"ラーメン", dmg:2,  icon:"🍜", cat:"食事系"},
  {id:"late_meal", label:"夜食",    dmg:2,  icon:"🌙", cat:"食事系"},
  {id:"exercise",  label:"運動",    dmg:-3, icon:"💪", cat:"体調系"},
  {id:"good_sleep",label:"よく寝た",dmg:-2, icon:"😴", cat:"体調系"},
  {id:"poor_sleep",label:"寝不足",  dmg:3,  icon:"😪", cat:"体調系"},
];

const COND_OPTS = [
  {v:"great",e:"💪",l:"キレあり", c:"#1D9E75",bg:"#e1f5ee"},
  {v:"good", e:"😐",l:"普通",    c:"#2563eb",bg:"#eff6ff"},
  {v:"bad",  e:"😮‍💨",l:"だるい",  c:"#d97706",bg:"#fef3c7"},
  {v:"worst",e:"💀",l:"限界",    c:"#c0392b",bg:"#fce8e8"},
];

// サンプル数の最低閾値
const MIN_SAMPLES = {
  drinking:8, eating_out:3, fried:3, ramen:3,
  exercise:5, poor_sleep:5, late_meal:3
};

const TEAL="#1D9E75",TEAL_BG="#e1f5ee",RED="#c0392b",RED_BG="#fce8e8",AMBER="#d97706",AMBER_BG="#fef3c7";
const todayStr = () => new Date().toISOString().split("T")[0];
const fmtDate  = d => { const x=new Date(d+"T00:00:00"); return `${x.getMonth()+1}/${x.getDate()}`; };

// ── パーソナルウエイト計算（指数減衰・サンプル閾値） ──────────────
function calcDecayProfile(logs, tagId, maxDays=4) {
  const relativeElevations = Array(maxDays).fill(0).map(()=>[]);
  for(let i=1; i<logs.length; i++){
    const log=logs[i], prev=logs[i-1];
    if(!(log.tags||[]).includes(tagId)) continue;
    const day0 = log.weight - prev.weight;
    if(day0 <= 0.1) continue;
    for(let d=1; d<=maxDays; d++){
      if(i+d >= logs.length) break;
      const next=logs[i+d];
      const gap=Math.floor((new Date(next.date+"T00:00:00")-new Date(log.date+"T00:00:00"))/(1000*60*60*24));
      if(gap !== d) break;
      relativeElevations[d-1].push(Math.max(0,(next.weight-prev.weight)/day0));
    }
  }
  const avgs=relativeElevations.map(arr=>arr.length>=2?+(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(2):null);
  if(avgs[0]===null) return null;
  return [1.0, ...avgs.filter(a=>a!==null)];
}

function calcPersonalWeights(logs) {
  const now = new Date();
  const result = {};
  TAGS.forEach(tag => {
    const samples = [];
    for(let i=1; i<logs.length; i++) {
      const log=logs[i], prev=logs[i-1];
      if(!(log.tags||[]).includes(tag.id)) continue;
      const logDate=new Date(log.date+"T00:00:00");
      const daysAgo=Math.floor((now-logDate)/(1000*60*60*24));
      if(daysAgo>90) continue;
      const gap=Math.floor((logDate-new Date(prev.date+"T00:00:00"))/(1000*60*60*24));
      if(gap>2) continue;
      const decay=daysAgo<=30?1.0:daysAgo<=60?0.6:0.3;
      samples.push({delta:+(log.weight-prev.weight).toFixed(2), decay});
    }
    const minN=MIN_SAMPLES[tag.id]||5;
    if(samples.length>=minN) {
      const td=samples.reduce((a,s)=>a+s.decay,0);
      const wd=samples.reduce((a,s)=>a+s.delta*s.decay,0)/td;
      const decayProfile=calcDecayProfile(logs, tag.id);
      result[tag.id]={delta:+wd.toFixed(2), sampleN:samples.length, calibrated:true, decayProfile};
    } else {
      result[tag.id]={delta:null, sampleN:samples.length, calibrated:false, needed:minN-samples.length};
    }
  });
  return result;
}

// ── コンディションスコア（7日ローリング） ──────────────────────────
function calcConditionScore(logs, weights) {
  if(logs.length < 2) return {level:"計測中", scoreColor:"#888", scoreBg:"#f0f0f0", reason:""};
const COMBOS = [
    {tags:["drinking","poor_sleep"], mod:1.5},
    {tags:["drinking","stress"],     mod:1.4},
    {tags:["trip","drinking"],       mod:1.4},
    {tags:["trip","stress"],         mod:1.3},
    {tags:["trip","poor_sleep"],     mod:1.3},
    {tags:["good_sleep","exercise"], mod:0.7},
    {tags:["good_sleep","poor_sleep"],mod:0.8},
  ];
  const comboMod = log => {
    const t = log.tags||[];
    return COMBOS.reduce((m,c)=>c.tags.every(x=>t.includes(x))?Math.max(m,c.mod):m, 1.0);
  };
  // 残存負荷の定義（日数ごとの残存率）
  const DECAY = {
    drinking:   [1.0, 0.4, 0.0],
    ramen:      [1.0, 0.0],
    late_meal:  [1.0, 0.0],
    eating_out: [1.0, 0.0],
    stress:     [1.0, 0.75, 0.5, 0.0],
    trip:       [1.0, 0.6, 0.0],
    meeting:    [1.0, 0.3, 0.0],
    poor_sleep: [1.0, 0.4, 0.0],
    exercise:   [-1.0, -0.4, 0.0],
    good_sleep: [-1.0, -0.5, 0.0],
  };

  const DEFAULT_DMG = {
    drinking:3, ramen:2, late_meal:2, eating_out:2,
    stress:4, trip:3, meeting:2, poor_sleep:3,
    exercise:-2, good_sleep:-3,
  };

  const today = new Date();
  let totalLoad = 0;

  // 直近7日のログを処理
  const recent = logs.slice(-7);
  recent.forEach(log => {
    const logDate = new Date(log.date + "T00:00:00");
    const daysAgo = Math.floor((today - logDate) / (1000*60*60*24));
    const mod = comboMod(log);
    (log.tags||[]).forEach(id => {
      const decay = weights[id]?.decayProfile || DECAY[id] || [1.0, 0.0];
      const dmg = weights[id]?.calibrated
        ? Math.abs(weights[id].delta) * (weights[id].delta > 0 ? 1 : -1)
        : DEFAULT_DMG[id] || 0;
      const rate = daysAgo < decay.length ? decay[daysAgo] : 0;
      totalLoad += dmg * rate * mod;
    });
  });

  // 体重トレンド補正
  if(recent.length >= 4){
    const h1 = recent.slice(0, Math.floor(recent.length/2));
    const h2 = recent.slice(Math.floor(recent.length/2));
    const avg = arr => arr.reduce((a,l)=>a+l.weight,0)/arr.length;
    const delta = avg(h2) - avg(h1);
    if(delta > 0.3) totalLoad += 1;
    else if(delta < -0.3) totalLoad -= 1;
  }

  // 直前3日の負荷トレンド（回復中判定）
  const prev3 = logs.slice(-6, -3);
  const curr3 = logs.slice(-3);
  const loadOf = arr => arr.reduce((a,l)=>a+((l.tags||[]).reduce((s,id)=>s+(DEFAULT_DMG[id]||0),0)),0);
  const isRecovering = prev3.length >= 2 && loadOf(curr3) < loadOf(prev3);

  // ステート判定
  let level, scoreColor, scoreBg, reason;
  if(totalLoad <= 1){
    level="安定"; scoreColor=TEAL; scoreBg=TEAL_BG;
    reason="負荷が低く、良いリズムです";
  } else if(isRecovering){
    level="回復中"; scoreColor="#2563eb"; scoreBg="#eff6ff";
    reason="最近の負荷が落ち着いてきています";
  } else if(totalLoad <= 6){
    level="負荷高め"; scoreColor=AMBER; scoreBg=AMBER_BG;
    reason="負荷の蓄積が見られます";
  } else {
    level="要リセット"; scoreColor=RED; scoreBg=RED_BG;
    reason="高負荷が続いています。意識的に回復を";
  }
  return {level, scoreColor, scoreBg, reason};
}

// ── AI用統計サマリー構築 ─────────────────────────────────────────
function buildStatsForAI(logs, weights, basic) {
  const lines=[];
  const age=basic.birthYear?new Date().getFullYear()-parseInt(basic.birthYear):null;
  if(age) lines.push(`対象: ${age}歳男性`);

  // パーソナルウエイト
  const cal=TAGS.filter(t=>weights[t.id]?.calibrated);
  if(cal.length>0) {
    lines.push("\n【行動→翌日体重（実データ算出）】");
    cal.forEach(t=>{
      const w=weights[t.id];
      lines.push(`${t.label}: ${w.delta>0?"+":""}${w.delta}kg (n=${w.sampleN})`);
    });
  }

  // 直近7日行動
  const r7=logs.slice(-7);
  const cnt={};TAGS.forEach(t=>cnt[t.id]=0);
  r7.forEach(l=>(l.tags||[]).forEach(id=>{if(cnt[id]!==undefined)cnt[id]++;}));
  lines.push("\n【直近7日の行動】");
  TAGS.forEach(t=>{if(cnt[t.id]>0)lines.push(`${t.label}: ${cnt[t.id]}回`);});

  // 連続飲酒パターン
  let consec=0, maxConsec=0;
  [...logs].reverse().forEach(l=>{
    if((l.tags||[]).includes("drinking")){consec++;maxConsec=Math.max(maxConsec,consec);}
    else consec=0;
  });
  if(maxConsec>=2) lines.push(`連続飲酒最大: ${maxConsec}日`);

  // 体重トレンド
  if(r7.length>=2){
    const d=+(r7[r7.length-1].weight-r7[0].weight).toFixed(1);
    lines.push(`\n【直近7日体重変化】${d>0?"+":""}${d}kg`);
  }

  // 主観コンディション
  const condData=r7.filter(l=>l.cond);
  if(condData.length>0){
    lines.push("\n【直近の主観コンディション】");
    condData.slice(-5).forEach(l=>{
      const o=COND_OPTS.find(x=>x.v===l.cond);
      if(o) lines.push(`${l.date}: ${o.l}`);
    });
  }

  return lines.join("\n");
}

// ── 実データ ─────────────────────────────────────────────────────
function genRealData() {
  return [
    {date:"2026-04-01",weight:69.2,tags:[],cond:""},
    {date:"2026-04-02",weight:67.9,tags:["drinking","eating_out"],cond:""},
    {date:"2026-04-03",weight:68.7,tags:[],cond:""},
    {date:"2026-04-05",weight:70.1,tags:["drinking"],cond:""},
    {date:"2026-04-06",weight:69.5,tags:[],cond:""},
    {date:"2026-04-07",weight:68.5,tags:["drinking","eating_out"],cond:""},
    {date:"2026-04-08",weight:67.9,tags:[],cond:""},
    {date:"2026-04-09",weight:68.2,tags:[],cond:""},
    {date:"2026-04-11",weight:68.7,tags:["drinking"],cond:""},
    {date:"2026-04-12",weight:69.9,tags:["drinking"],cond:""},
    {date:"2026-04-13",weight:68.8,tags:[],cond:""},
    {date:"2026-04-14",weight:68.6,tags:[],cond:""},
    {date:"2026-04-15",weight:67.9,tags:[],cond:""},
    {date:"2026-04-16",weight:67.7,tags:[],cond:""},
    {date:"2026-04-17",weight:67.9,tags:[],cond:""},
    {date:"2026-04-18",weight:69.2,tags:["drinking"],cond:""},
    {date:"2026-04-19",weight:70.0,tags:["drinking"],cond:""},
    {date:"2026-04-20",weight:68.1,tags:[],cond:""},
    {date:"2026-04-21",weight:67.8,tags:[],cond:""},
    {date:"2026-04-22",weight:67.3,tags:[],cond:""},
    {date:"2026-04-23",weight:67.4,tags:[],cond:""},
    {date:"2026-04-24",weight:67.5,tags:[],cond:""},
    {date:"2026-04-26",weight:68.4,tags:["drinking"],cond:""},
    {date:"2026-04-27",weight:67.9,tags:[],cond:""},
    {date:"2026-04-29",weight:68.5,tags:["drinking"],cond:""},
    {date:"2026-04-30",weight:67.6,tags:["drinking"],cond:""},
    {date:"2026-05-01",weight:68.0,tags:["drinking"],cond:""},
    {date:"2026-05-02",weight:68.7,tags:["drinking"],cond:""},
    {date:"2026-05-06",weight:68.0,tags:["drinking"],cond:""},
    {date:"2026-05-07",weight:67.0,tags:[],cond:""},
    {date:"2026-05-09",weight:67.9,tags:["drinking"],cond:""},
    {date:"2026-05-10",weight:68.7,tags:["drinking","eating_out"],cond:""},
    {date:"2026-05-11",weight:68.0,tags:[],cond:""},
    {date:"2026-05-12",weight:67.3,tags:[],cond:""},
    {date:"2026-05-13",weight:66.8,tags:[],cond:""},
    {date:"2026-05-14",weight:67.6,tags:[],cond:""},
    {date:"2026-05-16",weight:69.0,tags:["drinking"],cond:""},
    {date:"2026-05-18",weight:68.9,tags:[],cond:""},
    {date:"2026-05-19",weight:67.0,tags:[],cond:""},
    {date:"2026-05-20",weight:66.5,tags:[],cond:""},
    {date:"2026-05-21",weight:66.8,tags:[],cond:""},
    {date:"2026-05-22",weight:66.9,tags:[],cond:""},
    {date:"2026-05-24",weight:67.6,tags:["drinking"],cond:""},
    {date:"2026-05-25",weight:67.6,tags:[],cond:""},
  ];
}


// ── 危険予兆・好転サイン検出 ─────────────────────────────────────
function calcAlerts(logs) {
  const alerts = [];
  if(logs.length < 2) return alerts;
  const r7 = logs.slice(-7);

  // 今週飲酒回数
  const drinkN = r7.filter(l=>(l.tags||[]).includes("drinking")).length;
  if(drinkN >= 4) alerts.push({level:"warn", text:`今週 飲酒${drinkN}回 — 過多傾向`});

  // 連続飲酒
  let cd=0;
  for(let i=logs.length-1;i>=0;i--){
    if((logs[i].tags||[]).includes("drinking")) cd++;
    else break;
  }
  if(cd>=2) alerts.push({level:"warn", text:`飲酒 ${cd}日連続`});

  // 体重連続増加
  let ci=0;
  for(let i=logs.length-1;i>0;i--){
    if(logs[i].weight>logs[i-1].weight) ci++;
    else break;
  }
  if(ci>=3) alerts.push({level:"warn", text:`体重 ${ci}日連続増加`});

  // 好転：飲酒抑制
  if(drinkN<=1 && r7.length>=5) alerts.push({level:"good", text:"今週の飲酒を抑制できています"});

  // 好転：体重連続減少
  const r3=logs.slice(-3);
  if(r3.length===3 && r3[2].weight<r3[1].weight && r3[1].weight<r3[0].weight)
    alerts.push({level:"good", text:"体重 3日連続減少 — 良い流れ"});

  return alerts;
}

// ── クイックインサイト（コード生成・即表示） ──────────────────────
function calcQuickInsights(logs, weights) {
  const ins = [];

  // キャリブレーション済みタグをインパクト順に並べて上位2つ表示
  const cal = TAGS
    .filter(t => weights[t.id]?.calibrated)
    .sort((a,b) => Math.abs(weights[b.id].delta) - Math.abs(weights[a.id].delta))
    .slice(0, 2);

  cal.forEach(t => {
    const pw = weights[t.id];
    const sign = pw.delta > 0 ? "+" : "";
    ins.push(`${t.icon} ${t.label}翌日 ${sign}${pw.delta}kg の傾向`);
  });

  // 直近7日体重トレンド
  const r7 = logs.slice(-7);
  if(r7.length >= 2){
    const d = +(r7[r7.length-1].weight - r7[0].weight).toFixed(1);
    if(d <= -0.5) ins.push(`📉 直近7日で${d}kg 改善中`);
    else if(d >= 0.5) ins.push(`📈 直近7日で+${d}kg 増加傾向`);
  }

  return ins.slice(0, 3);
}

function calcTrendDir(logs, checkup) {
  const n=Math.min(logs.length,14), recent=logs.slice(-n);
  if(n<3) return null;
  const cnt={};TAGS.forEach(t=>cnt[t.id]=0);
  recent.forEach(l=>(l.tags||[]).forEach(id=>{if(cnt[id]!==undefined)cnt[id]++;}));
  const pw=id=>(cnt[id]/n)*7, drinkPW=pw("drinking"), dietPW=pw("eating_out")+pw("fried")+pw("ramen"), exPW=pw("exercise");
  const dir=(s,lo,hi)=>s>=hi?"↗":s<=lo?"↘":"→";
  const wt=(()=>{
    if(n<7) return {dir:"→",comment:"蓄積中"};
    const h1=recent.slice(0,Math.floor(n/2)),h2=recent.slice(Math.floor(n/2));
    const avg=a=>a.reduce((s,l)=>s+l.weight,0)/a.length;
    const d=+(avg(h2)-avg(h1)).toFixed(1);
    return d>0.3?{dir:"↗",comment:`+${d}kg`}:d<-0.3?{dir:"↘",comment:`${d}kg`}:{dir:"→",comment:"横ばい"};
  })();
  return {
    weight:{label:"体重",unit:"kg",val:recent[recent.length-1]?.weight,...wt},
    ggt:{label:"γ-GTP",unit:"U/L",val:checkup.ggt,dir:dir(drinkPW-exPW*0.3,0.8,2.5),comment:drinkPW>=2.5?`飲酒${drinkPW.toFixed(1)}回/週`:drinkPW<=0.8?"改善傾向":"概ね安定"},
    tg:{label:"中性脂肪",unit:"mg/dL",val:checkup.tg,dir:dir(dietPW-exPW*0.5,1,3),comment:dietPW>=3?"食事系多め":"現状維持"},
    ldl:{label:"LDL",unit:"mg/dL",val:checkup.ldl,dir:dir(pw("fried")+pw("ramen")*0.5-exPW*0.5,0.5,2),comment:""},
    bp:{label:"血圧",unit:"mmHg",val:checkup.sys&&checkup.dia?`${checkup.sys}/${checkup.dia}`:null,dir:dir(drinkPW*0.5+pw("poor_sleep")*0.3-exPW*0.4,0.5,2),comment:""},
    hba1c:{label:"HbA1c",unit:"%",val:checkup.hba1c,dir:dir(pw("late_meal")+pw("ramen")*0.3-exPW*0.3,0.3,1.5),comment:""},
  };
}

export default function App() {
  const [user,   setUser]  = useState(null);
  const [view,   setView]  = useState("loading");
  const [profile,setProf]  = useState(null);
  const [logs,   setLogs]  = useState([]);
  const [weight, setWeight]= useState("");
  const [selTags,setTags]  = useState([]);
  const [cond,   setCond]  = useState("");
  const [basic,  setBasic] = useState({birthYear:"",height:"",targetWeight:""});
  const [checkup,setChk]   = useState({sys:"",dia:"",ldl:"",hdl:"",tg:"",ggt:"",hba1c:""});
  const [ai,     setAi]    = useState({text:"",loading:false});
  const [chartPeriod, setChartPeriod] = useState("14d");
  const [personalWeights, setPersonalWeights] = useState({});

useEffect(()=>{
  console.log("useEffect: start");

  supabase.auth.getSession().then(({ data, error })=>{
    console.log("getSession result:", data?.session?.user?.id ?? "no user", error);
  });

  const { data:{ subscription } } = supabase.auth.onAuthStateChange((event, session)=>{
    console.log("auth event:", event, session?.user?.id ?? "no user");
  });

  return ()=>subscription.unsubscribe();
},[]);

  async function loadData(currentUser) {
    try {
      const [{ data: prof }, { data: logRows }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", currentUser.id).maybeSingle(),
        supabase.from("logs").select("*").eq("user_id", currentUser.id).order("date"),
      ]);
      const ls = (logRows || []).map(r => ({ date: r.date, weight: r.weight, tags: r.tags||[], cond: r.cond||"" }));
      setProf(prof);
      setLogs(ls);
      if(prof?.basic) setBasic(prof.basic);
      if(prof?.checkup) setChk(prof.checkup);
       // パーソナルウエイトの読み込み・必要なら再計算
      const savedWeights = prof?.personal_weights || {};
      const savedCount = prof?.weights_log_count || 0;
      if(ls.length - savedCount >= 10 || Object.keys(savedWeights).length === 0){
        const newWeights = calcPersonalWeights(ls);
        setPersonalWeights(newWeights);
        await supabase.from("profiles").upsert({id:currentUser.id, basic:prof?.basic||{}, checkup:prof?.checkup||{}, personal_weights:newWeights, weights_log_count:ls.length});
      } else {
        setPersonalWeights(savedWeights);
      }
      setView(!prof ? "welcome" : !ls.find(x=>x.date===todayStr()) ? "input" : "dashboard");
    } catch {
      setView("welcome");
    }
  }

  async function loadRealData(){
    if(!user) return;
    const basic={birthYear:"1979",height:"169",targetWeight:""};
    const checkup={sys:"125",dia:"76",ldl:"80",hdl:"59",tg:"124",ggt:"13",hba1c:"5.7"};
    const rl=genRealData();
    await supabase.from("profiles").upsert({id:user.id,basic,checkup});
    const logsToInsert=rl.map(l=>({user_id:user.id,date:l.date,weight:l.weight,tags:l.tags,cond:l.cond}));
    await supabase.from("logs").upsert(logsToInsert,{onConflict:"user_id,date"});
    setBasic(basic);setChk(checkup);setLogs(rl);setView("input");
  }

  async function saveBasic(){
    if(!user) return;
    await supabase.from("profiles").upsert({id:user.id,basic,checkup});
    setProf({basic,checkup});setView("setup_checkup");
  }

  async function saveCheckup(){
    if(!user) return;
    await supabase.from("profiles").upsert({id:user.id,basic,checkup});
    setProf({...profile,checkup});setView("input");
  }

  async function saveLog(){
    if(!user) return;
    const w=parseFloat(weight);
    if(isNaN(w)||w<30||w>200) return;
    await supabase.from("logs").upsert(
      {user_id:user.id,date:todayStr(),weight:w,tags:selTags,cond},
      {onConflict:"user_id,date"}
    );
    const log={date:todayStr(),weight:w,tags:selTags,cond};
    const nl=[...logs.filter(l=>l.date!==todayStr()),log].sort((a,b)=>a.date.localeCompare(b.date));
    // 10件ごとにウエイト再計算
      if(nl.length - (profile?.weights_log_count||0) >= 10){
        const newWeights = calcPersonalWeights(nl);
        setPersonalWeights(newWeights);
        await supabase.from("profiles").upsert({id:user.id, basic, checkup, personal_weights:newWeights, weights_log_count:nl.length});
      }
    setLogs(nl);setView("dashboard");
  }

  async function resetAll(){
    if(!user) return;
    await supabase.from("logs").delete().eq("user_id",user.id);
    await supabase.from("profiles").delete().eq("id",user.id);
    setProf(null);setLogs([]);setAi({text:"",loading:false});
    setBasic({birthYear:"",height:"",targetWeight:""});
    setChk({sys:"",dia:"",ldl:"",hdl:"",tg:"",ggt:"",hba1c:""});
    setView("welcome");
  }

  async function handleLogout(){
    await supabase.auth.signOut();
    setUser(null);setProf(null);setLogs([]);
  }

  async function analyze(){
    if(profile?.analysis_text && profile?.analysis_at){
      const lastDate=profile.analysis_at.split("T")[0];
      const lastLog=logs[logs.length-1]?.date??"";
      if(lastDate===todayStr() && lastLog<=lastDate){
        setAi({text:profile.analysis_text,loading:false});
        return;
      }
    }
    setAi({text:"",loading:true});
    const weights=calcPersonalWeights(logs);
    const stats=buildStatsForAI(logs,weights,basic);
    try{
      const res=await fetch("/api/analyze",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt:`あなたは健康データアナリストです。以下の統計サマリーをもとに、ユーザーに直接語りかける形で【あなただけの傾向】を3点、具体的に伝えてください。「あなたは〜」という二人称で。一般論禁止。数字・パターン根拠。箇条書き・日本語。\n\n${stats}`})
      });
      const d=await res.json();
      const text=d.content?.find(c=>c.type==="text")?.text||"分析できませんでした。";
      setAi({text,loading:false});
      if(user && text!=="分析できませんでした。"){
        await supabase.from("profiles").upsert({id:user.id,basic,checkup,analysis_text:text,analysis_at:new Date().toISOString()});
        setProf({...profile,analysis_text:text,analysis_at:new Date().toISOString()});
      }
    }catch{setAi({text:"エラーが発生しました。",loading:false});}
  }

  const today=todayStr();
  const todayLog=logs.find(l=>l.date===today);
  const prevLog=logs.filter(l=>l.date!==today).slice(-1)[0];
  const diff=todayLog&&prevLog?+(todayLog.weight-prevLog.weight).toFixed(1):null;
  const {level,scoreColor,scoreBg,reason}=calcConditionScore(logs,personalWeights);
  const trendDirs=calcTrendDir(logs,checkup);
  const chartData = (() => {
    if(chartPeriod==="week"){
      const groups = {};
      logs.forEach(l=>{
        const d=new Date(l.date+"T00:00:00");
        const mon=new Date(d); mon.setDate(d.getDate()-d.getDay()+1);
        const key=mon.toISOString().split("T")[0];
        if(!groups[key]) groups[key]=[];
        groups[key].push(l.weight);
      });
      return Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).slice(-12).map(([k,ws])=>({
        date:fmtDate(k)+"週",
        体重:+( ws.reduce((a,b)=>a+b,0)/ws.length ).toFixed(1)
      }));
    }
    if(chartPeriod==="month"){
      const groups = {};
      logs.forEach(l=>{
        const key=l.date.slice(0,7);
        if(!groups[key]) groups[key]=[];
        groups[key].push(l.weight);
      });
      return Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,ws])=>({
        date:k.slice(5)+"月",
        体重:+( ws.reduce((a,b)=>a+b,0)/ws.length ).toFixed(1)
      }));
    }
    const recent = logs.slice(-14);
    if(recent.length < 2) return recent.map(l=>({date:fmtDate(l.date),体重:l.weight,bridge:l.weight}));
    const start = new Date(recent[0].date+"T00:00:00");
    const end   = new Date(recent[recent.length-1].date+"T00:00:00");
    const result = [];
    for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
      const ds = d.toISOString().split("T")[0];
      const log = recent.find(l=>l.date===ds);
      const w = log?.weight??null;
      result.push({date:fmtDate(ds), 体重:w, bridge:w});
    }
    return result;
  })();
  const alerts=calcAlerts(logs);
  const quickInsights=calcQuickInsights(logs,personalWeights);
  const h=parseFloat(basic.height);
  const age=basic.birthYear?new Date().getFullYear()-parseInt(basic.birthYear):null;
  const currentW=todayLog?.weight??prevLog?.weight;
  const bmi=(h>0&&currentW)?+(currentW/((h/100)**2)).toFixed(1):null;
  const bmiLabel=!bmi?null:bmi<18.5?"低体重":bmi<25?"標準":bmi<30?"肥満(1度)":"肥満(2度以上)";
  const bmiColor=!bmi?null:bmi<25?TEAL:bmi<30?AMBER:RED;
  const targetW=basic.targetWeight?parseFloat(basic.targetWeight):h>0?+(25*(h/100)**2).toFixed(1):null;
  const toTarget=targetW&&currentW?+(currentW-targetW).toFixed(1):null;

  const s={
    page:{minHeight:"100vh",background:"#f8f9fa",fontFamily:"'Helvetica Neue',Arial,sans-serif"},
    header:{background:"#fff",borderBottom:"1px solid #eee",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"},
    appName:{fontSize:15,fontWeight:700,color:"#111",letterSpacing:"-0.3px"},
    body:{padding:"20px",maxWidth:540,margin:"0 auto"},
    card:{background:"#fff",borderRadius:12,border:"1px solid #eee",padding:"16px 18px",marginBottom:14},
    lbl:{fontSize:11,color:"#888",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.5px"},
    bigNum:{fontSize:28,fontWeight:600,lineHeight:1,color:"#111"},
    tagBtn:(sel,good)=>({display:"inline-flex",alignItems:"center",gap:5,padding:"7px 12px",fontSize:13,borderRadius:8,cursor:"pointer",border:"none",background:sel?(good?TEAL_BG:RED_BG):"#f0f0f0",color:sel?(good?TEAL:RED):"#444",fontWeight:sel?500:400}),
    btn:{width:"100%",padding:"12px",fontSize:14,fontWeight:500,borderRadius:10,border:"none",background:TEAL,color:"#fff",cursor:"pointer"},
    ghostBtn:{background:"#f0f0f0",color:"#555",border:"none",padding:"10px 16px",borderRadius:8,fontSize:13,cursor:"pointer"},
    outlineBtn:{background:"#fff",color:TEAL,border:`1.5px dashed ${TEAL}`,padding:"11px 16px",borderRadius:8,fontSize:13,cursor:"pointer",width:"100%",marginTop:10,fontWeight:500},
  }
  function TrendBadge({dir}) {
  const cfg={"↗":{c:RED,bg:RED_BG,l:"↗ 悪化リスク"},"→":{c:AMBER,bg:AMBER_BG,l:"→ 現状維持"},"↘":{c:TEAL,bg:TEAL_BG,l:"↘ 改善傾向"}}[dir]||{c:"#aaa",bg:"#f5f5f5",l:"—"};
  return <span style={{padding:"2px 8px",borderRadius:5,background:cfg.bg,color:cfg.c,fontSize:11,fontWeight:600}}>{cfg.l}</span>;
};

  if(view==="loading") return <div style={{...s.page,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:"#aaa"}}>読み込み中…</div></div>;
  if(view==="auth") return <Auth />;

  if(view==="welcome") return (
    <div style={{...s.page,display:"flex",flexDirection:"column"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",padding:"40px 28px"}}>
        <div style={{fontSize:30,fontWeight:700,color:"#111",marginBottom:6,letterSpacing:"-0.5px"}}>カラダトリセツ</div>
        <div style={{fontSize:15,color:"#555",marginBottom:36,lineHeight:1.6}}>自分のカラダのパターンを、<br/>データで知る。</div>
        <div style={{display:"flex",flexDirection:"column",gap:16,marginBottom:44}}>
          {[{icon:"⏱",text:"毎日10秒の記録だけ"},{icon:"📊",text:"「飲んだ翌日どうなるか」が数字で分かる"},{icon:"🎯",text:"あなた専用の傾向分析。一般論は出さない"}].map(item=>(
            <div key={item.icon} style={{display:"flex",alignItems:"center",gap:14}}>
              <span style={{fontSize:24,width:32,textAlign:"center"}}>{item.icon}</span>
              <span style={{fontSize:14,color:"#444",lineHeight:1.5}}>{item.text}</span>
            </div>
          ))}
        </div>
        <button style={s.btn} onClick={()=>setView("setup_basic")}>はじめる →</button>
        <button style={s.outlineBtn} onClick={loadRealData}>📥 実データをインポート</button>
      </div>
    </div>
  );

  if(view==="setup_basic") return (
    <div style={s.page}>
      <div style={s.header}><div style={s.appName}>カラダトリセツ</div><button style={s.ghostBtn} onClick={()=>setView("welcome")}>← 戻る</button></div>
      <div style={s.body}>
        <div style={{fontSize:17,fontWeight:600,color:"#111",marginBottom:4}}>基本情報</div>
        <div style={{fontSize:13,color:"#666",marginBottom:20}}>BMIと目標体重の計算に使います。</div>
        <div style={s.card}>
          {[{k:"birthYear",label:"生年",unit:"年",placeholder:"1979"},{k:"height",label:"身長",unit:"cm",placeholder:"170"},{k:"targetWeight",label:"目標体重",unit:"kg",placeholder:"任意"}].map(f=>(
            <div key={f.k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <div style={{fontSize:13,color:"#555",width:90,flexShrink:0}}>{f.label}</div>
              <input type="number" placeholder={f.placeholder} value={basic[f.k]}
                onChange={e=>setBasic({...basic,[f.k]:e.target.value})}
                style={{width:90,padding:"6px 10px",fontSize:14,border:"1px solid #ddd",borderRadius:6,outline:"none"}}/>
              <div style={{fontSize:12,color:"#aaa"}}>{f.unit}</div>
            </div>
          ))}
        </div>
        <button style={{...s.btn,opacity:(basic.birthYear&&basic.height)?1:0.4}} disabled={!basic.birthYear||!basic.height} onClick={saveBasic}>次へ →</button>
      </div>
    </div>
  );

  if(view==="setup_checkup") return (
    <div style={s.page}>
      <div style={s.header}><div style={s.appName}>カラダトリセツ</div><button style={s.ghostBtn} onClick={()=>setView(profile?"dashboard":"setup_basic")}>← 戻る</button></div>
      <div style={s.body}>
        <div style={{fontSize:17,fontWeight:600,color:"#111",marginBottom:4}}>{profile?.checkup?.sys?"健診データを更新":"健診データを入力（任意）"}</div>
        <div style={{fontSize:13,color:"#666",lineHeight:1.6,marginBottom:20}}>健診トレンドの分析に使います。未入力でも始められます。</div>
        <div style={s.card}>
          {[{k:"sys",label:"収縮期血圧",unit:"mmHg"},{k:"dia",label:"拡張期血圧",unit:"mmHg"},{k:"ldl",label:"LDLコレステロール",unit:"mg/dL"},{k:"hdl",label:"HDLコレステロール",unit:"mg/dL"},{k:"tg",label:"中性脂肪",unit:"mg/dL"},{k:"ggt",label:"γ-GTP",unit:"U/L"},{k:"hba1c",label:"HbA1c",unit:"%"}].map(f=>(
            <div key={f.k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <div style={{fontSize:13,color:"#555",width:160,flexShrink:0}}>{f.label}</div>
              <input type="number" placeholder="—" value={checkup[f.k]}
                onChange={e=>setChk({...checkup,[f.k]:e.target.value})}
                style={{width:80,padding:"6px 10px",fontSize:14,border:"1px solid #ddd",borderRadius:6,outline:"none"}}/>
              <div style={{fontSize:12,color:"#aaa"}}>{f.unit}</div>
            </div>
          ))}
        </div>
        <button style={s.btn} onClick={saveCheckup}>記録を始める →</button>
        <button style={s.outlineBtn} onClick={saveCheckup}>あとで入力する →</button>
      </div>
    </div>
  );

  if(view==="input") return (
    <div style={s.page}>
      <div style={s.header}><div style={s.appName}>カラダトリセツ</div>{logs.length>0&&<button style={s.ghostBtn} onClick={()=>setView("dashboard")}>← 戻る</button>}</div>
      <div style={s.body}>
        <div style={{fontSize:17,fontWeight:600,color:"#111",marginBottom:2}}>{new Date().toLocaleDateString("ja-JP",{month:"long",day:"numeric",weekday:"short"})}</div>
        <div style={{fontSize:12,color:"#aaa",marginBottom:20}}>10秒で記録完了</div>
        <div style={s.card}>
          <div style={s.lbl}>今朝の体重</div>
          <div style={{display:"flex",alignItems:"baseline",gap:8}}>
            <input type="number" placeholder={prevLog?String(prevLog.weight):"70.0"} value={weight}
              onChange={e=>setWeight(e.target.value)} step="0.1"
              style={{width:96,padding:"8px 12px",fontSize:22,fontWeight:500,border:"1px solid #ddd",borderRadius:8,outline:"none"}}/>
            <span style={{fontSize:15,color:"#555"}}>kg</span>
            {prevLog&&<span style={{fontSize:12,color:"#bbb",marginLeft:4}}>前回 {prevLog.weight}kg</span>}
          </div>
        </div>
        <div style={s.card}>
          <div style={s.lbl}>昨日の調子</div>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            {COND_OPTS.map(o=>(
              <button key={o.v} onClick={()=>setCond(p=>p===o.v?"":o.v)} style={{flex:1,padding:"10px 0",fontSize:12,borderRadius:8,cursor:"pointer",border:"none",background:cond===o.v?o.bg:"#f0f0f0",color:cond===o.v?o.c:"#666",fontWeight:cond===o.v?600:400,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                <span style={{fontSize:18}}>{o.e}</span><span>{o.l}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={s.card}>
          <div style={s.lbl}>昨日の行動（複数選択可）</div>
          
<div style={s.lbl}>昨日の負荷と回復</div>
{["仕事系","食事系","体調系"].map(cat=>(
  <div key={cat} style={{marginBottom:10}}>
    <div style={{fontSize:10,color:"#aaa",marginBottom:5}}>{cat}</div>
    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
      {TAGS.filter(t=>t.cat===cat).map(t=>{
        const sel=selTags.includes(t.id), good=t.dmg<0;
        return <button key={t.id} style={s.tagBtn(sel,good)}
          onClick={()=>setTags(p=>p.includes(t.id)?p.filter(x=>x!==t.id):[...p,t.id])}>
          <span>{t.icon}</span>{t.label}
        </button>;
      })}
    </div>
  </div>
))}
        </div>
        <button style={{...s.btn,opacity:weight?1:0.4}} onClick={saveLog} disabled={!weight}>記録する →</button>
      </div>
    </div>
  );

  // ── Dashboard ──────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.appName}>カラダトリセツ</div>
        <div style={{display:"flex",gap:8}}>
          <button style={{...s.ghostBtn,background:TEAL,color:"#fff"}} onClick={()=>{setTags([]);setWeight("");setCond("");setView("input");}}>今日を記録</button>
          <button style={s.ghostBtn} onClick={handleLogout}>ログアウト</button>
        </div>
      </div>
      <div style={s.body}>
        <div style={{fontSize:12,color:"#aaa",marginBottom:14}}>
          {new Date().toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"short"})}
        </div>

{/* 状態カード（全幅） */}
        <div style={{...s.card,background:scoreBg,borderColor:scoreColor+"44",marginBottom:10}}>
          <div style={{...s.lbl,color:scoreColor}}>今日の状態</div>
          <div style={{...s.bigNum,color:scoreColor,marginBottom:6}}>{level}</div>
          <div style={{fontSize:13,color:scoreColor,opacity:0.8,lineHeight:1.5}}>{reason}</div>
        </div>

        {/* 体重・記録日数（2列） */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <div style={s.card}>
            <div style={s.lbl}>今日の体重</div>
            <div style={s.bigNum}>{currentW??"—"}<span style={{fontSize:14,fontWeight:400}}> kg</span></div>
            {diff!==null&&<div style={{fontSize:12,marginTop:4,color:diff>0?RED:diff<0?TEAL:"#aaa"}}>{diff>0?"+":(diff<0?"":"±")}{diff}kg</div>}
          </div>
          <div style={s.card}>
            <div style={s.lbl}>記録日数</div>
            <div style={s.bigNum}>{logs.length}<span style={{fontSize:14,fontWeight:400}}> 日</span></div>
            <div style={{fontSize:11,color:"#bbb",marginTop:4}}>継続中</div>
          </div>
        </div>

        {/* 危険予兆・好転サイン */}
        {alerts.length>0&&(
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
            {alerts.map((a,i)=>(
              <div key={i} style={{
                display:"flex",alignItems:"center",gap:8,
                padding:"8px 14px",borderRadius:10,
                background:a.level==="warn"?RED_BG:TEAL_BG,
                border:`1px solid ${a.level==="warn"?RED+"44":TEAL+"44"}`,
              }}>
                <span style={{fontSize:15}}>{a.level==="warn"?"⚠️":"✅"}</span>
                <span style={{fontSize:13,fontWeight:500,color:a.level==="warn"?RED:TEAL}}>{a.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* 昨日の記録 */}
        {((todayLog?.tags?.length||0)>0||todayLog?.cond)&&(
          <div style={{...s.card,padding:"12px 16px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={s.lbl}>昨日の記録</div>
              {todayLog?.cond&&(()=>{const o=COND_OPTS.find(x=>x.v===todayLog.cond);return o?<span style={{padding:"3px 10px",fontSize:12,borderRadius:6,background:o.bg,color:o.c,fontWeight:500}}>{o.e} {o.l}</span>:null;})()}
            </div>
            {(todayLog?.tags?.length||0)>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {todayLog.tags.map(id=>{const t=TAGS.find(x=>x.id===id),good=t?.dmg<0;
                return <span key={id} style={{padding:"3px 10px",fontSize:12,borderRadius:6,background:good?TEAL_BG:RED_BG,color:good?TEAL:RED,fontWeight:500}}>{t?.icon} {t?.label}</span>;
              })}
            </div>}
          </div>
        )}

        {/* 健診トレンド */}
        {trendDirs&&(
          <div style={s.card}>
            <div style={{...s.lbl,marginBottom:10}}>健診項目トレンド</div>
            {Object.values(trendDirs).filter(r=>r.val!=null&&r.val!=="").map(r=>(
              <div key={r.label} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid #f5f5f5"}}>
                <div style={{width:76,fontSize:13,color:"#555",flexShrink:0}}>{r.label}</div>
                <div style={{width:86,fontSize:13,fontWeight:500,flexShrink:0}}>{r.val}<span style={{fontSize:11,color:"#aaa",fontWeight:400}}> {r.unit}</span></div>
                <TrendBadge dir={r.dir}/>
                {r.comment&&<div style={{fontSize:11,color:"#999"}}>{r.comment}</div>}
              </div>
            ))}
          </div>
        )}

        {/* 体重グラフ */}
        {chartData.length>1&&(
          <div style={s.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={s.lbl}>体重推移</div>
              <div style={{display:"flex",gap:4}}>
                {[{k:"14d",l:"14日"},{k:"week",l:"週平均"},{k:"month",l:"月平均"}].map(p=>(
                  <button key={p.k} onClick={()=>setChartPeriod(p.k)} style={{
                    padding:"3px 10px",fontSize:11,borderRadius:6,border:"none",cursor:"pointer",
                    background:chartPeriod===p.k?TEAL:"#f0f0f0",
                    color:chartPeriod===p.k?"#fff":"#888",
                    fontWeight:chartPeriod===p.k?600:400,
                  }}>{p.l}</button>
                ))}
              </div>
            </div>
            <div style={{height:150}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{top:4,right:8,bottom:0,left:-20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="date" tick={{fontSize:10,fill:"#bbb"}}/>
                  <YAxis tick={{fontSize:10,fill:"#bbb"}} domain={[d=>Math.floor(d)-1, d=>Math.ceil(d)+1]} allowDecimals={false} tickFormatter={v=>`${v}`}/>
                  <Tooltip content={({active,payload,label})=>{
                    if(!active||!payload) return null;
                    const item=payload.find(p=>p.dataKey==="体重"&&p.value!=null);
                    if(!item) return null;
                    return <div style={{background:"#fff",border:"1px solid #eee",borderRadius:8,padding:"8px 12px",fontSize:12}}>
                      <p style={{margin:0,color:"#888",marginBottom:2}}>{label}</p>
                      <p style={{margin:0,fontWeight:500,color:TEAL}}>{`体重: ${item.value}kg`}</p>
                    </div>;
                  }}/>
                  {chartPeriod==="14d" && <Line type="monotone" dataKey="bridge" stroke={TEAL} strokeWidth={1.5} strokeDasharray="5 4" connectNulls={true} dot={false} activeDot={false}/>}
                  <Line type="monotone" dataKey="体重" stroke={TEAL} strokeWidth={2}
                    connectNulls={chartPeriod!=="14d"} dot={{r:3,fill:TEAL}} activeDot={{r:4}}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* AI分析 */}
        <div style={s.card}>
          <div style={{fontSize:13,fontWeight:600,color:"#111",marginBottom:10}}>あなたの傾向</div>
          {quickInsights.length>0?(
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
              {quickInsights.map((ins,i)=>(
                <div key={i} style={{fontSize:13,color:"#333",lineHeight:1.5}}>{ins}</div>
              ))}
            </div>
          ):(
            <div style={{fontSize:12,color:"#bbb",marginBottom:12}}>記録が増えると傾向が表示されます。</div>
          )}
          {!ai.text&&(
            <button onClick={analyze} disabled={ai.loading} style={{
              fontSize:12,color:TEAL,background:"none",border:`1px solid ${TEAL}44`,
              borderRadius:6,padding:"5px 12px",cursor:"pointer",
            }}>{ai.loading?"分析中…":"詳細を見る →"}</button>
          )}
          {ai.text&&(
            <div>
              <div style={{height:1,background:"#f0f0f0",margin:"10px 0"}}/>
              <div style={{fontSize:13,lineHeight:1.8,color:"#444",whiteSpace:"pre-wrap"}}>{ai.text}</div>
              <button onClick={()=>setAi({text:"",loading:false})} style={{
                fontSize:11,color:"#bbb",background:"none",border:"none",cursor:"pointer",marginTop:8,padding:0,
              }}>閉じる</button>
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button style={s.ghostBtn} onClick={()=>setView("setup_checkup")}>健診データを更新</button>
          <button style={{...s.ghostBtn,color:RED,marginLeft:"auto"}} onClick={resetAll}>リセット</button>
        </div>
      </div>
    </div>
  );
}
