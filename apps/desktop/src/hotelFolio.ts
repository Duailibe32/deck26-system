import {HotelFolioViewSchema,HotelFolioEntrySchema,type HotelFolioView,type HotelFolioPaymentDraft} from '@deck26/contracts';
export async function fetchHotelFolio(api:string,stayId:string,headers:Record<string,string>,request:typeof fetch=fetch):Promise<HotelFolioView>{
 const response=await request(`${api}/api/hotel/stays/${encodeURIComponent(stayId)}/folio`,{headers});
 const data=await response.json();
 if(!response.ok)throw new HotelFolioRequestError(typeof data?.error==='string'?data.error:'Não foi possível carregar o extrato. Tente atualizar.',response.status);
 const parsed=HotelFolioViewSchema.safeParse(data);
 if(!parsed.success||parsed.data.stay.id!==stayId||parsed.data.stay.tabId!==parsed.data.folioTab.id)throw Error('O extrato retornou dados incompletos ou incompatíveis. Atualize o aplicativo e tente novamente.');
 return parsed.data;
}

export class HotelFolioRequestError extends Error{constructor(message:string,public readonly status:number){super(message);}}
export async function sendHotelFolioPayment(api:string,draft:HotelFolioPaymentDraft,headers:Record<string,string>,request:typeof fetch=fetch){
 const response=await request(api+'/api/hotel/stays/'+encodeURIComponent(draft.stayId)+'/folio/entry',{method:'POST',headers,body:JSON.stringify({entryType:'PAYMENT',description:'Recebimento do quarto via '+draft.paymentMethod,amountCents:-draft.amountCents,paymentMethod:draft.paymentMethod,idempotencyKey:draft.idempotencyKey})});
 const data=await response.json();
 if(!response.ok)throw new HotelFolioRequestError(data.error||'Não foi possível confirmar o recebimento do quarto.',response.status);
 const entry=HotelFolioEntrySchema.safeParse(data.entry);
 if(!entry.success||entry.data.stayId!==draft.stayId||entry.data.amountCents!==-draft.amountCents)throw Error('O servidor não confirmou corretamente o recebimento. Reenvie a mesma confirmação.');
 return entry.data;
}
