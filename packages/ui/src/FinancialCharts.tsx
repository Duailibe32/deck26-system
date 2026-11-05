import React from 'react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { formatBrlCents } from '@deck26/contracts';

export interface DailySalesPoint { date: string; salesCents: number }
export interface RoomOccupancyPoint { name: string; value: number; color: string }
const tooltipStyle = { backgroundColor: '#292929', border: '1px solid #555', borderRadius: 12, color: '#fff' };

export function FinancialCharts({ dailySales, occupancy, notice }: {
  dailySales: DailySalesPoint[]; occupancy: RoomOccupancyPoint[]; notice: string;
}) {
  const total = dailySales.reduce((sum, point) => sum + point.salesCents, 0);
  const roomTotal = occupancy.reduce((sum, point) => sum + point.value, 0);
  return <section className="d26-financial-charts" aria-label="Dashboard financeiro e ocupação">
    <article className="d26-chart-card">
      <div className="d26-chart-heading"><div><h2>Volume de vendas diárias</h2><p>Últimos sete dias · {notice}</p></div><strong>{formatBrlCents(total)}</strong></div>
      <div className="d26-chart-canvas" aria-label="Vendas diárias em reais">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={dailySales} accessibilityLayer margin={{ top: 18, right: 12, left: 4, bottom: 6 }}>
            <CartesianGrid stroke="#363636" vertical={false}/>
            <XAxis dataKey="date" tickFormatter={value => String(value).slice(5).split('-').reverse().join('/')} tick={{ fill: '#bdbdbd', fontSize: 11 }} axisLine={false} tickLine={false}/>
            <YAxis domain={[0,(maximum:number)=>Math.max(10000,maximum)]} tickFormatter={value => 'R$ '+(Number(value)/100).toLocaleString('pt-BR',{notation:'compact'})} tick={{ fill: '#aaa', fontSize: 10 }} width={65} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{color:'#ffb3cb'}} cursor={{fill:'#ffffff08'}} formatter={value => [formatBrlCents(Number(value)), 'Vendas']} labelFormatter={value => String(value).split('-').reverse().join('/')}/>
            <Bar dataKey="salesCents" name="Vendas" fill="#F72585" radius={[6,6,0,0]} maxBarSize={42} isAnimationActive={false}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="d26-chart-data"><summary>Consultar valores por dia</summary><table><thead><tr><th>Dia</th><th>Vendas</th></tr></thead><tbody>{dailySales.map(point=><tr key={point.date}><td>{point.date.split('-').reverse().join('/')}</td><td>{formatBrlCents(point.salesCents)}</td></tr>)}</tbody></table></details>
    </article>
    <article className="d26-chart-card">
      <div className="d26-chart-heading"><div><h2>Ocupação dos apartamentos</h2><p>Situação atual · {roomTotal} unidades cadastradas</p></div></div>
      {roomTotal>0?<div className="d26-chart-canvas" aria-label="Distribuição atual dos apartamentos">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart accessibilityLayer><Pie data={occupancy.filter(point=>point.value>0)} dataKey="value" nameKey="name" innerRadius="57%" outerRadius="84%" paddingAngle={3} stroke="none" isAnimationActive={false}>{occupancy.filter(point=>point.value>0).map(point=><Cell key={point.name} fill={point.color}/>)}</Pie><Tooltip contentStyle={tooltipStyle} itemStyle={{color:'#fff'}} formatter={value=>[Number(value),'Apartamentos']}/></PieChart>
        </ResponsiveContainer>
      </div>:<p className="d26-chart-empty">Cadastre os apartamentos para acompanhar a ocupação.</p>}
      <ul className="d26-chart-legend">{occupancy.map(point=><li key={point.name}><i style={{background:point.color}}/><span>{point.name}</span><strong>{point.value}</strong></li>)}</ul>
    </article>
  </section>;
}
