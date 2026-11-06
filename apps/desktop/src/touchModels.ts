import type {CatalogProduct} from '@deck26/contracts';

/** Touch money is entered in cents, keeping all arithmetic in safe integers. */
export function touchDigits(current:string,key:string,replace=false,maxDigits=9):string {
  if(key==='CLEAR') return '';
  if(key==='BACKSPACE') return current.slice(0,-1);
  if(!/^(\d|00)$/.test(key)) return current;
  const next=((replace?'':current)+key).replace(/^0+(?=\d)/,'');
  return next.length<=maxDigits?next:current;
}
export const formatTouchMoney=(digits:string)=>digits?`${Math.floor(Number(digits)/100)},${String(Number(digits)%100).padStart(2,'0')}`:'';

const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function productSeal(product:Pick<CatalogProduct,'name'|'categoryId'|'subcategory'|'prepStation'>,categoryName='') {
  const identify=(text:string)=>{
    if(/cuscuz|tapioca/.test(text)) return {tone:'corn',icon:'🌽',label:'Cuscuz & tapiocas'};
    if(/petisco|paste[li]|porc(?:ao|oes)/.test(text)) return {tone:'snack',icon:'🍤',label:'Petiscos & pastéis'};
    if(/suco|vitamina/.test(text)) return {tone:'fruit',icon:'🍹',label:'Sucos & vitaminas'};
    if(/cafeteria|cafe\b|cappuccino|capuccino/.test(text)) return {tone:'coffee',icon:'☕',label:'Cafeteria'};
    if(/executiv|carne|picanha|bife|churrasco/.test(text)) return {tone:'grill',icon:'🥩',label:'Executivos & carnes'};
    return null;
  };
  return identify(normalize(categoryName))??identify(normalize(product.subcategory??''))??identify(normalize(product.name))??identify(normalize(product.categoryId))??{tone:'other',icon:'🍽️',label:'Cardápio'};
}
export function stationLabel(station:CatalogProduct['prepStation']) {
  return ({KITCHEN_HOT:'Cozinha quente',KITCHEN_COLD:'Cozinha fria',GRIDDLE_TAPIOCA:'Chapa',BAR_DRINKS:'Bar',CASHIER_COUNTER:'Balcão',NONE:'Sem produção'} as Record<string,string>)[station]??station;
}
