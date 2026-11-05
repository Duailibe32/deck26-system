import React, { useEffect, useState } from 'react';
import { FinancialCharts, type DailySalesPoint, type RoomOccupancyPoint } from '@deck26/ui';

interface DashboardData { dailySales: DailySalesPoint[]; occupancy: RoomOccupancyPoint[]; updatedAt: string }
export function FinancialDashboard({ apiBase, token }: { apiBase: string; token: string }) {
  const [data,setData]=useState<DashboardData|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let current=true;let controller:AbortController|null=null;
    setData(null);setError('');
    const refresh=async()=>{
      controller?.abort();controller=new AbortController();
      try {
        const response=await fetch(apiBase+'/api/finance/dashboard/charts',{headers:{Authorization:'Bearer '+token},signal:controller.signal});
        if(!response.ok)throw new Error(response.status===403?'Seu perfil não permite consultar o dashboard financeiro.':'Não foi possível atualizar os gráficos.');
        const result=await response.json() as DashboardData;
        if(current){setData(result);setError('');}
      }catch(cause){if(current&&!(cause instanceof DOMException&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'Falha ao consultar o painel.');}
    };
    void refresh();const timer=setInterval(()=>void refresh(),30000);
    return()=>{current=false;controller?.abort();clearInterval(timer);};
  },[apiBase,token]);
  return <div>{error&&<p role="alert" className="d26-dashboard-error">{error} {data?'Os valores abaixo são da última atualização.':''}</p>}{data?<><FinancialCharts dailySales={data.dailySales} occupancy={data.occupancy} notice="Receita bruta reconhecida na DRE · dias em UTC"/><p className="d26-chart-updated">Atualizado em {new Date(data.updatedAt).toLocaleTimeString('pt-BR')} · atualização a cada 30 segundos</p></>:!error&&<p role="status">Carregando os indicadores financeiros…</p>}</div>;
}
