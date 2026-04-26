import { useState, useMemo, useEffect, useCallback, useRef } from "react";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzmwB57P_GMScb1Hx7N1EgKqY3oB_ucnCDKFoUruQqsv7Wd1PnHy5CwqPLUJ2Caso4lFg/exec";
const C = {
  dark:"#0F2444", mid:"#1A3A6B", accent:"#2563EB",
  bg:"#F0F5FF", white:"#FFFFFF", border:"#C7D9F5",
  text:"#0F2444", muted:"#6B84A8",
};

const ESTADOS = {
  recibido:  { label:"Recibido",   color:"#2563EB", bg:"#EFF6FF", icon:"📥" },
  proceso:   { label:"En proceso", color:"#D97706", bg:"#FFFBEB", icon:"🔄" },
  listo:     { label:"Para Retiro, color:"#16A34A", bg:"#F0FDF4", icon:"✅" },
  entregado: { label:"Entregado",     color:"#6B7280", bg:"#F9FAFB", icon:"📤" },
};

const LUGARES = ["BodegaDSAL","LavDDA"];
const LUGAR_COLORS = {
  "BodegaDSAL":{ bg:"#FEF3C7", color:"#92400E", icon:"🏭" },
  "LavDDA":    { bg:"#DBEAFE", color:"#1E40AF", icon:"🧺" },
};

// Auto-refresh cada 60 s. Cambia a 0 para deshabilitar.
const AUTO_REFRESH_MS = 60000;

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatDate    = d => { if(!d) return "—"; const p=String(d).split("T")[0].split("-"); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d; };
const formatDateFull= () => { const n=new Date(); return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")}/${n.getFullYear()} ${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`; };
const today         = () => new Date().toISOString().split("T")[0];

const rowToOrder = row => ({
  id:             Number(row.ID),
  folio:          row.Folio||"",
  cliente:        row.Cliente||"",
  contacto:       row.Contacto||"",
  telefono:       String(row.Telefono||""),
  lugar:          row.Lugar||"BodegaDSAL",
  estado:         row.Estado||"recibido",
  fechaRecepcion: String(row.FechaRecepcion||"").split("T")[0],
  fechaEntrega:   String(row.FechaEntrega||"").split("T")[0],
  fechaEntregaReal: row.FechaEntregaReal||"",
  bolsas:         Number(row.Bolsas)||0,
  kilos:          Number(row.Kilos)||0,
  notas:          row.Notas||"",
  recibidoPor:    row.RecibidoPor||"",
});

const orderToPayload = o => ({
  ID:o.id, Folio:o.folio, Cliente:o.cliente, Contacto:o.contacto,
  Telefono:o.telefono, Lugar:o.lugar, Estado:o.estado,
  FechaRecepcion:o.fechaRecepcion, FechaEntrega:o.fechaEntrega,
  FechaEntregaReal:o.fechaEntregaReal||"",
  Bolsas:o.bolsas, Kilos:o.kilos, Notas:o.notas,
  RecibidoPor:o.recibidoPor||"",
});

// fetch sin Content-Type para evitar preflight CORS en Apps Script
const sheetPost = async d => {
  const r = await fetch(SCRIPT_URL,{method:"POST",body:JSON.stringify(d)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  // Backend v6 devuelve {ok, data, error}; v5 devuelve {success}
  if (j && j.ok === false) throw new Error(j.error||"Error del backend");
  return j;
};
const sheetGet = async () => {
  const r = await fetch(SCRIPT_URL);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// ── Excel Export ──────────────────────────────────────────────────────────────
const exportToExcel = (orders, label="todas") => {
  const headers = ["Folio","ID","Empresa","Contacto","Teléfono","Lugar","Estado","Fecha Recepción","Fecha Entrega Est.","Fecha Entrega Real","Bolsas","Kilos","Recibido Por","Notas"];
  const rows = orders.map(o=>[
    o.folio,o.id,o.cliente,o.contacto,o.telefono,o.lugar,
    ESTADOS[o.estado]?.label||o.estado,
    o.fechaRecepcion,o.fechaEntrega,o.fechaEntregaReal,
    o.bolsas,o.kilos,o.recibidoPor,o.notas
  ]);
  const csv=[headers,...rows].map(r=>r.map(c=>`"${String(c??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`lavanderia_neuquen_${label}_${today()}.csv`; a.click();
  URL.revokeObjectURL(url);
};

// ── Ticket imprimible ─────────────────────────────────────────────────────────
const printTicket = (empresa, ordenes, recibidoPor, fechaHora) => {
  const totalBolsas = ordenes.reduce((a,o)=>a+o.bolsas,0);
  const totalKilos  = ordenes.reduce((a,o)=>a+o.kilos,0);
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Comprobante Entrega - ${empresa}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Arial',sans-serif;padding:30px;color:#111;max-width:520px;margin:0 auto;}
    .header{text-align:center;border-bottom:3px solid #0F2444;padding-bottom:16px;margin-bottom:20px;}
    .logo{font-size:28px;margin-bottom:6px;}
    .title{font-size:20px;font-weight:700;color:#0F2444;letter-spacing:-0.5px;}
    .subtitle{font-size:12px;color:#6B84A8;letter-spacing:1px;text-transform:uppercase;margin-top:2px;}
    .ticket-num{background:#0F2444;color:#7BA3D4;font-size:12px;font-weight:700;padding:4px 10px;border-radius:5px;display:inline-block;margin-top:8px;letter-spacing:0.5px;}
    .section{margin-bottom:18px;}
    .section-title{font-size:11px;font-weight:700;color:#6B84A8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;border-bottom:1px solid #E5E7EB;padding-bottom:4px;}
    .field{display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px;}
    .field-key{color:#6B7280;}
    .field-val{font-weight:600;color:#111;}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px;}
    th{background:#F0F5FF;color:#6B84A8;font-size:10px;text-transform:uppercase;padding:7px 10px;text-align:left;letter-spacing:0.5px;}
    td{padding:7px 10px;border-bottom:1px solid #F3F4F6;color:#111;}
    .totals{background:#0F2444;color:white;border-radius:8px;padding:14px 18px;margin-top:18px;display:flex;justify-content:space-between;align-items:center;}
    .total-item{text-align:center;}
    .total-val{font-size:22px;font-weight:700;}
    .total-label{font-size:10px;color:#7BA3D4;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;}
    .firma-section{margin-top:28px;border:1.5px dashed #D1D5DB;border-radius:8px;padding:18px;}
    .firma-title{font-size:11px;color:#6B84A8;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;}
    .firma-linea{border-bottom:1.5px solid #111;margin-bottom:6px;height:40px;}
    .firma-label{font-size:11px;color:#6B7280;text-align:center;}
    .firma-nombre{font-size:14px;font-weight:700;color:#0F2444;text-align:center;margin-top:4px;}
    .footer{text-align:center;font-size:10px;color:#9CA3AF;margin-top:24px;border-top:1px solid #E5E7EB;padding-top:14px;}
    @media print{body{padding:10px;} .no-print{display:none;}}
  </style>
</head>
<body>
  <div class="header">
    <div class="logo"><img src="${window.location.origin}/logo.png" alt="Logo" style="width:64px;height:64px;object-fit:contain;"/></div>
    <div class="title">Lavandería Neuquén</div>
    <div class="subtitle">Comprobante de Entrega</div>
    <div class="ticket-num">ENTREGA · ${fechaHora}</div>
  </div>

  <div class="section">
    <div class="section-title">Datos de la Empresa</div>
    <div class="field"><span class="field-key">Empresa</span><span class="field-val">${empresa}</span></div>
    <div class="field"><span class="field-key">Fecha y hora</span><span class="field-val">${fechaHora}</span></div>
    <div class="field"><span class="field-key">Recibido por</span><span class="field-val">${recibidoPor}</span></div>
  </div>

  <div class="section">
    <div class="section-title">Órdenes Entregadas (${ordenes.length})</div>
    <table>
      <thead><tr><th>Folio</th><th>Lugar</th><th>Bolsas</th><th>Kilos</th></tr></thead>
      <tbody>
        ${ordenes.map(o=>`
          <tr>
            <td><strong>${o.folio||"#"+o.id}</strong></td>
            <td>${o.lugar}</td>
            <td>${o.bolsas}</td>
            <td>${o.kilos} kg</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  </div>

  <div class="totals">
    <div class="total-item"><div class="total-val">${ordenes.length}</div><div class="total-label">Órdenes</div></div>
    <div class="total-item"><div class="total-val">${totalBolsas} 🧺</div><div class="total-label">Bolsas</div></div>
    <div class="total-item"><div class="total-val">${totalKilos} kg</div><div class="total-label">Kilos</div></div>
  </div>

  <div class="firma-section">
    <div class="firma-title">✍️ Confirmación de recepción</div>
    <div class="firma-linea"></div>
    <div class="firma-nombre">${recibidoPor}</div>
    <div class="firma-label">Firma y nombre de quien recibe</div>
  </div>

  <div class="footer">
    Lavandería Neuquén · Control Industrial de Prendas<br/>
    Este documento es comprobante válido de entrega
  </div>

  <br/><button class="no-print" onclick="window.print()" style="width:100%;padding:12px;background:#2563EB;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">🖨️ Imprimir comprobante</button>
  <script>
    // Imprimir cuando todo (incluidas fuentes/imagenes) cargó
    window.addEventListener('load', () => setTimeout(() => window.print(), 200));
  </script>
</body>
</html>`;
  const w = window.open("","_blank");
  if (!w) { alert("Permite ventanas emergentes para imprimir el comprobante."); return; }
  w.document.write(html);
  w.document.close();
};

// ── Report helpers ────────────────────────────────────────────────────────────
const isoWeek = d => {
  const dt=new Date(d); dt.setHours(0,0,0,0);
  dt.setDate(dt.getDate()+3-(dt.getDay()+6)%7);
  const w1=new Date(dt.getFullYear(),0,4);
  return `${dt.getFullYear()}-W${String(1+Math.round(((dt-w1)/86400000-3+(w1.getDay()+6)%7)/7)).padStart(2,"0")}`;
};

const buildReport=(orders,filter)=>{
  const f=orders.filter(filter);
  return {
    total:f.length, kilos:f.reduce((a,o)=>a+o.kilos,0), bolsas:f.reduce((a,o)=>a+o.bolsas,0),
    pendientes:f.filter(o=>o.estado!=="entregado").length,
    entregados:f.filter(o=>o.estado==="entregado").length,
    porEstado:Object.fromEntries(Object.keys(ESTADOS).map(k=>[k,f.filter(o=>o.estado===k).length])),
    porLugar:LUGARES.map(l=>([l,f.filter(o=>o.lugar===l).length])),
    topEmpresas:Object.entries(f.reduce((acc,o)=>{acc[o.cliente]=(acc[o.cliente]||0)+1;return acc;},{})).sort((a,b)=>b[1]-a[1]).slice(0,5),
    orders:f,
  };
};

// ── Styles ────────────────────────────────────────────────────────────────────
const S={
  root:{display:"flex",height:"100vh",background:C.bg,fontFamily:"'Inter',sans-serif",overflow:"hidden"},
  toast:{position:"fixed",top:20,right:20,padding:"12px 20px",borderRadius:10,color:"white",fontWeight:600,fontSize:14,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.2)"},
  sidebar:{width:250,background:C.dark,display:"flex",flexDirection:"column",padding:"24px 16px",gap:18,flexShrink:0,overflowY:"auto"},
  logo:{display:"flex",alignItems:"center",gap:12},
  logoTitle:{color:"white",fontSize:16,fontWeight:700,lineHeight:1.2},
  logoSub:{color:"#7BA3D4",fontSize:10,letterSpacing:1.5,textTransform:"uppercase",marginTop:2},
  nav:{display:"flex",flexDirection:"column",gap:4},
  navBtn:{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:9,border:"none",background:"transparent",color:"#7BA3D4",fontSize:13,cursor:"pointer",textAlign:"left",fontFamily:"'Inter',sans-serif",fontWeight:500},
  navBtnActive:{background:C.accent,color:"white"},
  navBtnEntrega:{background:"#16A34A",color:"white"},
  syncBox:{background:"rgba(255,255,255,0.07)",borderRadius:9,padding:"10px 12px"},
  syncRow:{display:"flex",alignItems:"center",gap:8},
  syncDot:{width:7,height:7,borderRadius:"50%",flexShrink:0},
  syncLabel:{color:"#7BA3D4",fontSize:11,flex:1},
  syncBtn:{background:"none",border:"none",color:"#7BA3D4",cursor:"pointer",fontSize:15},
  statsBox:{background:"rgba(255,255,255,0.07)",borderRadius:11,padding:"14px",display:"flex",flexDirection:"column",gap:8},
  statsTitle:{color:"#7BA3D4",fontSize:10,letterSpacing:1.5,textTransform:"uppercase",marginBottom:2},
  statRow:{display:"flex",alignItems:"center",gap:8},
  statDot:{width:7,height:7,borderRadius:"50%",flexShrink:0},
  statLabel:{color:"#A8C4E0",fontSize:12,flex:1},
  statNum:{color:"white",fontSize:13,fontWeight:700},
  divider:{height:1,background:"rgba(255,255,255,0.1)",margin:"4px 0"},
  loadingOverlay:{position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(240,245,255,0.92)",zIndex:100},
  loadingBox:{display:"flex",flexDirection:"column",alignItems:"center",gap:16},
  spinner:{width:36,height:36,border:`3px solid ${C.border}`,borderTop:`3px solid ${C.accent}`,borderRadius:"50%",animation:"spin 0.8s linear infinite"},
  main:{flex:1,padding:28,overflowY:"auto"},
  panel:{maxWidth:940,margin:"0 auto"},
  panelHeader:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24},
  panelTitle:{fontSize:26,color:C.dark,fontWeight:700,letterSpacing:-0.5},
  panelSub:{color:C.muted,fontSize:13,marginTop:3},
  filters:{display:"flex",flexDirection:"column",gap:10,marginBottom:20},
  searchInput:{padding:"10px 16px",borderRadius:9,border:`1.5px solid ${C.border}`,background:"white",fontSize:13,width:"100%",fontFamily:"'Inter',sans-serif",color:C.text},
  estadoFilters:{display:"flex",gap:7,flexWrap:"wrap"},
  filterChip:{padding:"5px 14px",borderRadius:18,border:`1.5px solid ${C.border}`,background:"white",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"'Inter',sans-serif",fontWeight:500},
  filterChipActive:{background:C.accent,color:"white",borderColor:C.accent},
  lugarChip:{padding:"5px 14px",borderRadius:18,border:`1.5px solid ${C.border}`,background:"white",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"'Inter',sans-serif",fontWeight:500},
  lugarChipActive:{background:C.mid,color:"white",borderColor:C.mid},
  orderList:{display:"flex",flexDirection:"column",gap:10},
  orderCard:{background:"white",borderRadius:13,padding:"16px 20px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",cursor:"pointer",border:`1.5px solid ${C.border}`,boxShadow:"0 1px 6px rgba(37,99,235,0.06)"},
  orderCardLeft:{display:"flex",gap:14,alignItems:"flex-start",flex:1},
  folioBadge:{background:C.dark,color:"#7BA3D4",fontWeight:700,fontSize:11,padding:"3px 9px",borderRadius:6,whiteSpace:"nowrap",letterSpacing:0.5},
  lugarBadge:{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:5,whiteSpace:"nowrap"},
  orderEmpresa:{fontWeight:700,fontSize:15,color:C.dark,marginBottom:2},
  orderContacto:{fontSize:12,color:C.accent,fontWeight:500,marginBottom:3},
  orderMeta:{fontSize:11,color:C.muted,marginBottom:6},
  orderMetrics:{display:"flex",gap:8,flexWrap:"wrap"},
  metricPill:{padding:"3px 10px",background:C.bg,borderRadius:10,fontSize:12,color:C.mid,fontWeight:600,border:`1px solid ${C.border}`},
  orderCardRight:{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6},
  estadoBadge:{padding:"3px 11px",borderRadius:18,border:"1.5px solid",fontSize:11,fontWeight:700,whiteSpace:"nowrap"},
  empty:{textAlign:"center",padding:60,color:C.muted,fontSize:14},
  btnPrimary:{padding:"9px 22px",background:C.accent,color:"white",border:"none",borderRadius:9,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"'Inter',sans-serif"},
  btnSecondary:{padding:"9px 16px",background:"white",color:C.mid,border:`1.5px solid ${C.border}`,borderRadius:9,fontWeight:500,fontSize:13,cursor:"pointer",fontFamily:"'Inter',sans-serif"},
  btnDanger:{padding:"9px 16px",background:"white",color:"#DC2626",border:"1.5px solid #FCA5A5",borderRadius:9,fontWeight:500,fontSize:13,cursor:"pointer",fontFamily:"'Inter',sans-serif"},
  btnSuccess:{padding:"9px 16px",background:"#16A34A",color:"white",border:"none",borderRadius:9,fontWeight:500,fontSize:13,cursor:"pointer",fontFamily:"'Inter',sans-serif"},
  btnEstado:{padding:"5px 10px",borderRadius:7,border:"1.5px solid",fontSize:11,fontWeight:600,cursor:"pointer",background:"white",fontFamily:"'Inter',sans-serif"},
  formGrid:{display:"flex",flexDirection:"column",gap:16},
  formSection:{background:"white",borderRadius:13,padding:"20px 24px",border:`1.5px solid ${C.border}`,display:"flex",flexDirection:"column",gap:12,boxShadow:"0 1px 4px rgba(37,99,235,0.05)"},
  sectionTitle:{fontWeight:700,fontSize:13,color:C.mid,marginBottom:2},
  formRow:{display:"flex",flexDirection:"column",gap:5},
  formRowDouble:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12},
  label:{fontSize:12,color:C.muted,fontWeight:500},
  input:{padding:"9px 12px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"'Inter',sans-serif",background:"white",color:C.text,width:"100%"},
  lugarSelector:{display:"flex",gap:10},
  lugarOption:{flex:1,padding:"12px",borderRadius:10,border:`2px solid ${C.border}`,background:"white",cursor:"pointer",textAlign:"center",fontFamily:"'Inter',sans-serif"},
  lugarOptionActive:{border:`2px solid ${C.accent}`,background:"#EFF6FF"},
  lugarOptionLabel:{fontWeight:700,fontSize:14,color:C.dark},
  lugarOptionSub:{fontSize:11,color:C.muted,marginTop:2},
  formActions:{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20},
  detailGrid:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14},
  detailCard:{background:"white",borderRadius:13,padding:"18px 22px",border:`1.5px solid ${C.border}`,display:"flex",flexDirection:"column",gap:10,boxShadow:"0 1px 4px rgba(37,99,235,0.05)"},
  detailField:{display:"flex",justifyContent:"space-between",fontSize:13,color:C.text,padding:"5px 0",borderBottom:`1px solid ${C.bg}`},
  detailKey:{color:C.muted,fontWeight:500},
  bigMetric:{textAlign:"center",padding:"16px",background:C.bg,borderRadius:10,border:`1px solid ${C.border}`},
  bigMetricVal:{fontSize:36,fontWeight:700,color:C.dark,letterSpacing:-1},
  bigMetricLabel:{fontSize:12,color:C.muted,marginTop:4},
  table:{width:"100%",borderCollapse:"collapse",fontSize:13},
  th:{textAlign:"left",padding:"10px 14px",background:C.bg,color:C.muted,fontWeight:600,fontSize:11,textTransform:"uppercase",letterSpacing:0.5},
  td:{padding:"10px 14px",color:C.text,borderBottom:`1px solid ${C.bg}`},
  trEven:{background:"#FAFCFF"},
  historyCard:{background:C.bg,borderRadius:9,padding:"12px 14px",border:`1px solid ${C.border}`,marginTop:8},
  historyTitle:{fontSize:12,color:C.accent,fontWeight:700,marginBottom:6},
  historyRow:{fontSize:12,color:C.mid,marginBottom:4,display:"flex",alignItems:"center",gap:6},
  reportTabs:{display:"flex",gap:0,marginBottom:24,background:"white",borderRadius:10,padding:4,border:`1.5px solid ${C.border}`,width:"fit-content"},
  reportTab:{padding:"8px 22px",borderRadius:7,border:"none",background:"transparent",color:C.muted,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Inter',sans-serif"},
  reportTabActive:{background:C.accent,color:"white"},
  kpiGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24},
  kpiCard:{background:"white",borderRadius:13,padding:"18px 20px",border:`1.5px solid ${C.border}`,textAlign:"center",boxShadow:"0 1px 4px rgba(37,99,235,0.05)"},
  kpiValue:{fontSize:30,color:C.dark,fontWeight:700,letterSpacing:-1},
  kpiLabel:{fontSize:12,color:C.muted,marginTop:4},
  kpiSub:{fontSize:11,color:C.accent,marginTop:2,fontWeight:600},
  reportSection:{background:"white",borderRadius:13,padding:"18px 22px",border:`1.5px solid ${C.border}`,marginBottom:14},
  reportSectionTitle:{fontWeight:700,fontSize:13,color:C.mid,marginBottom:14},
  barRow:{display:"flex",alignItems:"center",gap:10,marginBottom:8},
  barLabel:{fontSize:12,color:C.mid,width:110,flexShrink:0},
  barTrack:{flex:1,background:C.bg,borderRadius:4,height:14,overflow:"hidden"},
  barFill:{height:"100%",borderRadius:4,transition:"width 0.6s ease"},
  barVal:{fontSize:12,color:C.mid,width:28,textAlign:"right",flexShrink:0},
  // Entrega styles
  entregaEmpresaCard:{background:"white",borderRadius:13,padding:"18px 20px",border:`1.5px solid ${C.border}`,cursor:"pointer",boxShadow:"0 1px 6px rgba(37,99,235,0.06)",marginBottom:10},
  entregaOrdenRow:{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",background:"white",borderRadius:10,border:`1.5px solid ${C.border}`,marginBottom:8},
  checkBox:{width:20,height:20,borderRadius:5,border:`2px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0},
  checkBoxActive:{background:C.accent,borderColor:C.accent,color:"white"},
  confirmBox:{background:"#F0FDF4",border:"2px solid #16A34A",borderRadius:13,padding:"24px",marginTop:16},
  confirmTitle:{fontSize:16,fontWeight:700,color:"#15803D",marginBottom:16},
  successOverlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200},
  successBox:{background:"white",borderRadius:20,padding:"40px",textAlign:"center",maxWidth:420,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"},
  successIcon:{fontSize:60,marginBottom:16},
  successTitle:{fontSize:22,fontWeight:700,color:"#15803D",marginBottom:8},
  successSub:{fontSize:14,color:C.muted,marginBottom:24},
  // Modal de confirmación genérico
  modalOverlay:{position:"fixed",inset:0,background:"rgba(15,36,68,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300},
  modalBox:{background:"white",borderRadius:14,padding:"28px",maxWidth:420,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"},
  modalTitle:{fontSize:17,fontWeight:700,color:C.dark,marginBottom:8},
  modalText:{fontSize:14,color:C.muted,marginBottom:20,lineHeight:1.5},
  modalActions:{display:"flex",justifyContent:"flex-end",gap:10},
};

export default function App() {
  const [orders,setOrders]             = useState([]);
  const [view,setView]                 = useState("lista");
  const [selectedId,setSelectedId]     = useState(null);
  const [filtroEstado,setFiltroEstado] = useState("todos");
  const [filtroLugar,setFiltroLugar]   = useState("todos");
  const [busqueda,setBusqueda]         = useState("");
  const [loading,setLoading]           = useState(true);
  const [syncing,setSyncing]           = useState(false);
  const [syncStatus,setSyncStatus]     = useState(null);
  const [lastSync,setLastSync]         = useState(null);
  const [toast,setToast]               = useState(null);
  const [confirmModal,setConfirmModal] = useState(null); // {title, text, onConfirm}
  const [reportPeriod,setReportPeriod] = useState("daily");
  const [empresaBuscada,setEmpresaBuscada]     = useState("");
  const [empresaSeleccionada,setEmpresaSeleccionada] = useState(null);

  // Edit state
  const [editingId,setEditingId] = useState(null);

  // Entrega state
  const [entregaBusqueda,setEntregaBusqueda]   = useState("");
  const [entregaEmpresa,setEntregaEmpresa]     = useState(null);
  const [entregaSeleccion,setEntregaSeleccion] = useState([]);
  const [entregaRecibe,setEntregaRecibe]       = useState("");
  const [entregaSuccess,setEntregaSuccess]     = useState(null);
  const lastTicketRef = useRef(null);

  const emptyForm={cliente:"",contacto:"",telefono:"",lugar:"BodegaDSAL",estado:"recibido",fechaRecepcion:today(),fechaEntrega:"",bolsas:"",kilos:"",notas:""};
  const [form,setForm] = useState(emptyForm);

  const showToast=(msg,type="ok")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3500); };

  const loadFromSheets=useCallback(async(silent=false)=>{
    if(!silent) setLoading(true);
    try {
      const rows=await sheetGet();
      if(Array.isArray(rows)){
        const loaded=rows.map(rowToOrder).filter(o=>o.id);
        setOrders(loaded);
      }
      setSyncStatus("ok");
      setLastSync(new Date());
    } catch { setSyncStatus("error"); if(!silent) showToast("No se pudo conectar con Google Sheets","error"); }
    finally { if(!silent) setLoading(false); }
  },[]);

  // Carga inicial
  useEffect(()=>{ loadFromSheets(); },[loadFromSheets]);

  // Auto-refresh
  useEffect(()=>{
    if(!AUTO_REFRESH_MS) return;
    const t=setInterval(()=>loadFromSheets(true), AUTO_REFRESH_MS);
    return ()=>clearInterval(t);
  },[loadFromSheets]);

  const selected=orders.find(o=>o.id===selectedId);
  const clientHistory=selected?orders.filter(o=>o.cliente===selected.cliente&&o.id!==selected.id):[];

  const filtered=useMemo(()=>orders.filter(o=>{
    const q=busqueda.toLowerCase();
    const mE=filtroEstado==="todos"||o.estado===filtroEstado;
    const mL=filtroLugar==="todos"||o.lugar===filtroLugar;
    const mB=o.cliente.toLowerCase().includes(q)||
      o.contacto.toLowerCase().includes(q)||
      String(o.telefono).includes(busqueda)||
      String(o.folio||"").toLowerCase().includes(q);
    return mE&&mL&&mB;
  }),[orders,filtroEstado,filtroLugar,busqueda]);

  const clientCount=useMemo(()=>orders.reduce((acc,o)=>{ acc[o.cliente]=(acc[o.cliente]||0)+1; return acc; },{}), [orders]);

  const stats=useMemo(()=>({
    total:orders.length,
    recibido:orders.filter(o=>o.estado==="recibido").length,
    proceso:orders.filter(o=>o.estado==="proceso").length,
    listo:orders.filter(o=>o.estado==="listo").length,
    entregado:orders.filter(o=>o.estado==="entregado").length,
    kilos:orders.reduce((a,o)=>a+o.kilos,0),
    bolsas:orders.reduce((a,o)=>a+o.bolsas,0),
    bodega:orders.filter(o=>o.lugar==="BodegaDSAL").length,
    lavDDA:orders.filter(o=>o.lugar==="LavDDA").length,
    listasParaEntregar:orders.filter(o=>o.estado==="listo").length,
  }),[orders]);

  const empresas=useMemo(()=>{
    const map={};
    orders.forEach(o=>{ if(!map[o.cliente]) map[o.cliente]={nombre:o.cliente,contacto:o.contacto,telefono:o.telefono,ordenes:[]}; map[o.cliente].ordenes.push(o); });
    return Object.values(map).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  },[orders]);

  const empresasConListas=useMemo(()=>{
    return empresas.map(e=>({ ...e, listas:e.ordenes.filter(o=>o.estado==="listo") }))
      .filter(e=>e.listas.length>0)
      .filter(e=>e.nombre.toLowerCase().includes(entregaBusqueda.toLowerCase()));
  },[empresas,entregaBusqueda]);

  const ordenesDeLaEmpresa=useMemo(()=>{
    if(!entregaEmpresa) return [];
    return orders.filter(o=>o.cliente===entregaEmpresa&&o.estado==="listo");
  },[orders,entregaEmpresa]);

  const toggleSeleccion=(id)=>{
    setEntregaSeleccion(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  };
  const seleccionarTodas=()=>{
    if(entregaSeleccion.length===ordenesDeLaEmpresa.length) setEntregaSeleccion([]);
    else setEntregaSeleccion(ordenesDeLaEmpresa.map(o=>o.id));
  };

  // ── Confirmar entrega — usa bulkUpdate y rollback en error ────────────────
  const confirmarEntrega=async()=>{
    if(!entregaRecibe.trim()||entregaSeleccion.length===0) return;
    const fechaHora=formatDateFull();
    const ordenesAEntregar=orders.filter(o=>entregaSeleccion.includes(o.id));
    const snapshot=orders; // para rollback

    // Update local optimista
    setOrders(prev=>prev.map(o=>
      entregaSeleccion.includes(o.id)
        ? {...o, estado:"entregado", recibidoPor:entregaRecibe, fechaEntregaReal:fechaHora}
        : o
    ));

    setSyncing(true);
    try {
      const items=ordenesAEntregar.map(o=>orderToPayload({...o, estado:"entregado", recibidoPor:entregaRecibe, fechaEntregaReal:fechaHora}));
      // Intento bulkUpdate (v6); si falla por acción desconocida, fallback a update individual
      try {
        await sheetPost({action:"bulkUpdate", items});
      } catch (bulkErr) {
        // Fallback compat v5
        for(const it of items) await sheetPost({action:"update", ...it});
      }
      setSyncStatus("ok");
      setLastSync(new Date());
      // Mostrar éxito y guardar último ticket para reimprimir
      const ticket={ empresa:entregaEmpresa, ordenes:ordenesAEntregar, recibidoPor:entregaRecibe, fechaHora };
      lastTicketRef.current=ticket;
      setEntregaSuccess(ticket);
    } catch (e) {
      setOrders(snapshot); // ← rollback
      showToast("⚠️ No se pudo registrar la entrega. Sin cambios en Sheets.","error");
      setSyncStatus("error");
    } finally {
      setSyncing(false);
    }

    // Reset entrega
    setEntregaEmpresa(null);
    setEntregaSeleccion([]);
    setEntregaRecibe("");
  };

  // ── Crear orden — espera ID/Folio del servidor ────────────────────────────
  const handleSubmit=async()=>{
    if(!form.cliente.trim()) return;
    setSyncing(true);
    try {
      const payload={
        action:"add",
        Cliente:form.cliente, Contacto:form.contacto, Telefono:form.telefono,
        Lugar:form.lugar, Estado:form.estado,
        FechaRecepcion:form.fechaRecepcion, FechaEntrega:form.fechaEntrega,
        FechaEntregaReal:"", Bolsas:Number(form.bolsas)||0, Kilos:Number(form.kilos)||0,
        Notas:form.notas, RecibidoPor:""
      };
      const res=await sheetPost(payload);
      // v6 → { ok:true, data:{id, folio} } · v5 → { success:true }
      const created = (res && res.data) ? res.data : {};
      const newOrder={
        id: created.id || (orders.reduce((m,o)=>Math.max(m,o.id),0)+1),
        folio: created.folio || "",
        cliente:form.cliente, contacto:form.contacto, telefono:form.telefono,
        lugar:form.lugar, estado:form.estado,
        fechaRecepcion:form.fechaRecepcion, fechaEntrega:form.fechaEntrega,
        fechaEntregaReal:"", bolsas:Number(form.bolsas)||0, kilos:Number(form.kilos)||0,
        notas:form.notas, recibidoPor:""
      };
      setOrders(p=>[...p,newOrder]);
      setView("lista"); setForm(emptyForm);
      showToast(`✅ Orden ${newOrder.folio||"#"+newOrder.id} guardada`);
      setSyncStatus("ok"); setLastSync(new Date());
      // Refrescar para alinear con servidor (por si v5 no devuelve folio real)
      loadFromSheets(true);
    } catch (e) {
      showToast(`⚠️ No se pudo guardar: ${e.message}`,"error");
      setSyncStatus("error");
    } finally { setSyncing(false); }
  };

  // ── Editar orden completa ──────────────────────────────────────────────────
  const startEdit=(o)=>{
    setEditingId(o.id);
    setForm({
      cliente:o.cliente, contacto:o.contacto, telefono:o.telefono,
      lugar:o.lugar, estado:o.estado,
      fechaRecepcion:o.fechaRecepcion, fechaEntrega:o.fechaEntrega,
      bolsas:String(o.bolsas), kilos:String(o.kilos), notas:o.notas
    });
    setView("editar");
  };

  const handleEditSubmit=async()=>{
    if(!form.cliente.trim()||!editingId) return;
    const original=orders.find(o=>o.id===editingId); if(!original) return;
    const updated={...original,
      cliente:form.cliente, contacto:form.contacto, telefono:form.telefono,
      lugar:form.lugar, estado:form.estado,
      fechaRecepcion:form.fechaRecepcion, fechaEntrega:form.fechaEntrega,
      bolsas:Number(form.bolsas)||0, kilos:Number(form.kilos)||0, notas:form.notas
    };
    const snapshot=orders;
    setOrders(p=>p.map(o=>o.id===editingId?updated:o));
    setSyncing(true);
    try {
      await sheetPost({action:"update", ...orderToPayload(updated)});
      showToast("✅ Orden actualizada");
      setSyncStatus("ok"); setLastSync(new Date());
      setEditingId(null); setView("detalle"); setSelectedId(updated.id);
    } catch (e) {
      setOrders(snapshot);
      showToast(`⚠️ Error al guardar: ${e.message}`,"error");
      setSyncStatus("error");
    } finally { setSyncing(false); }
  };

  // ── Cambio de estado con rollback ──────────────────────────────────────────
  const updateEstado=async(id,estado)=>{
    const o=orders.find(x=>x.id===id); if(!o) return;
    const u={...o,estado};
    const snapshot=orders;
    setOrders(p=>p.map(x=>x.id===id?u:x));
    setSyncing(true);
    try {
      await sheetPost({action:"update", ...orderToPayload(u)});
      showToast("✅ Estado actualizado"); setSyncStatus("ok"); setLastSync(new Date());
    } catch (e) {
      setOrders(snapshot);
      showToast(`⚠️ Error: ${e.message}`,"error"); setSyncStatus("error");
    } finally { setSyncing(false); }
  };

  // ── Eliminar con confirmación + rollback ───────────────────────────────────
  const requestDelete=(o)=>{
    setConfirmModal({
      title:`Eliminar orden ${o.folio||"#"+o.id}?`,
      text:`Esta acción borra la orden de ${o.cliente} de Google Sheets. No se puede deshacer.`,
      confirmLabel:"Sí, eliminar",
      danger:true,
      onConfirm:()=>doDelete(o.id),
    });
  };

  const doDelete=async(id)=>{
    const snapshot=orders;
    setOrders(p=>p.filter(o=>o.id!==id)); setView("lista"); setSyncing(true);
    try {
      await sheetPost({action:"delete", ID:id});
      showToast("🗑 Orden eliminada"); setSyncStatus("ok"); setLastSync(new Date());
    } catch (e) {
      setOrders(snapshot);
      showToast(`⚠️ Error: ${e.message}`,"error"); setSyncStatus("error");
    } finally { setSyncing(false); setConfirmModal(null); }
  };

  // ── Reportes ─────────────────────────────────────────────────────────────
  const todayKey=today(); const weekKey=isoWeek(todayKey); const monthK=todayKey.slice(0,7);
  const reportLabel = reportPeriod==="daily"?`Hoy · ${formatDate(todayKey)}`
                    : reportPeriod==="weekly"?`Semana ${weekKey}`
                    : `Mes ${monthK}`;
  const reportFilter = reportPeriod==="daily"  ? (o=>o.fechaRecepcion===todayKey)
                     : reportPeriod==="weekly" ? (o=>isoWeek(o.fechaRecepcion)===weekKey)
                     :                            (o=>String(o.fechaRecepcion).startsWith(monthK));
  const activeReport = useMemo(()=>buildReport(orders,reportFilter), [orders,reportPeriod]); // eslint-disable-line

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      {toast&&<div style={{...S.toast,background:toast.type==="error"?"#DC2626":"#16A34A"}}>{toast.msg}</div>}

      {/* ── Modal genérico de confirmación ── */}
      {confirmModal&&(
        <div style={S.modalOverlay} onClick={()=>setConfirmModal(null)}>
          <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
            <div style={S.modalTitle}>{confirmModal.title}</div>
            <div style={S.modalText}>{confirmModal.text}</div>
            <div style={S.modalActions}>
              <button onClick={()=>setConfirmModal(null)} style={S.btnSecondary}>Cancelar</button>
              <button onClick={confirmModal.onConfirm} style={confirmModal.danger?S.btnDanger:S.btnPrimary} disabled={syncing}>
                {syncing?"...":confirmModal.confirmLabel||"Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Success Overlay ── */}
      {entregaSuccess&&(
        <div style={S.successOverlay}>
          <div style={S.successBox}>
            <div style={S.successIcon}>✅</div>
            <div style={S.successTitle}>¡Entrega confirmada!</div>
            <div style={S.successSub}>
              {entregaSuccess.ordenes.length} orden{entregaSuccess.ordenes.length!==1?"es":""} entregadas a <strong>{entregaSuccess.empresa}</strong><br/>
              Recibido por: <strong>{entregaSuccess.recibidoPor}</strong><br/>
              {entregaSuccess.fechaHora}
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button onClick={()=>{ printTicket(entregaSuccess.empresa,entregaSuccess.ordenes,entregaSuccess.recibidoPor,entregaSuccess.fechaHora); }} style={S.btnPrimary}>🖨️ Imprimir comprobante</button>
              <button onClick={()=>setEntregaSuccess(null)} style={S.btnSecondary}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <aside style={S.sidebar}>
        <div style={S.logo}>
          <img src="/logo.png" alt="Logo" style={{width:48,height:48,objectFit:"contain"}}/>
          <div><div style={S.logoTitle}>Lavandería<br/>Neuquén</div><div style={S.logoSub}>Control Industrial</div></div>
        </div>
        <nav style={S.nav}>
          {[
            {id:"lista",   icon:"📋", label:"Órdenes"},
            {id:"nueva",   icon:"➕", label:"Nueva Orden"},
            {id:"entrega", icon:"📦", label:`Entregar${stats.listasParaEntregar>0?` (${stats.listasParaEntregar})`:""}`, highlight:stats.listasParaEntregar>0},
            {id:"empresas",icon:"🏢", label:"Empresas"},
            {id:"reportes",icon:"📊", label:"Informes"},
          ].map(item=>(
            <button key={item.id} onClick={()=>{ setView(item.id); if(item.id==="entrega"){setEntregaEmpresa(null);setEntregaSeleccion([]);setEntregaRecibe("");} }}
              style={{...S.navBtn,...((view===item.id||(view==="detalle"&&item.id==="lista")||(view==="editar"&&item.id==="lista")||(view==="empresa"&&item.id==="empresas"))?S.navBtnActive:{}),...(item.highlight&&view!==item.id?{background:"#15803D",color:"white"}:{})}}>
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
          {lastTicketRef.current&&(
            <button onClick={()=>printTicket(lastTicketRef.current.empresa,lastTicketRef.current.ordenes,lastTicketRef.current.recibidoPor,lastTicketRef.current.fechaHora)}
              style={{...S.navBtn,marginTop:8,fontSize:12}}>
              <span>🖨️</span><span>Reimprimir último</span>
            </button>
          )}
        </nav>
        <div style={S.syncBox}>
          <div style={S.syncRow}>
            <span style={{...S.syncDot,background:syncStatus==="ok"?"#4ADE80":syncStatus==="error"?"#F87171":"#FCD34D"}}/>
            <span style={S.syncLabel}>{syncing?"Sincronizando...":syncStatus==="ok"?"Google Sheets ✓":syncStatus==="error"?"Error de sync":"Conectando..."}</span>
            <button onClick={()=>loadFromSheets()} style={S.syncBtn} title="Refrescar">↺</button>
          </div>
          {lastSync&&<div style={{...S.syncLabel,marginTop:4,fontSize:10,opacity:0.7}}>Última: {String(lastSync.getHours()).padStart(2,"0")}:{String(lastSync.getMinutes()).padStart(2,"0")}:{String(lastSync.getSeconds()).padStart(2,"0")}</div>}
        </div>
        <div style={S.statsBox}>
          <div style={S.statsTitle}>Resumen Total</div>
          {Object.entries(ESTADOS).map(([k,v])=>(
            <div key={k} style={S.statRow}>
              <span style={{...S.statDot,background:v.color}}/><span style={S.statLabel}>{v.label}</span><span style={S.statNum}>{stats[k]}</span>
            </div>
          ))}
          <div style={S.divider}/>
          <div style={S.statRow}><span style={S.statLabel}>🧺 Bolsas</span><span style={S.statNum}>{stats.bolsas}</span></div>
          <div style={S.statRow}><span style={S.statLabel}>⚖️ Kilos</span><span style={{...S.statNum,color:"#4ADE80"}}>{stats.kilos} kg</span></div>
          <div style={S.divider}/>
          <div style={S.statRow}><span style={S.statLabel}>🏭 BodegaDSAL</span><span style={S.statNum}>{stats.bodega}</span></div>
          <div style={S.statRow}><span style={S.statLabel}>🧺 LavDDA</span><span style={S.statNum}>{stats.lavDDA}</span></div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={S.main}>
        {loading&&<div style={S.loadingOverlay}><div style={S.loadingBox}><div style={S.spinner}/><span style={{color:C.mid}}>Cargando desde Google Sheets...</span></div></div>}

        {/* ── LISTA ── */}
        {!loading&&view==="lista"&&(
          <div style={S.panel}>
            <div style={S.panelHeader}>
              <div><h1 style={S.panelTitle}>Órdenes</h1><p style={S.panelSub}>{filtered.length} orden{filtered.length!==1?"es":""} · {filtered.reduce((a,o)=>a+o.kilos,0)} kg · {filtered.reduce((a,o)=>a+o.bolsas,0)} bolsas</p></div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>exportToExcel(filtered,"filtradas")} style={S.btnSuccess}>⬇ Excel</button>
                <button onClick={()=>setView("nueva")} style={S.btnPrimary}>+ Nueva Orden</button>
              </div>
            </div>
            <div style={S.filters}>
              <input placeholder="Buscar por folio, empresa, contacto o teléfono..." value={busqueda} onChange={e=>setBusqueda(e.target.value)} style={S.searchInput}/>
              <div style={S.estadoFilters}>
                <button onClick={()=>setFiltroEstado("todos")} style={{...S.filterChip,...(filtroEstado==="todos"?S.filterChipActive:{})}}>Todos ({stats.total})</button>
                {Object.entries(ESTADOS).map(([k,v])=>(
                  <button key={k} onClick={()=>setFiltroEstado(k)} style={{...S.filterChip,...(filtroEstado===k?{background:v.bg,color:v.color,borderColor:v.color}:{})}}>{v.icon} {v.label} ({stats[k]})</button>
                ))}
              </div>
              <div style={S.estadoFilters}>
                <button onClick={()=>setFiltroLugar("todos")} style={{...S.lugarChip,...(filtroLugar==="todos"?S.lugarChipActive:{})}}>📍 Todos</button>
                {LUGARES.map(l=>{ const lc=LUGAR_COLORS[l]; return <button key={l} onClick={()=>setFiltroLugar(l)} style={{...S.lugarChip,...(filtroLugar===l?{background:lc.bg,color:lc.color,borderColor:lc.color}:{})}}>{lc.icon} {l}</button>; })}
              </div>
            </div>
            <div style={S.orderList}>
              {filtered.length===0&&<div style={S.empty}>{orders.length===0?"No hay órdenes todavía.":"No hay órdenes que coincidan."}</div>}
              {filtered.map(order=>{
                const est=ESTADOS[order.estado]; const lc=LUGAR_COLORS[order.lugar]||LUGAR_COLORS["BodegaDSAL"];
                return (
                  <div key={order.id} style={S.orderCard} onClick={()=>{setSelectedId(order.id);setView("detalle");}}>
                    <div style={S.orderCardLeft}>
                      <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"center",minWidth:80}}>
                        <span style={S.folioBadge}>{order.folio||`#${order.id}`}</span>
                        <span style={{...S.lugarBadge,background:lc.bg,color:lc.color}}>{lc.icon} {order.lugar}</span>
                      </div>
                      <div style={{flex:1}}>
                        <div style={S.orderEmpresa}>{order.cliente}</div>
                        {order.contacto&&<div style={S.orderContacto}>👤 {order.contacto}</div>}
                        <div style={S.orderMeta}>📞 {order.telefono||"—"} · 📅 {formatDate(order.fechaRecepcion)} · 🗓 {formatDate(order.fechaEntrega)}</div>
                        <div style={S.orderMetrics}>
                          <span style={S.metricPill}>🧺 {order.bolsas} bolsa{order.bolsas!==1?"s":""}</span>
                          <span style={S.metricPill}>⚖️ {order.kilos} kg</span>
                          {order.recibidoPor&&<span style={{...S.metricPill,background:"#F0FDF4",color:"#15803D",borderColor:"#86EFAC"}}>✍️ {order.recibidoPor}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={S.orderCardRight}>
                      <span style={{...S.estadoBadge,background:est.bg,color:est.color,borderColor:est.color}}>{est.icon} {est.label}</span>
                      {order.fechaEntregaReal&&<span style={{fontSize:10,color:C.muted}}>Entregado: {order.fechaEntregaReal}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── NUEVA / EDITAR ORDEN ── */}
        {!loading&&(view==="nueva"||view==="editar")&&(
          <div style={S.panel}>
            <div style={S.panelHeader}>
              <div>
                <h1 style={S.panelTitle}>{view==="editar"?"Editar Orden":"Nueva Orden"}</h1>
                <p style={S.panelSub}>
                  {view==="editar"
                    ? <>Editando <strong style={{color:C.accent}}>{orders.find(o=>o.id===editingId)?.folio||"#"+editingId}</strong></>
                    : <>Folio asignado por el servidor al guardar · Se sincroniza con Google Sheets</>}
                </p>
              </div>
              <button onClick={()=>{ setView(view==="editar"?"detalle":"lista"); if(view==="nueva") setForm(emptyForm); }} style={S.btnSecondary}>← Cancelar</button>
            </div>
            <div style={S.formGrid}>
              <div style={S.formSection}>
                <div style={S.sectionTitle}>📍 Lugar de Recepción</div>
                <div style={S.lugarSelector}>
                  {LUGARES.map(l=>{ const lc=LUGAR_COLORS[l]; const isActive=form.lugar===l; return (
                    <div key={l} onClick={()=>setForm(f=>({...f,lugar:l}))} style={{...S.lugarOption,...(isActive?{...S.lugarOptionActive,borderColor:lc.color,background:lc.bg}:{})}}>
                      <div style={{fontSize:28,marginBottom:4}}>{lc.icon}</div>
                      <div style={{...S.lugarOptionLabel,color:isActive?lc.color:C.dark}}>{l}</div>
                      <div style={S.lugarOptionSub}>{l==="BodegaDSAL"?"Bodega principal":"Lavandería DDA"}</div>
                    </div>
                  ); })}
                </div>
              </div>
              <div style={S.formSection}>
                <div style={S.sectionTitle}>🏢 Datos de la Empresa</div>
                <div style={S.formRowDouble}>
                  <div style={S.formRow}>
                    <label style={S.label}>Nombre de la empresa *</label>
                    <input style={S.input} value={form.cliente} onChange={e=>setForm(f=>({...f,cliente:e.target.value}))} placeholder="Ej: Hotel Neuquén"/>
                    {form.cliente.trim()&&clientCount[form.cliente.trim()]&&<span style={{fontSize:11,color:C.accent,fontWeight:600}}>🏢 {clientCount[form.cliente.trim()]} orden{clientCount[form.cliente.trim()]!==1?"es":""} anteriores</span>}
                  </div>
                  <div style={S.formRow}><label style={S.label}>Nombre del contacto</label><input style={S.input} value={form.contacto} onChange={e=>setForm(f=>({...f,contacto:e.target.value}))} placeholder="Ej: Juan Pérez"/></div>
                </div>
                <div style={S.formRow}><label style={S.label}>Teléfono</label><input style={S.input} value={form.telefono} onChange={e=>setForm(f=>({...f,telefono:e.target.value}))} placeholder="Ej: 912345678"/></div>
              </div>
              <div style={S.formSection}>
                <div style={S.sectionTitle}>📅 Fechas y Estado</div>
                <div style={S.formRowDouble}>
                  <div style={S.formRow}><label style={S.label}>Fecha recepción</label><input type="date" style={S.input} value={form.fechaRecepcion} onChange={e=>setForm(f=>({...f,fechaRecepcion:e.target.value}))}/></div>
                  <div style={S.formRow}><label style={S.label}>Fecha entrega estimada</label><input type="date" style={S.input} value={form.fechaEntrega} onChange={e=>setForm(f=>({...f,fechaEntrega:e.target.value}))}/></div>
                </div>
                <div style={S.formRow}><label style={S.label}>Estado{view==="nueva"?" inicial":""}</label>
                  <select style={S.input} value={form.estado} onChange={e=>setForm(f=>({...f,estado:e.target.value}))}>
                    {Object.entries(ESTADOS).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={S.formSection}>
                <div style={S.sectionTitle}>🧺 Cantidad y Peso</div>
                <div style={S.formRowDouble}>
                  <div style={S.formRow}><label style={S.label}>Cantidad de bolsas</label><input type="number" min="0" style={S.input} value={form.bolsas} onChange={e=>setForm(f=>({...f,bolsas:e.target.value}))} placeholder="Ej: 5"/></div>
                  <div style={S.formRow}><label style={S.label}>Peso en kilos (kg)</label><input type="number" min="0" step="0.1" style={S.input} value={form.kilos} onChange={e=>setForm(f=>({...f,kilos:e.target.value}))} placeholder="Ej: 12.5"/></div>
                </div>
              </div>
              <div style={S.formSection}>
                <div style={S.sectionTitle}>📝 Notas</div>
                <textarea style={{...S.input,height:70,resize:"vertical"}} value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} placeholder="Instrucciones especiales..."/>
              </div>
            </div>
            <div style={S.formActions}>
              <button onClick={()=>{ setView(view==="editar"?"detalle":"lista"); if(view==="nueva") setForm(emptyForm); }} style={S.btnSecondary}>Cancelar</button>
              <button
                onClick={view==="editar"?handleEditSubmit:handleSubmit}
                style={S.btnPrimary}
                disabled={!form.cliente.trim()||syncing}>
                {syncing?"Guardando...":(view==="editar"?"💾 Guardar cambios":"✓ Registrar Orden")}
              </button>
            </div>
          </div>
        )}

        {/* ── ENTREGA ── */}
        {!loading&&view==="entrega"&&(
          <div style={S.panel}>
            <div style={S.panelHeader}>
              <div>
                <h1 style={S.panelTitle}>📦 Cierre de Entrega</h1>
                <p style={S.panelSub}>{stats.listasParaEntregar} orden{stats.listasParaEntregar!==1?"es":""} para retirar</p>
              </div>
            </div>

            {!entregaEmpresa ? (
              <>
                {empresasConListas.length===0 ? (
                  <div style={{...S.formSection,textAlign:"center",padding:40}}>
                    <div style={{fontSize:48,marginBottom:12}}>✅</div>
                    <div style={{fontWeight:700,fontSize:16,color:C.dark,marginBottom:6}}>Todo al día</div>
                    <div style={{color:C.muted,fontSize:13}}>No hay órdenes en estado "Listo" pendientes de entrega.</div>
                  </div>
                ) : (
                  <>
                    <input placeholder="Buscar empresa..." value={entregaBusqueda} onChange={e=>setEntregaBusqueda(e.target.value)} style={{...S.searchInput,marginBottom:16}}/>
                    {empresasConListas.map(emp=>{
                      const totalBolsas=emp.listas.reduce((a,o)=>a+o.bolsas,0);
                      const totalKilos=emp.listas.reduce((a,o)=>a+o.kilos,0);
                      return (
                        <div key={emp.nombre} style={{...S.entregaEmpresaCard,border:"1.5px solid #86EFAC"}} onClick={()=>{ setEntregaEmpresa(emp.nombre); setEntregaSeleccion(emp.listas.map(o=>o.id)); }}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{fontWeight:700,fontSize:16,color:C.dark,marginBottom:3}}>{emp.nombre}</div>
                              {emp.contacto&&<div style={{fontSize:13,color:C.accent}}>👤 {emp.contacto}</div>}
                            </div>
                            <div style={{display:"flex",gap:8,alignItems:"center"}}>
                              <span style={S.metricPill}>✅ {emp.listas.length} para retiro</span>
                              <span style={S.metricPill}>🧺 {totalBolsas} bolsas</span>
                              <span style={S.metricPill}>⚖️ {totalKilos} kg</span>
                              <span style={{...S.btnPrimary,fontSize:12,padding:"6px 14px"}}>Entregar →</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
                  <button onClick={()=>{setEntregaEmpresa(null);setEntregaSeleccion([]);setEntregaRecibe("");}} style={S.btnSecondary}>← Volver</button>
                  <div>
                    <span style={{fontWeight:700,fontSize:16,color:C.dark}}>{entregaEmpresa}</span>
                    <span style={{color:C.muted,fontSize:13,marginLeft:10}}>Selecciona las órdenes a entregar</span>
                  </div>
                </div>

                <div style={S.formSection}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={S.sectionTitle}>✅ Órdenes para retiro ({ordenesDeLaEmpresa.length})</div>
                    <button onClick={seleccionarTodas} style={S.btnSecondary}>
                      {entregaSeleccion.length===ordenesDeLaEmpresa.length?"Deseleccionar todas":"Seleccionar todas"}
                    </button>
                  </div>
                  {ordenesDeLaEmpresa.map(o=>{
                    const lc=LUGAR_COLORS[o.lugar]||LUGAR_COLORS["BodegaDSAL"];
                    const sel=entregaSeleccion.includes(o.id);
                    return (
                      <div key={o.id} style={{...S.entregaOrdenRow,border:`1.5px solid ${sel?"#86EFAC":C.border}`,background:sel?"#F0FDF4":"white"}} onClick={()=>toggleSeleccion(o.id)}>
                        <div style={{...S.checkBox,...(sel?S.checkBoxActive:{})}}>{sel?"✓":""}</div>
                        <span style={{...S.folioBadge}}>{o.folio||`#${o.id}`}</span>
                        <span style={{...S.lugarBadge,background:lc.bg,color:lc.color,fontSize:11,padding:"3px 9px"}}>{lc.icon} {o.lugar}</span>
                        <span style={{flex:1,fontSize:13,color:C.muted}}>📅 {formatDate(o.fechaRecepcion)}</span>
                        <span style={S.metricPill}>🧺 {o.bolsas} bolsas</span>
                        <span style={S.metricPill}>⚖️ {o.kilos} kg</span>
                      </div>
                    );
                  })}
                </div>

                {entregaSeleccion.length>0&&(
                  <div style={S.confirmBox}>
                    <div style={S.confirmTitle}>✍️ Confirmar entrega — {entregaSeleccion.length} orden{entregaSeleccion.length!==1?"es":""}</div>
                    <div style={{display:"flex",gap:20,marginBottom:16}}>
                      <div style={{textAlign:"center",flex:1,padding:"12px",background:"white",borderRadius:10,border:"1px solid #86EFAC"}}>
                        <div style={{fontSize:24,fontWeight:700,color:C.dark}}>{entregaSeleccion.map(id=>orders.find(o=>o.id===id)).reduce((a,o)=>a+(o?.bolsas||0),0)}</div>
                        <div style={{fontSize:11,color:C.muted}}>🧺 Bolsas</div>
                      </div>
                      <div style={{textAlign:"center",flex:1,padding:"12px",background:"white",borderRadius:10,border:"1px solid #86EFAC"}}>
                        <div style={{fontSize:24,fontWeight:700,color:C.dark}}>{entregaSeleccion.map(id=>orders.find(o=>o.id===id)).reduce((a,o)=>a+(o?.kilos||0),0)} kg</div>
                        <div style={{fontSize:11,color:C.muted}}>⚖️ Kilos</div>
                      </div>
                    </div>
                    <div style={S.formRow}>
                      <label style={{...S.label,fontSize:13,fontWeight:600,color:"#15803D"}}>✍️ Nombre de quien recibe *</label>
                      <input style={{...S.input,fontSize:15,fontWeight:600,border:"2px solid #86EFAC"}} value={entregaRecibe} onChange={e=>setEntregaRecibe(e.target.value)} placeholder="Ingresa el nombre completo de quien recibe"/>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:14}}>
                      <button onClick={()=>{setEntregaSeleccion([]);setEntregaRecibe("");}} style={S.btnSecondary}>Cancelar</button>
                      <button onClick={confirmarEntrega} style={{...S.btnSuccess,fontSize:14,padding:"11px 28px"}} disabled={!entregaRecibe.trim()||syncing}>
                        {syncing?"Guardando...":"📦 Confirmar entrega y generar comprobante"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── DETALLE ── */}
        {!loading&&view==="detalle"&&selected&&(()=>{
          const est=ESTADOS[selected.estado]; const lc=LUGAR_COLORS[selected.lugar]||LUGAR_COLORS["BodegaDSAL"];
          return (
            <div style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                    <span style={{...S.folioBadge,fontSize:13,padding:"5px 12px"}}>{selected.folio||`#${selected.id}`}</span>
                    <span style={{...S.lugarBadge,fontSize:12,padding:"4px 12px",background:lc.bg,color:lc.color}}>{lc.icon} {selected.lugar}</span>
                    {clientHistory.length>0&&<span style={{fontSize:12,color:C.accent,fontWeight:600}}>🏢 {clientHistory.length+1} órdenes totales</span>}
                  </div>
                  <h1 style={S.panelTitle}>{selected.cliente}</h1>
                  {selected.contacto&&<p style={{...S.panelSub,color:C.accent}}>👤 {selected.contacto}</p>}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>startEdit(selected)} style={S.btnPrimary}>✏️ Editar</button>
                  <button onClick={()=>exportToExcel([selected],selected.folio)} style={S.btnSuccess}>⬇ Excel</button>
                  <button onClick={()=>setView("lista")} style={S.btnSecondary}>← Volver</button>
                  <button onClick={()=>requestDelete(selected)} style={S.btnDanger} disabled={syncing}>{syncing?"...":"🗑 Eliminar"}</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:14}}>
                <div style={S.bigMetric}><div style={S.bigMetricVal}>{selected.bolsas}</div><div style={S.bigMetricLabel}>🧺 Bolsas</div></div>
                <div style={S.bigMetric}><div style={S.bigMetricVal}>{selected.kilos}</div><div style={S.bigMetricLabel}>⚖️ Kilos</div></div>
                <div style={{...S.bigMetric,background:lc.bg}}><div style={{...S.bigMetricVal,fontSize:28}}>{lc.icon}</div><div style={{...S.bigMetricLabel,color:lc.color,fontWeight:700}}>{selected.lugar}</div></div>
              </div>
              <div style={S.detailGrid}>
                <div style={S.detailCard}>
                  <div style={S.sectionTitle}>🏢 Empresa</div>
                  <div style={S.detailField}><span style={S.detailKey}>Empresa</span><span style={{fontWeight:600}}>{selected.cliente}</span></div>
                  <div style={S.detailField}><span style={S.detailKey}>Contacto</span><span>{selected.contacto||"—"}</span></div>
                  <div style={S.detailField}><span style={S.detailKey}>Teléfono</span><span>{selected.telefono||"—"}</span></div>
                  {clientHistory.length>0&&(
                    <div style={S.historyCard}>
                      <div style={S.historyTitle}>Órdenes anteriores</div>
                      {clientHistory.slice(0,4).map(h=>(
                        <div key={h.id} style={S.historyRow}>
                          <span style={{...S.folioBadge,fontSize:10}}>{h.folio||`#${h.id}`}</span>
                          <span>{formatDate(h.fechaRecepcion)}</span>
                          <span style={{fontSize:11,color:LUGAR_COLORS[h.lugar]?.color}}>{LUGAR_COLORS[h.lugar]?.icon} {h.lugar}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={S.detailCard}>
                  <div style={S.sectionTitle}>📅 Fechas</div>
                  <div style={S.detailField}><span style={S.detailKey}>Recepción</span><span>{formatDate(selected.fechaRecepcion)}</span></div>
                  <div style={S.detailField}><span style={S.detailKey}>Entrega est.</span><span>{formatDate(selected.fechaEntrega)}</span></div>
                  {selected.fechaEntregaReal&&<div style={S.detailField}><span style={S.detailKey}>Entrega real</span><span style={{color:"#15803D",fontWeight:600}}>{selected.fechaEntregaReal}</span></div>}
                  {selected.recibidoPor&&<div style={S.detailField}><span style={S.detailKey}>Recibido por</span><span style={{color:"#15803D",fontWeight:600}}>✍️ {selected.recibidoPor}</span></div>}
                  {selected.notas&&<div style={{marginTop:8,padding:"9px 12px",background:C.bg,borderRadius:8,border:`1px solid ${C.border}`,color:C.mid,fontSize:12}}><strong>Notas:</strong> {selected.notas}</div>}
                </div>
                <div style={S.detailCard}>
                  <div style={S.sectionTitle}>🔄 Cambiar estado</div>
                  <div style={{...S.estadoBadge,background:est.bg,color:est.color,borderColor:est.color,fontSize:14,padding:"8px 16px",marginBottom:12,textAlign:"center"}}>{est.icon} {est.label}</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {Object.entries(ESTADOS).map(([k,v])=>(
                      <button key={k} disabled={k===selected.estado||syncing} onClick={()=>updateEstado(selected.id,k)}
                        style={{...S.btnEstado,background:k===selected.estado?v.bg:"white",color:v.color,borderColor:v.color,opacity:k===selected.estado?0.6:1}}>
                        {v.icon} {v.label}
                      </button>
                    ))}
                  </div>
                  {selected.estado==="listo"&&(
                    <button onClick={()=>{ setEntregaEmpresa(selected.cliente); setEntregaSeleccion([selected.id]); setView("entrega"); }} style={{...S.btnSuccess,marginTop:10,width:"100%"}}>
                      📦 Ir a entregar esta orden
                    </button>
                  )}
                  {selected.estado==="entregado"&&selected.recibidoPor&&(
                    <button onClick={()=>printTicket(selected.cliente,[selected],selected.recibidoPor,selected.fechaEntregaReal||formatDateFull())} style={{...S.btnSecondary,marginTop:10,width:"100%"}}>
                      🖨️ Reimprimir comprobante
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── EMPRESAS ── */}
        {!loading&&view==="empresas"&&(
          <div style={S.panel}>
            <div style={S.panelHeader}>
              <div><h1 style={S.panelTitle}>Empresas Clientes</h1><p style={S.panelSub}>{empresas.length} empresa{empresas.length!==1?"s":""} registrada{empresas.length!==1?"s":""}</p></div>
              <button onClick={()=>exportToExcel(orders,"empresas")} style={S.btnSuccess}>⬇ Excel</button>
            </div>
            <input placeholder="Buscar empresa o contacto..." value={empresaBuscada} onChange={e=>setEmpresaBuscada(e.target.value)} style={{...S.searchInput,marginBottom:16}}/>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {empresas.filter(e=>e.nombre.toLowerCase().includes(empresaBuscada.toLowerCase())||e.contacto.toLowerCase().includes(empresaBuscada.toLowerCase())).map(emp=>{
                const pendientes=emp.ordenes.filter(o=>o.estado!=="entregado").length;
                const listas=emp.ordenes.filter(o=>o.estado==="listo").length;
                const totalKilos=emp.ordenes.reduce((a,o)=>a+o.kilos,0);
                const totalBolsas=emp.ordenes.reduce((a,o)=>a+o.bolsas,0);
                return (
                  <div key={emp.nombre} style={S.orderCard} onClick={()=>{setEmpresaSeleccionada(emp.nombre);setView("empresa");}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:16,color:C.dark,marginBottom:3}}>{emp.nombre}</div>
                      {emp.contacto&&<div style={{fontSize:13,color:C.accent,marginBottom:4}}>👤 {emp.contacto} · 📞 {emp.telefono||"—"}</div>}
                      <div style={S.orderMetrics}>
                        <span style={S.metricPill}>📋 {emp.ordenes.length} órdenes</span>
                        <span style={S.metricPill}>🧺 {totalBolsas} bolsas</span>
                        <span style={S.metricPill}>⚖️ {totalKilos} kg</span>
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                      {listas>0&&<span style={{...S.estadoBadge,background:"#F0FDF4",color:"#15803D",borderColor:"#86EFAC"}}>✅ {listas} para retiro</span>}
                      {pendientes>0&&<span style={{...S.estadoBadge,background:"#FFFBEB",color:"#D97706",borderColor:"#FCD34D"}}>{pendientes} pendiente{pendientes!==1?"s":""}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── EMPRESA DETALLE ── */}
        {!loading&&view==="empresa"&&empresaSeleccionada&&(()=>{
          const empOrders=orders.filter(o=>o.cliente===empresaSeleccionada);
          const emp=empresas.find(e=>e.nombre===empresaSeleccionada);
          const totalKilos=empOrders.reduce((a,o)=>a+o.kilos,0);
          const totalBolsas=empOrders.reduce((a,o)=>a+o.bolsas,0);
          const listas=empOrders.filter(o=>o.estado==="listo").length;
          return (
            <div style={S.panel}>
              <div style={S.panelHeader}>
                <div><h1 style={S.panelTitle}>{empresaSeleccionada}</h1>{emp?.contacto&&<p style={{...S.panelSub,color:C.accent}}>👤 {emp.contacto} · 📞 {emp?.telefono}</p>}</div>
                <div style={{display:"flex",gap:8}}>
                  {listas>0&&<button onClick={()=>{setEntregaEmpresa(empresaSeleccionada);setEntregaSeleccion(empOrders.filter(o=>o.estado==="listo").map(o=>o.id));setView("entrega");}} style={S.btnSuccess}>📦 Entregar órdenes para retiro ({listas})</button>}
                  <button onClick={()=>exportToExcel(empOrders,empresaSeleccionada)} style={{...S.btnSecondary}}>⬇ Excel</button>
                  <button onClick={()=>setView("empresas")} style={S.btnSecondary}>← Volver</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20}}>
                {[{val:empOrders.length,label:"Órdenes totales",color:C.dark},{val:empOrders.filter(o=>o.estado==="entregado").length,label:"Entregadas",color:"#16A34A"},{val:`${totalBolsas} 🧺`,label:"Total bolsas",color:C.mid},{val:`${totalKilos} kg`,label:"Total kilos",color:C.accent}].map((k,i)=>(
                  <div key={i} style={S.kpiCard}><div style={{...S.kpiValue,color:k.color,fontSize:24}}>{k.val}</div><div style={S.kpiLabel}>{k.label}</div></div>
                ))}
              </div>
              <div style={S.reportSection}>
                <div style={S.reportSectionTitle}>📋 Historial completo</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>Folio</th><th style={S.th}>Lugar</th><th style={S.th}>Recepción</th><th style={S.th}>Bolsas</th><th style={S.th}>Kilos</th><th style={S.th}>Estado</th><th style={S.th}>Recibido por</th></tr></thead>
                  <tbody>{empOrders.slice().reverse().map((o,i)=>{
                    const est=ESTADOS[o.estado]; const lc=LUGAR_COLORS[o.lugar]||LUGAR_COLORS["BodegaDSAL"];
                    return (
                      <tr key={o.id} style={{...i%2===0?S.trEven:{},cursor:"pointer"}} onClick={()=>{setSelectedId(o.id);setView("detalle");}}>
                        <td style={{...S.td,fontWeight:700,color:C.accent}}>{o.folio||`#${o.id}`}</td>
                        <td style={S.td}><span style={{...S.lugarBadge,background:lc.bg,color:lc.color,fontSize:11,padding:"2px 8px"}}>{lc.icon} {o.lugar}</span></td>
                        <td style={S.td}>{formatDate(o.fechaRecepcion)}</td>
                        <td style={{...S.td,fontWeight:600}}>{o.bolsas}</td>
                        <td style={{...S.td,fontWeight:600}}>{o.kilos} kg</td>
                        <td style={S.td}><span style={{...S.estadoBadge,background:est.bg,color:est.color,borderColor:est.color}}>{est.icon} {est.label}</span></td>
                        <td style={{...S.td,color:"#15803D",fontWeight:o.recibidoPor?600:400}}>{o.recibidoPor||"—"}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ── REPORTES ── */}
        {!loading&&view==="reportes"&&(()=>{
          const r=activeReport; const maxBar=Math.max(...Object.values(r.porEstado),1); const maxLugar=Math.max(...r.porLugar.map(([,v])=>v),1);
          return (
            <div style={S.panel}>
              <div style={S.panelHeader}>
                <div><h1 style={S.panelTitle}>Informes Ejecutivos</h1><p style={S.panelSub}>Lavandería Neuquén · {reportLabel}</p></div>
                <button onClick={()=>exportToExcel(r.orders,reportPeriod)} style={S.btnSuccess}>⬇ Exportar {reportLabel}</button>
              </div>
              <div style={S.reportTabs}>
                {[{id:"daily",label:"📅 Diario"},{id:"weekly",label:"📆 Semanal"},{id:"monthly",label:"🗓 Mensual"}].map(t=>(
                  <button key={t.id} onClick={()=>setReportPeriod(t.id)} style={{...S.reportTab,...(reportPeriod===t.id?S.reportTabActive:{})}}>{t.label}</button>
                ))}
              </div>
              <div style={S.kpiGrid}>
                {[{value:r.total,label:"Órdenes",sub:reportLabel,color:C.dark},{value:r.entregados,label:"Entregadas",sub:`${r.total>0?Math.round(r.entregados/r.total*100):0}% del total`,color:"#16A34A"},{value:`${r.bolsas} 🧺`,label:"Bolsas",sub:"cantidad total",color:C.mid},{value:`${r.kilos} kg ⚖️`,label:"Kilos",sub:"peso total",color:C.accent}].map((k,i)=>(
                  <div key={i} style={S.kpiCard}><div style={{...S.kpiValue,color:k.color,fontSize:typeof k.value==="string"?18:30}}>{k.value}</div><div style={S.kpiLabel}>{k.label}</div><div style={S.kpiSub}>{k.sub}</div></div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <div style={S.reportSection}>
                  <div style={S.reportSectionTitle}>📊 Por estado</div>
                  {Object.entries(ESTADOS).map(([k,v])=>(
                    <div key={k} style={S.barRow}>
                      <span style={S.barLabel}>{v.icon} {v.label}</span>
                      <div style={S.barTrack}><div style={{...S.barFill,width:`${(r.porEstado[k]||0)/maxBar*100}%`,background:v.color}}/></div>
                      <span style={S.barVal}>{r.porEstado[k]||0}</span>
                    </div>
                  ))}
                </div>
                <div style={S.reportSection}>
                  <div style={S.reportSectionTitle}>📍 Por lugar</div>
                  {r.porLugar.map(([lugar,count])=>{ const lc=LUGAR_COLORS[lugar]||LUGAR_COLORS["BodegaDSAL"]; return (
                    <div key={lugar} style={S.barRow}>
                      <span style={S.barLabel}>{lc.icon} {lugar}</span>
                      <div style={S.barTrack}><div style={{...S.barFill,width:`${count/maxLugar*100}%`,background:lc.color}}/></div>
                      <span style={S.barVal}>{count}</span>
                    </div>
                  ); })}
                  <div style={{marginTop:12,padding:"10px 14px",background:C.bg,borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,color:C.mid}}>
                    <strong>Empresas únicas:</strong> {new Set(r.orders.map(o=>o.cliente)).size}
                  </div>
                </div>
                <div style={{...S.reportSection,gridColumn:"1 / -1"}}>
                  <div style={{...S.reportSectionTitle,display:"flex",justifyContent:"space-between"}}>
                    <span>📋 Detalle — {reportLabel}</span>
                    <button onClick={()=>exportToExcel(r.orders,reportPeriod)} style={{...S.btnSuccess,padding:"5px 12px",fontSize:12}}>⬇ Excel</button>
                  </div>
                  {r.orders.length===0&&<div style={{color:C.muted,textAlign:"center",padding:20}}>Sin órdenes para este período</div>}
                  <table style={S.table}>
                    <thead><tr><th style={S.th}>Folio</th><th style={S.th}>Empresa</th><th style={S.th}>Lugar</th><th style={S.th}>Fecha</th><th style={S.th}>Bolsas</th><th style={S.th}>Kilos</th><th style={S.th}>Estado</th><th style={S.th}>Recibido por</th></tr></thead>
                    <tbody>{r.orders.slice().reverse().map((o,i)=>{ const est=ESTADOS[o.estado]; const lc=LUGAR_COLORS[o.lugar]||LUGAR_COLORS["BodegaDSAL"];
                      return (<tr key={o.id} style={i%2===0?S.trEven:{}}>
                        <td style={{...S.td,fontWeight:700,color:C.accent}}>{o.folio||`#${o.id}`}</td>
                        <td style={{...S.td,fontWeight:600}}>{o.cliente}</td>
                        <td style={S.td}><span style={{...S.lugarBadge,background:lc.bg,color:lc.color,fontSize:11,padding:"2px 8px"}}>{lc.icon} {o.lugar}</span></td>
                        <td style={S.td}>{formatDate(o.fechaRecepcion)}</td>
                        <td style={{...S.td,fontWeight:600}}>{o.bolsas}</td>
                        <td style={{...S.td,fontWeight:600}}>{o.kilos} kg</td>
                        <td style={S.td}><span style={{...S.estadoBadge,background:est.bg,color:est.color,borderColor:est.color}}>{est.icon} {est.label}</span></td>
                        <td style={{...S.td,color:"#15803D",fontWeight:o.recibidoPor?600:400}}>{o.recibidoPor||"—"}</td>
                      </tr>);
                    })}</tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${C.bg};font-family:'Inter',sans-serif;}
        input:focus,select:focus,textarea:focus{outline:2px solid ${C.accent};outline-offset:1px;}
        button:hover:not(:disabled){filter:brightness(0.95);}
        button:disabled{opacity:0.5;cursor:not-allowed;}
        @keyframes spin{to{transform:rotate(360deg);}}
      `}</style>
    </div>
  );
}
