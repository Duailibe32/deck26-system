import type {LocalOperationalStore} from './store.js';

export function serviceBoard(store:LocalOperationalStore,days:number,history:boolean){
  const now=new Date();
  const since=new Date(now.getTime()-days*86400000).toISOString();
  const active='t.active_tab_id IS c.tab_id';
  const rows=store.db.prepare(`SELECT c.id,c.table_number AS tableNumber,c.kind,c.payment_preference AS paymentPreference,
    c.requested_at AS requestedAt,c.resolved_at AS resolvedAt,
    COALESCE(a.assigned_at,c.resolved_at) AS assignedAt,assigned.name AS assignee,finished.name AS completedBy,
    COALESCE(a.assigned_by,c.resolved_by) AS assigneeId,
    CASE WHEN c.resolved_at IS NOT NULL THEN 'DONE' WHEN NOT (${active}) THEN 'ENDED'
      WHEN a.assigned_at IS NOT NULL THEN 'ASSIGNED' ELSE 'WAITING' END AS status
    FROM table_service_calls c LEFT JOIN dining_tables_qr t ON t.table_number=c.table_number
    LEFT JOIN table_service_assignments a ON a.call_id=c.id
    LEFT JOIN users assigned ON assigned.id=COALESCE(a.assigned_by,c.resolved_by)
    LEFT JOIN users finished ON finished.id=c.resolved_by
    WHERE (c.resolved_at IS NULL AND (${active})) OR (?=1 AND c.requested_at>=?)
    ORDER BY c.requested_at,c.rowid`).all(Number(history),since).map(row=>({
      id:String(row.id),tableNumber:Number(row.tableNumber),kind:row.kind,paymentPreference:row.paymentPreference,
      requestedAt:String(row.requestedAt),assignedAt:row.assignedAt?String(row.assignedAt):null,
      resolvedAt:row.resolvedAt,assignee:row.assignee,assigneeId:row.assigneeId,completedBy:row.completedBy,status:row.status,
      waitSeconds:Math.max(0,Math.floor(((row.assignedAt?Date.parse(String(row.assignedAt)):now.getTime())-Date.parse(String(row.requestedAt)))/1000))
    }));
  const pending=rows.filter(row=>row.status==='WAITING'||row.status==='ASSIGNED');
  if(!history)return {pending,history:null};
  const period=rows.filter(row=>row.requestedAt>=since);
  const handled=period.filter(row=>row.assignedAt);
  const hours=Array.from({length:24},(_,hour)=>({hour,count:0}));
  const localHour=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',hourCycle:'h23'});
  for(const row of period)hours[Number(localHour.format(new Date(row.requestedAt)))]!.count++;
  const tables=new Map<number,{tableNumber:number;calls:number;longestSeconds:number}>();
  for(const row of handled){
    const entry=tables.get(row.tableNumber)??{tableNumber:row.tableNumber,calls:0,longestSeconds:0};
    entry.calls++;entry.longestSeconds=Math.max(entry.longestSeconds,row.waitSeconds);tables.set(row.tableNumber,entry);
  }
  return {pending,history:{total:period.length,completed:period.filter(row=>row.status==='DONE').length,withoutHandling:period.filter(row=>row.status==='ENDED'&&!row.assignedAt).length,
    averageSeconds:handled.length?Math.round(handled.reduce((sum,row)=>sum+row.waitSeconds,0)/handled.length):null,
    hours:hours.sort((a,b)=>b.count-a.count).filter(item=>item.count>0).slice(0,5),
    tables:[...tables.values()].sort((a,b)=>b.longestSeconds-a.longestSeconds).slice(0,5),
    recent:period.filter(row=>row.status==='DONE'||row.status==='ENDED').reverse().slice(0,50)}};
}
