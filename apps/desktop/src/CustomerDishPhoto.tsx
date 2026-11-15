import React,{useState} from 'react';
import type {CatalogProduct} from '@deck26/contracts';
import {MenuIcon} from './MenuIcon.js';

const illustrations:Record<string,string>={
  'carne de sol':'carne-de-sol',
  'camarao cremoso':'camarao-cremoso',
  'suco de acerola 300 ml':'acerola'
};
const illustration=(product:CatalogProduct)=>{
  const name=product.name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
  return illustrations[name]??(product.categoryId==='cat-pasteis'?'pasteis':undefined);
};
const uploaded=(product:CatalogProduct)=>/^\/api\/public\/product-photos\/[a-f0-9]{64}\.jpg$/.test(product.imageUrl??'')?product.imageUrl:undefined;
export const hasCustomerPhoto=(product:CatalogProduct)=>!!(uploaded(product)||illustration(product));

export function CustomerDishPhoto({product,className,priority=false}:{product:CatalogProduct;className:string;priority?:boolean}){
  const [failed,setFailed]=useState<string>();
  const real=uploaded(product),example=illustration(product);
  const isReal=!!real&&failed!==real;
  const src=isReal?real:example?'/brand/menu/'+example+'.jpg':undefined;
  return <figure className={className+' d26-dish-photo'}>
    {src&&failed!==src?<img src={src} alt={isReal?product.name:''} loading={priority?'eager':'lazy'} decoding="async"
      onError={()=>setFailed(src)}/>:<div className="d26-dish-placeholder"><MenuIcon name="dish"/></div>}
    {src&&failed!==src&&!isReal&&<figcaption>Imagem ilustrativa</figcaption>}
  </figure>;
}
