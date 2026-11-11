import { hasPermission, type DiningTableQr, type HotelRoom, type HotelStay, type Order, type PrintJob, type Tab, type TableServiceCall, type UserRole } from '@deck26/contracts';

export type ShiftTarget =
  | { kind: 'table'; number: number; intent: 'order' | 'pay' | 'call'; callId?: string }
  | { kind: 'print'; id: string }
  | { kind: 'delivery' }
  | { kind: 'room'; number: string; stayId?: string };
export type ShiftGroup = 'service' | 'payment' | 'delivery' | 'printing' | 'departure' | 'rooms';
export type ShiftTask = {
  id: string;
  group: ShiftGroup;
  title: string;
  detail: string;
  priority: number;
  count?: number;
  since?: string;
  target: ShiftTarget;
};

type RestaurantState = {
  qrTables?: DiningTableQr[];
  tabs: Tab[];
  orders: Order[];
  serviceCalls?: TableServiceCall[];
  printJobs?: PrintJob[];
  publicDeliveryPendingCount?: number;
};

export function restaurantQueue(state: RestaurantState, role: UserRole, now: number): ShiftTask[] {
  const tasks: ShiftTask[] = [];
  const canPay = hasPermission(role, 'pos:operate');
  const canManageTables = hasPermission(role, 'tabs:manage');
  const tabs = new Map(state.tabs.map(tab => [tab.id, tab]));
  const tables = new Map((state.qrTables ?? []).map(table => [table.tableNumber, table]));
  const orderedTabs = new Set(state.orders.filter(order => order.status !== 'CANCELLED').map(order => order.tabId));
  const bills = new Set<number>();
  if (canManageTables) {
    for (const call of state.serviceCalls ?? []) {
      const table = tables.get(call.tableNumber);
      if (!table?.active || table.activeTabId !== call.tabId) continue;
      const bill = call.kind === 'BILL';
      if (bill) bills.add(call.tableNumber);
      tasks.push({
        id: call.id, group: bill ? 'payment' : 'service',
        title: bill ? 'Conta solicitada' : 'Cliente chamou o garçom',
        detail: 'Mesa ' + String(call.tableNumber).padStart(2, '0'),
        priority: bill ? 0 : 1, since: call.requestedAt,
        target: { kind: 'table', number: call.tableNumber, intent: bill && canPay ? 'pay' : 'call', callId: call.id }
      });
    }
    for (const table of tables.values()) {
      if (!table.active || !table.activeTabId) continue;
      const tab = tabs.get(table.activeTabId);
      if (!tab || tab.status === 'CLOSED' || tab.status === 'CANCELLED') continue;
      const number = table.tableNumber;
      const detail = 'Mesa ' + String(number).padStart(2, '0');
      if (table.physicalStatus === 'AGUARDANDO_PAGAMENTO') {
        if (canPay && !bills.has(number)) tasks.push({
          id: 'bill-' + number, group: 'payment', title: 'Aguardando pagamento', detail,
          priority: 0, since: tab.updatedAt, target: { kind: 'table', number, intent: 'pay' }
        });
        continue;
      }
      const opened = table.openedAt ?? tab.openedAt;
      if (!orderedTabs.has(tab.id) && tab.subtotalCents === 0 && now - Date.parse(opened) >= 600_000) tasks.push({
        id: 'first-' + number, group: 'service', title: 'Aguardando primeiro pedido', detail,
        priority: 3, since: opened, target: { kind: 'table', number, intent: 'order' }
      });
    }
  }
  if (hasPermission(role, 'delivery:manage_orders') && (state.publicDeliveryPendingCount ?? 0) > 0) {
    const count = state.publicDeliveryPendingCount!;
    tasks.push({id:'delivery',group:'delivery',title:count === 1 ? '1 pedido online para aceitar' : count + ' pedidos online para aceitar',
      detail:'Delivery e retirada',priority:2,count,target:{kind:'delivery'}});
  }
  if (hasPermission(role, 'printers:manage')) {
    for (const job of state.printJobs ?? []) {
      if (job.status !== 'FAILED' && job.status !== 'UNKNOWN_OUTCOME') continue;
      tasks.push({id:job.id,group:'printing',title:job.status === 'FAILED'?'Falha de impressão':'Impressão sem confirmação',
        detail:job.targetPrinter === 'PRINTER_CASHIER'?'Caixa':job.targetPrinter === 'PRINTER_BAR'?'Bar':'Cozinha',
        priority:1,since:job.createdAt,target:{kind:'print',id:job.id}});
    }
  }
  return tasks.sort((a,b) => a.priority - b.priority || (a.since ?? '').localeCompare(b.since ?? ''));
}

export function receptionQueue(rooms: HotelRoom[], stays: HotelStay[], tabs: Tab[], role: UserRole, now: number): ShiftTask[] {
  const tasks: ShiftTask[] = [];
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24,0,0,0);
  const activeRooms = new Map(rooms.filter(room => room.active && room.commercialStatus === 'OPERACIONAL').map(room => [room.number, room]));
  const tabsById = new Map(tabs.map(tab => [tab.id,tab]));
  if (hasPermission(role,'hotel:view_pii')) {
    for (const stay of stays) {
      if (stay.status !== 'ACTIVE' || !activeRooms.has(stay.roomNumber)) continue;
      const deadline = Date.parse(stay.checkOutScheduledAt);
      if (!Number.isFinite(deadline) || deadline >= nextMidnight.getTime()) continue;
      const room = activeRooms.get(stay.roomNumber)!;
      const tab = room.activeTabId ? tabsById.get(room.activeTabId) : undefined;
      const late = deadline <= now;
      tasks.push({id:stay.id,group:'departure',title:late?'Horário de saída atingido':'Saída prevista hoje',
        detail:'Apto '+stay.roomNumber+' · '+new Date(deadline).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
          +(tab && tab.totalCents>tab.paidCents?' · Saldo em aberto':''),
        priority:late?0:1,target:{kind:'room',number:stay.roomNumber,stayId:stay.id}});
    }
  }
  if (hasPermission(role,'hotel:housekeeping') || hasPermission(role,'hotel:maintenance')) {
    for (const room of activeRooms.values()) {
      const maintenance = room.maintenanceStatus !== 'DISPONIVEL';
      if (maintenance && hasPermission(role,'hotel:maintenance') || room.housekeepingStatus === 'SUJO' && hasPermission(role,'hotel:housekeeping')) {
        tasks.push({id:'room-'+room.number,group:'rooms',title:maintenance&&hasPermission(role,'hotel:maintenance')?'Manutenção do quarto':'Limpeza pendente',
          detail:'Apto '+room.number,priority:2,target:{kind:'room',number:room.number}});
      }
    }
  }
  return tasks.sort((a,b)=>a.priority-b.priority||a.detail.localeCompare(b.detail,'pt-BR',{numeric:true}));
}
