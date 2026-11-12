import {correctionTicketHeader,correctionTicket} from './order-correction.js';
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function wrapThermalLine(line:string,columns:number):string[]{
  if(line.length<=columns)return [line];
  const chunks:string[]=[];
  let rest=line.trimEnd();
  while(rest.length>columns){
    let cut=rest.lastIndexOf(' ',columns);
    if(cut<columns/2)cut=columns;
    chunks.push(rest.slice(0,cut));
    rest=rest.slice(cut).trimStart();
  }
  return [...chunks,rest];
}
export function renderThermalPreview(text:string,width:58|80,device:string){
  const columns=width===58?32:48;
  const isCorrection=text.split('\n').includes(correctionTicketHeader);
  const clean=text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').split('\n');
  const isKitchen=/cozinha|produção|producao/i.test(device+' '+text.slice(0,180));
  const content=clean.map(line=>{
    if(/^[-=]{5}/.test(line.trim()))return '<hr>';
    const type=isCorrection&&line===correctionTicketHeader?'correction-title':
      isCorrection&&/^(CANCELAR PREPARO|NOVA OBSERVAÇÃO|PREPARAR SUBSTITUIÇÃO|ITEM JÁ EM PRODUÇÃO|NÃO PREPARAR|MANTER )/.test(line)?'correction-action':
      /^(?:.*(?:MESA|APTO|APARTAMENTO|PEDIDO|COMANDA|ENTREGA|RETIRADA)\b)/i.test(line)?'context':
      /^\s*(?:OBS|OBSERVA|SEM |BEM |MAL |AO PONTO|ADICIONAL)/i.test(line)?'note':
      /^\s*(?:TOTAL|TROCO|SALDO|VALOR RECEBIDO)/i.test(line)?'total':/^\s*\d+\s*[xX×]/.test(line)?'item':'';
    const wrapped=wrapThermalLine(line,columns).map(escapeHtml).join('\n');
    return '<div class="line '+type+'">'+(wrapped||'&nbsp;')+'</div>';
  }).join('');
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Via '+escapeHtml(device)+'</title><style>@page{size:'+width+'mm auto;margin:3mm}*{box-sizing:border-box}body{margin:0;background:#eee;color:#111;font:'+(width===58?10:9.5)+'px monospace}.paper{width:'+width+'mm;max-width:100%;padding:3mm;margin:12px auto;background:#fff;border:1px dashed #aaa}h1{font-size:15px;text-align:center;margin:0 0 10px}.notice{font-size:9px;text-align:center;border-block:1px dashed;padding:7px 0;line-height:1.5}.brand{text-align:center;font:bold 21px monospace;letter-spacing:3px;margin:7px 0}.subtitle{text-align:center;font-size:8px;margin-bottom:12px}.ticket{margin:12px 0;line-height:1.5}.line{white-space:pre-wrap;overflow-wrap:anywhere}.line.context{font-weight:bold;background:#eee;padding:5px 0}.line.item{font-weight:bold;font-size:1.15em;margin:7px 0}.line.note{font-weight:bold;border-left:2px solid #111;padding-left:5px;margin:4px 0}.line.total{font-weight:bold;font-size:1.2em;border-top:1px dashed #777;padding-top:5px;margin-top:6px}.line.correction-title{font-size:1.55em;font-weight:900;text-align:center;border-block:3px double #111;margin:8px 0;padding:7px 0}.line.correction-action{font-size:1.2em;font-weight:900;border:1px solid #111;padding:4px;margin:6px 0}.kitchen .line.item{font-size:1.35em}.kitchen .line.note{font-size:1.15em}hr{border:0;border-top:1px dashed #777;margin:8px 0}footer{font-size:10px;text-align:center}@media print{body{background:white}.paper{margin:0;padding:0;border:0;width:100%}}</style></head><body><article class="paper"><div class="brand">DECK 26</div><div class="subtitle">Restaurante · Bar · Hotel Auto Posto Milla</div><h1>'+escapeHtml(device)+'</h1><div class="notice">SIMULAÇÃO DE IMPRESSÃO<br>SEM VALIDADE FISCAL · NENHUMA IMPRESSORA ACIONADA</div><div class="ticket '+(isKitchen?'kitchen':'cashier')+'">'+content+'</div><footer>DECK 26 · '+width+' mm</footer></article></body></html>';
}
export const thermalModels={
  correction:correctionTicket({action:'REMOVE',code:'MESA-08',orderId:'DEMO2026',operator:'Operador exemplo',
    reason:'Cliente pediu apenas uma porção. Modelo de exemplo.',product:'Porção de fritas',quantity:1,remaining:1,
    wasReady:true,at:'2026-11-12T21:00:00.000Z'}),
  kitchen:'DECK 26 · COZINHA\nPEDIDO DE EXEMPLO — NÃO PRODUZIR\n--------------------------------\nMESA 05 · GARÇOM EXEMPLO\n2 x Produto do cardápio\n  OBS: sem cebola / bem passado\n1 x Outro produto\n--------------------------------\nAPENAS ITENS DESTE PEDIDO\nVIA DE PRODUÇÃO · NÃO FISCAL',
  bill:'DECK 26 · CAIXA\nMODELO DE PRÉ-CONTA — EXEMPLO\n--------------------------------\nMESA 05\n2 x Produto A      R$ 40,00\n1 x Produto B      R$ 10,00\nSUBTOTAL           R$ 50,00\nSERVIÇO 10%        R$  5,00\nTOTAL              R$ 55,00\nPAGO               R$ 20,00\nRESTANTE           R$ 35,00\n--------------------------------\nCONFERÊNCIA · NÃO É RECIBO\nSEM VALIDADE FISCAL',
  payment:'DECK 26 · CAIXA\nCOMPROVANTE DE EXEMPLO\n--------------------------------\nMESA 05 · PAGAMENTO PARCIAL\nVALOR RECEBIDO     R$ 20,00\nFORMA: DINHEIRO\nENTREGUE           R$ 50,00\nTROCO              R$ 30,00\nSALDO RESTANTE     R$ 35,00\n--------------------------------\nREGISTRO NÃO FISCAL\nEXEMPLO · NENHUMA COBRANÇA',
  closing:'DECK 26 · CAIXA\nFECHAMENTO DE EXEMPLO\n--------------------------------\nABERTURA          R$ 100,00\nENTRADAS ESPÉCIE  R$ 250,00\nSANGRIAS          R$  50,00\nESPERADO          R$ 300,00\nCONTADO           R$ 300,00\nDIFERENÇA         R$   0,00\n--------------------------------\nVALORES ILUSTRATIVOS\nRELATÓRIO GERENCIAL NÃO FISCAL'
};
